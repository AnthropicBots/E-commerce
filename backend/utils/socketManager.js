const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const chatService = require("../services/chat.service");
const logger = require("./logger");
const { sanitizeString } = require("./helpers");
const NodeCache = require('node-cache');

// Realtime authentication is the same contract as HTTP authentication, read
// from the same module, so a change to the secret or to the claim names cannot
// leave the two halves disagreeing about what a valid token is.
const {
    LEGACY_SUBJECT_CLAIM,
    SESSION_CLAIM,
    SUBJECT_CLAIM,
    assertAccessTokenSecret,
    hasSubjectClaim,
    verifyAccessToken
} = require("./tokens");

const { onSessionRevoked } = require("./sessionRevocationBus");

// Shared client -- see config/redis.js. This module used to construct its own
// `new Redis({ ... })`, which meant an extra connection per module and made
// the module impossible to load without a live Redis (#1341).
const redis = require("../config/redis");

const pubClient = redis.duplicate();
const subClient = redis.duplicate();

const RATE_LIMIT = parseInt(process.env.SOCKET_RATE_LIMIT) || 10;
const RATE_WINDOW = parseInt(process.env.SOCKET_RATE_WINDOW) || 60000;
const TYPING_TIMEOUT = parseInt(process.env.TYPING_TIMEOUT) || 5000;
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL) || 30000;
const MAX_CONNECTIONS_PER_USER = parseInt(process.env.MAX_SOCKET_CONNECTIONS) || 3;
const MESSAGE_QUEUE_LIMIT = parseInt(process.env.MESSAGE_QUEUE_LIMIT) || 100;
const MEMORY_LEAK_THRESHOLD = parseInt(process.env.MEMORY_LEAK_THRESHOLD) || 1000;

// Ties an access token back to the refresh-token family it was minted from.
// Issued by the auth controller; the session claim is issued by the durable
// sessions service. Either may be absent on a token, so neither is required.
const FAMILY_CLAIM = "fid";

// Events the client sees. `reauthenticate` is the only one it sends.
const REAUTHENTICATE_EVENT = "reauthenticate";
const TOKEN_EXPIRED_EVENT = "token_expired";
const SESSION_REVOKED_EVENT = "session_revoked";

// setTimeout keeps its delay in a signed 32-bit integer and fires immediately
// on anything larger. Access tokens last minutes, so clamping only affects a
// token with an implausible lifetime -- which is then cut short rather than
// trusted for a month.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

// Rooms a connection is placed in purely so a revocation can find it again.
const AUTH_ROOM = Object.freeze({
    user: (userId) => `auth:user:${userId}`,
    session: (sessionId) => `auth:session:${sessionId}`,
    family: (familyId) => `auth:family:${familyId}`
});

let io;
let unsubscribeSessionRevocation = null;
const userSockets = new Map();
const socketUsers = new Map();
const typingUsers = new Map();
const messageRateLimit = new Map();
const activeRooms = new Map();
const userStatus = new Map();
const messageQueue = new Map();
const offlineMessages = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

const listenerRegistry = new Map();
const heartbeatIntervals = new Map();
const tokenExpiryTimers = new Map();
const cleanupTimers = new Map();
const connectionMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    totalDisconnections: 0,
    memoryWarnings: 0,
    lastCleanup: null
};

class ListenerRegistry {
    constructor(socketId) {
        this.socketId = socketId;
        this.listeners = new Map();
        this.cleanupFunctions = new Set();
    }

    register(event, listener, options = {}) {
        const key = `${event}_${options.once ? 'once' : 'on'}`;
        this.listeners.set(key, { event, listener, once: options.once || false });
        return this;
    }

    getListener(event, once = false) {
        const key = `${event}_${once ? 'once' : 'on'}`;
        return this.listeners.get(key)?.listener || null;
    }

    getAllListeners() {
        return Array.from(this.listeners.entries()).map(([key, data]) => ({
            event: data.event,
            once: data.once,
            hasListener: true
        }));
    }

    addCleanup(fn) {
        this.cleanupFunctions.add(fn);
        return this;
    }

    async cleanup() {
        for (const fn of this.cleanupFunctions) {
            try {
                await fn();
            } catch (error) {
                logger.error(`Cleanup function error for ${this.socketId}:`, error);
            }
        }
        this.cleanupFunctions.clear();
        this.listeners.clear();
    }

    getCount() {
        return this.listeners.size + this.cleanupFunctions.size;
    }
}

const initSocket = (server, allowedOrigins) => {
    io = new Server(server, {
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST"],
            credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        transports: ['websocket', 'polling'],
        allowEIO3: true,
        maxHttpBufferSize: 1e6,
        perMessageDeflate: {
            threshold: 1024
        }
    });

    try {
        io.adapter(createAdapter(pubClient, subClient));
        logger.info("✅ Redis Adapter initialized for Socket.IO");
    } catch (error) {
        logger.error("❌ Redis Adapter initialization failed:", error);
    }

    io.use(authenticateSocket);

    // Ending a session is an HTTP concern that happens in the service layer;
    // this is how the consequence reaches the connections that session opened.
    if (unsubscribeSessionRevocation) {
        unsubscribeSessionRevocation();
    }
    unsubscribeSessionRevocation = onSessionRevoked(disconnectRevokedSessions);

    io.on("connection", (socket) => {
        const userId = socket.userId;
        const userRole = socket.userRole;

        connectionMetrics.totalConnections++;
        connectionMetrics.activeConnections++;
        logger.info(`User connected: ${userId} (${userRole}) - Socket: ${socket.id}`);

        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
        }
        const userSocketSet = userSockets.get(userId);
        userSocketSet.add(socket.id);
        socketUsers.set(socket.id, userId);

        userStatus.set(userId, {
            status: 'online',
            lastSeen: new Date(),
            socketId: socket.id
        });

        io.emit('user_status_change', { userId, status: 'online' });
        io.emit('users_online', userSockets.size);

        setupAuthenticatedSession(socket);

        // Setup event handlers with registry
        setupEventHandlersWithRegistry(socket);
        setupHeartbeatWithCleanup(socket);

        // Setup cleanup on disconnect
        socket.on("disconnect", () => {
            handleDisconnectWithCleanup(socket);
        });

        // Error handler with cleanup
        socket.on("error", (error) => {
            logger.error(`Socket ${socket.id} error:`, error);
            handleDisconnectWithCleanup(socket);
        });

        // Check memory usage periodically
        checkMemoryUsage(socket);
    });

    process.on('SIGTERM', () => {
        logger.info('SIGTERM received, cleaning up socket connections...');
        cleanupAll();
    });

    return io;
};

/**
 * Handshake guard: a connection is admitted only against a token this service
 * issued and can still vouch for.
 *
 * Registered with `io.use`, and exported so the contract can be exercised
 * without standing up a server.
 */
function authenticateSocket(socket, next) {
    const token = socket.handshake?.auth?.token;
    if (!token) {
        logger.warn("Socket connection attempt without token");
        return next(new Error("Authentication required"));
    }

    try {
        assertAccessTokenSecret();
    } catch (error) {
        // With no secret there is no way to tell a token this service issued
        // from one an attacker made up, so the realtime layer refuses
        // everything. It used to fall back to a guessable constant, which left
        // sockets reachable on a deployment where HTTP had already refused to
        // start.
        logger.error(`Socket authentication unavailable: ${error.message}`);
        return next(new Error("Authentication unavailable"));
    }

    let decoded;
    try {
        decoded = verifyAccessToken(token);
    } catch (error) {
        logger.warn(`Socket auth rejected: ${error.message}`);
        return next(new Error("Authentication failed"));
    }

    const userId = subjectOf(decoded);
    if (userId === undefined) {
        logger.warn("Socket auth rejected: token carries no subject claim");
        return next(new Error("Authentication failed"));
    }

    // Every issuing path sets a lifetime. A token without one could never be
    // aged out of a live connection, which is the whole point of the timer
    // below, so it is refused rather than trusted forever.
    if (typeof decoded.exp !== "number") {
        logger.warn(`Socket auth rejected: token for user ${userId} has no expiry`);
        return next(new Error("Authentication failed"));
    }

    socket.user = decoded;
    socket.userId = userId;
    socket.userRole = decoded.role || 'customer';

    socket._listenerRegistry = new ListenerRegistry(socket.id);

    const existingSockets = userSockets.get(socket.userId) || new Set();

    if (existingSockets.size >= MAX_CONNECTIONS_PER_USER) {
        logger.warn(`User ${socket.userId} exceeded max connections`);
        return next(new Error("Too many connections"));
    }

    next();
}

/**
 * Everything that keeps an admitted connection honest: the rooms a revocation
 * will look for it in, the disconnect scheduled for when its token runs out,
 * and the way it can avoid that disconnect legitimately.
 */
function setupAuthenticatedSession(socket) {
    joinAuthRooms(socket, socket.user);
    scheduleTokenExpiry(socket, socket.user);

    const reauthenticateHandler = (data, callback) => {
        handleReauthenticate(socket, data, callback);
    };
    socket.on(REAUTHENTICATE_EVENT, reauthenticateHandler);

    socket._listenerRegistry?.register(REAUTHENTICATE_EVENT, reauthenticateHandler);
    socket._listenerRegistry?.addCleanup(() => clearTokenExpiry(socket.id));
}

/**
 * Close the live connections belonging to sessions that have just been ended.
 *
 * The narrowest identifier wins: a session id closes one device, a family id
 * closes the devices descended from one sign-in, and a user id closes the whole
 * account. `exceptSessionId` spares one session and is only read alongside
 * `userId`, which is what "sign out everywhere else" needs.
 *
 * The Redis adapter carries the disconnect to every instance, so the connection
 * does not have to be held by the process that ended the session.
 *
 * @returns {boolean} Whether a disconnect was issued.
 */
function disconnectRevokedSessions({ sessionId, familyId, userId, exceptSessionId, reason } = {}) {
    // A process that serves only HTTP never initialises the realtime layer.
    // Ending a session there is legitimate and has nothing to disconnect.
    if (!io) return false;

    let room = null;
    if (sessionId) {
        room = AUTH_ROOM.session(sessionId);
    } else if (familyId) {
        room = AUTH_ROOM.family(familyId);
    } else if (userId !== undefined && userId !== null) {
        room = AUTH_ROOM.user(userId);
    }

    if (!room) return false;

    const revocationReason = reason || "revoked";

    try {
        let target = io.in(room);
        if (!sessionId && !familyId && exceptSessionId) {
            target = target.except(AUTH_ROOM.session(exceptSessionId));
        }

        target.emit(SESSION_REVOKED_EVENT, { reason: revocationReason });
        target.disconnectSockets(true);

        logger.info(`Disconnected sockets in ${room} (reason: ${revocationReason})`);
        return true;
    } catch (error) {
        logger.error(`Failed to disconnect sockets in ${room}:`, error);
        return false;
    }
}

/**
 * Subject id under either accepted claim, matching what the HTTP middleware
 * accepts so the same token cannot identify two different users.
 *
 * @returns {string|number|undefined}
 */
function subjectOf(decoded) {
    if (!hasSubjectClaim(decoded)) return undefined;

    return decoded[SUBJECT_CLAIM] !== undefined
        ? decoded[SUBJECT_CLAIM]
        : decoded[LEGACY_SUBJECT_CLAIM];
}

function joinAuthRooms(socket, decoded) {
    // Renewal can move a connection onto a new session or a new family, so the
    // rooms it held for the previous token have to be given up first.
    for (const room of socket._authRooms || []) {
        socket.leave(room);
    }

    const rooms = [AUTH_ROOM.user(socket.userId)];
    if (decoded?.[SESSION_CLAIM]) {
        rooms.push(AUTH_ROOM.session(decoded[SESSION_CLAIM]));
    }
    if (decoded?.[FAMILY_CLAIM]) {
        rooms.push(AUTH_ROOM.family(decoded[FAMILY_CLAIM]));
    }

    for (const room of rooms) {
        socket.join(room);
    }
    socket._authRooms = rooms;
}

function scheduleTokenExpiry(socket, decoded) {
    clearTokenExpiry(socket.id);

    const remainingMs = decoded.exp * 1000 - Date.now();
    const delay = Math.max(0, Math.min(remainingMs, MAX_TIMER_DELAY_MS));

    const timer = setTimeout(() => {
        tokenExpiryTimers.delete(socket.id);
        logger.info(`Access token expired for user ${socket.userId} - Socket: ${socket.id}`);
        socket.emit(TOKEN_EXPIRED_EVENT, {
            reason: "token_expired",
            message: "Access token expired. Re-authenticate to continue."
        });
        socket.disconnect(true);
    }, delay);

    tokenExpiryTimers.set(socket.id, timer);
}

function clearTokenExpiry(socketId) {
    const timer = tokenExpiryTimers.get(socketId);
    if (timer) {
        clearTimeout(timer);
        tokenExpiryTimers.delete(socketId);
    }
}

/**
 * Let a client that has renewed its token keep the connection it already has,
 * rather than dropping and reopening one every few minutes.
 */
function handleReauthenticate(socket, data, callback) {
    const respond = (payload) => {
        if (typeof callback === 'function') callback(payload);
    };

    const token = typeof data === 'string' ? data : data?.token;
    if (!token) {
        respond({ success: false, message: "Token required" });
        return;
    }

    let decoded;
    try {
        assertAccessTokenSecret();
        decoded = verifyAccessToken(token);
    } catch (error) {
        logger.warn(`Socket re-authentication failed for ${socket.id}: ${error.message}`);
        respond({ success: false, message: "Authentication failed" });
        socket.disconnect(true);
        return;
    }

    // A connection stays bound to the account it was opened for. Accepting a
    // token for someone else would carry its room memberships, and everything
    // already authorised on it, across to another user.
    const isSameSubject = String(subjectOf(decoded)) === String(socket.userId);
    if (!isSameSubject || typeof decoded.exp !== "number") {
        logger.warn(`Socket re-authentication rejected for ${socket.id}`);
        respond({ success: false, message: "Authentication failed" });
        socket.disconnect(true);
        return;
    }

    socket.user = decoded;
    socket.userRole = decoded.role || 'customer';
    joinAuthRooms(socket, decoded);
    scheduleTokenExpiry(socket, decoded);

    logger.debug(`Socket ${socket.id} re-authenticated for user ${socket.userId}`);
    respond({ success: true, expiresAt: decoded.exp });
}

function setupEventHandlersWithRegistry(socket) {
    const registry = socket._listenerRegistry;
    const userId = socket.userId;
    const userRole = socket.userRole;

    const joinConversationHandler = async (data, callback) => {
        try {
            let conversationId = data?.conversationId;

            if (userRole === 'customer' && !conversationId) {
                const conv = await chatService.findOrCreateConversation(userId);
                conversationId = conv.id;
            }

            if (!conversationId) {
                if (callback) callback({ success: false, message: "No conversation ID" });
                return;
            }

            const hasAccess = await chatService.verifyConversationAccess(conversationId, userId, userRole);
            if (!hasAccess) {
                if (callback) callback({ success: false, message: "Unauthorized" });
                return;
            }

            cleanupPreviousRooms(socket);

            const roomId = `conversation:${conversationId}`;
            socket.join(roomId);

            if (!activeRooms.has(roomId)) {
                activeRooms.set(roomId, new Set());
            }
            activeRooms.get(roomId).add(socket.id);
            socket.currentRoom = roomId;

            deliverQueuedMessages(socket, userId);

            logger.info(`User ${userId} joined ${roomId}`);

            const participants = Array.from(activeRooms.get(roomId))
                .map(sId => socketUsers.get(sId))
                .filter(id => id);

            io.to(roomId).emit('room_participants', participants);

            if (callback) callback({ success: true, conversationId });
        } catch (err) {
            logger.error(`Socket Join Error: ${err.message}`);
            if (callback) callback({ success: false, message: "Server error" });
        }
    };
    socket.on("join_conversation", joinConversationHandler);
    registry.register("join_conversation", joinConversationHandler);

    const sendMessageHandler = async (data, callback) => {
        try {
            if (!checkRateLimit(socket.id)) {
                socket.emit('error', {
                    message: 'Rate limit exceeded. Please wait before sending more messages.'
                });
                if (callback) callback({ success: false, message: "Rate limit exceeded" });
                return;
            }

            const { conversationId, message } = data;
            if (!conversationId || !message?.trim()) {
                if (callback) callback({ success: false, message: "Invalid message" });
                return;
            }

            const sanitizedMessage = sanitizeString(message.trim());

            const hasAccess = await chatService.verifyConversationAccess(conversationId, userId, userRole);
            if (!hasAccess) {
                if (callback) callback({ success: false, message: "Unauthorized" });
                return;
            }

            const senderType = userRole === 'admin' ? 'admin' : 'customer';
            const savedMessage = await chatService.saveMessage(conversationId, userId, senderType, sanitizedMessage);

            const roomId = `conversation:${conversationId}`;
            const roomSockets = io.sockets.adapter.rooms.get(roomId);

            if (roomSockets && roomSockets.size > 0) {
                io.to(roomId).emit("message_received", savedMessage);
            } else {
                queueMessage(conversationId, savedMessage);
            }

            io.to('admin_room').emit("conversation_updated", {
                conversationId,
                last_message: sanitizedMessage,
                timestamp: new Date().toISOString()
            });

            clearTypingForUser(userId);

            if (callback) callback({ success: true, message: savedMessage });
        } catch (err) {
            logger.error(`Socket Send Message Error: ${err.message}`);
            if (callback) callback({ success: false, message: "Server error" });
        }
    };
    socket.on("send_message", sendMessageHandler);
    registry.register("send_message", sendMessageHandler);

    const typingHandler = (data) => {
        handleTyping(socket, data);
    };
    socket.on("typing", typingHandler);
    registry.register("typing", typingHandler);

    const stopTypingHandler = (data) => {
        handleStopTyping(socket, data);
    };
    socket.on("stop_typing", stopTypingHandler);
    registry.register("stop_typing", stopTypingHandler);

    const messageReadHandler = async (data) => {
        try {
            const { messageId, conversationId } = data;
            if (!messageId || !conversationId) return;

            await chatService.markMessageAsRead(messageId, userId);

            io.to(`conversation:${conversationId}`).emit('message_read', {
                messageId,
                userId,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            logger.error(`Message read error: ${err.message}`);
        }
    };
    socket.on("message_read", messageReadHandler);
    registry.register("message_read", messageReadHandler);

    const editMessageHandler = async (data) => {
        try {
            const { messageId, newMessage, conversationId } = data;
            if (!messageId || !newMessage || !conversationId) return;

            const message = await chatService.getMessage(messageId);
            if (!message || message.sender_id !== userId) {
                socket.emit('error', { message: 'Not authorized to edit this message' });
                return;
            }

            const sanitizedMessage = sanitizeString(newMessage.trim());
            await chatService.updateMessage(messageId, sanitizedMessage);

            io.to(`conversation:${conversationId}`).emit('message_edited', {
                messageId,
                newMessage: sanitizedMessage,
                editedAt: new Date().toISOString()
            });
        } catch (err) {
            logger.error(`Edit message error: ${err.message}`);
            socket.emit('error', { message: 'Failed to edit message' });
        }
    };
    socket.on("edit_message", editMessageHandler);
    registry.register("edit_message", editMessageHandler);

    const deleteMessageHandler = async (data) => {
        try {
            const { messageId, conversationId } = data;
            if (!messageId || !conversationId) return;

            const message = await chatService.getMessage(messageId);
            if (!message || (message.sender_id !== userId && userRole !== 'admin')) {
                socket.emit('error', { message: 'Not authorized to delete this message' });
                return;
            }

            await chatService.deleteMessage(messageId);

            io.to(`conversation:${conversationId}`).emit('message_deleted', {
                messageId,
                deletedAt: new Date().toISOString()
            });
        } catch (err) {
            logger.error(`Delete message error: ${err.message}`);
            socket.emit('error', { message: 'Failed to delete message' });
        }
    };
    socket.on("delete_message", deleteMessageHandler);
    registry.register("delete_message", deleteMessageHandler);

    const joinAdminHandler = () => {
        if (userRole === 'admin') {
            socket.join('admin_room');
            logger.info(`Admin ${userId} joined admin_room`);
            socket.emit('admin_room_joined', { success: true });
        }
    };
    socket.on("join_admin_room", joinAdminHandler);
    registry.register("join_admin_room", joinAdminHandler);

    const getActiveUsersHandler = () => {
        const activeUsers = Array.from(userSockets.keys());
        socket.emit('active_users', activeUsers);
    };
    socket.on("get_active_users", getActiveUsersHandler);
    registry.register("get_active_users", getActiveUsersHandler);

    const getOnlineCountHandler = () => {
        socket.emit('online_count', userSockets.size);
    };
    socket.on("get_online_count", getOnlineCountHandler);
    registry.register("get_online_count", getOnlineCountHandler);

    const pongHandler = () => {
        socket.lastPong = Date.now();
    };
    socket.on("pong", pongHandler);
    registry.register("pong", pongHandler);

    registry.addCleanup(() => {
        const listeners = registry.getAllListeners();
        for (const { event, once } of listeners) {
            try {
                if (once) {
                    socket.removeAllListeners(event);
                } else {
                    socket.removeAllListeners(event);
                }
            } catch (error) {
                logger.error(`Failed to remove listener ${event}:`, error);
            }
        }
        logger.debug(`Cleaned up ${listeners.length} listeners for socket ${socket.id}`);
    });

    logger.debug(`Registered ${registry.getCount()} listeners for socket ${socket.id}`);
}

function setupHeartbeatWithCleanup(socket) {
    socket.lastPong = Date.now();

    const heartbeatInterval = setInterval(() => {
        const now = Date.now();
        if (now - socket.lastPong > HEARTBEAT_INTERVAL + 5000) {
            logger.warn(`Heartbeat timeout for socket ${socket.id}`);
            socket.emit('heartbeat_timeout');
            clearInterval(heartbeatInterval);
            socket.disconnect(true);
        }
    }, HEARTBEAT_INTERVAL);

    heartbeatIntervals.set(socket.id, heartbeatInterval);

    socket._listenerRegistry.addCleanup(() => {
        if (heartbeatIntervals.has(socket.id)) {
            clearInterval(heartbeatIntervals.get(socket.id));
            heartbeatIntervals.delete(socket.id);
        }
    });
}

function handleDisconnectWithCleanup(socket) {
    const userId = socket.userId;
    const socketId = socket.id;

    try {
        if (socket._listenerRegistry) {
            socket._listenerRegistry.cleanup();
            delete socket._listenerRegistry;
        }

        if (heartbeatIntervals.has(socketId)) {
            clearInterval(heartbeatIntervals.get(socketId));
            heartbeatIntervals.delete(socketId);
        }

        clearTokenExpiry(socketId);

        clearTypingForUser(userId);

        if (messageRateLimit.has(socketId)) {
            messageRateLimit.delete(socketId);
        }

        cleanupPreviousRooms(socket);

        if (userId) {
            const userSocketSet = userSockets.get(userId);
            if (userSocketSet) {
                userSocketSet.delete(socketId);
                if (userSocketSet.size === 0) {
                    userSockets.delete(userId);
                    userStatus.set(userId, { status: 'offline', lastSeen: new Date() });
                    io.emit('user_status_change', { userId, status: 'offline' });
                } else {
                    userStatus.set(userId, {
                        status: 'online',
                        lastSeen: new Date(),
                        socketId: Array.from(userSocketSet)[0]
                    });
                }
            }
            socketUsers.delete(socketId);

            // Update metrics
            connectionMetrics.activeConnections--;
            connectionMetrics.totalDisconnections++;
        }

        if (io?.sockets?.sockets) {
            delete io.sockets.sockets[socketId];
        }

        io.emit('users_online', userSockets.size);

        logger.info(`User disconnected: ${userId || 'unknown'} - Socket: ${socketId}`);
        logger.info(`Active connections: ${connectionMetrics.activeConnections}`);

        if (connectionMetrics.activeConnections < 10 && process.memoryUsage().heapUsed > 100 * 1024 * 1024) {
            global.gc && global.gc();
            logger.info('GC triggered after cleanup');
        }

    } catch (error) {
        logger.error(`Disconnect cleanup error for socket ${socketId}:`, error);
    }
}

function cleanupPreviousRooms(socket) {
    for (const [room, sockets] of activeRooms) {
        if (sockets.has(socket.id)) {
            sockets.delete(socket.id);
            if (sockets.size === 0) {
                activeRooms.delete(room);
                logger.debug(`Room ${room} removed (empty)`);
            }
        }
    }
}

function handleTyping(socket, data) {
    const userId = socket.userId;
    if (!userId) return;

    const roomId = data.roomId || socket.currentRoom;
    if (!roomId) return;

    if (typingUsers.has(roomId)) {
        const existing = typingUsers.get(roomId);
        if (existing.userId === userId) {
            clearTimeout(existing.timeout);
        }
    }

    const timeout = setTimeout(() => {
        handleStopTyping(socket, { roomId });
    }, TYPING_TIMEOUT);

    typingUsers.set(roomId, { userId, timeout });
    io.to(roomId).emit('user_typing', { userId });
}

function handleStopTyping(socket, data) {
    const userId = socket.userId;
    if (!userId) return;

    const roomId = data.roomId || socket.currentRoom;
    if (!roomId) return;

    const typingData = typingUsers.get(roomId);
    if (typingData && typingData.userId === userId) {
        clearTimeout(typingData.timeout);
        typingUsers.delete(roomId);
        io.to(roomId).emit('user_stopped_typing', { userId });
    }
}

function clearTypingForUser(userId) {
    for (const [roomId, data] of typingUsers) {
        if (data.userId === userId) {
            clearTimeout(data.timeout);
            typingUsers.delete(roomId);
            io.to(roomId).emit('user_stopped_typing', { userId });
        }
    }
}

function checkRateLimit(socketId) {
    const now = Date.now();
    const userRate = messageRateLimit.get(socketId) || { count: 0, timestamp: now };

    if (now - userRate.timestamp > RATE_WINDOW) {
        userRate.count = 0;
        userRate.timestamp = now;
    }

    if (userRate.count >= RATE_LIMIT) {
        return false;
    }

    userRate.count++;
    messageRateLimit.set(socketId, userRate);
    return true;
}

function queueMessage(conversationId, message) {
    if (!messageQueue.has(conversationId)) {
        messageQueue.set(conversationId, []);
    }
    const queue = messageQueue.get(conversationId);
    if (queue.length < MESSAGE_QUEUE_LIMIT) {
        queue.push(message);
    } else {
        logger.warn(`Message queue full for conversation ${conversationId}`);
    }
}

function deliverQueuedMessages(socket, userId) {
    const conversationId = socket.currentRoom?.replace('conversation:', '');
    if (!conversationId) return;

    const queue = messageQueue.get(conversationId);
    if (queue && queue.length > 0) {
        queue.forEach(msg => {
            socket.emit("message_received", msg);
        });
        messageQueue.delete(conversationId);
        logger.info(`Delivered ${queue.length} queued messages to user ${userId}`);
    }
}

function checkMemoryUsage(socket) {
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
    const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;

    // Check for memory leak warning
    if (heapUsagePercent > 80) {
        connectionMetrics.memoryWarnings++;
        logger.warn(`Memory usage warning: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${heapUsagePercent.toFixed(1)}%)`);
        
        // Check for stale listeners
        const totalListeners = Array.from(listenerRegistry.keys()).length;
        if (totalListeners > MEMORY_LEAK_THRESHOLD) {
            logger.error(`Potential memory leak: ${totalListeners} listeners detected!`);
            // Trigger aggressive cleanup
            setTimeout(() => cleanupStaleListeners(), 1000);
        }
    }

    // Store memory metrics in Redis for monitoring
    try {
        const metricKey = `socket:metrics:${socket.id}`;
        redis.setex(metricKey, 60, JSON.stringify({
            heapUsed: heapUsedMB,
            heapTotal: heapTotalMB,
            heapPercent: heapUsagePercent,
            activeConnections: connectionMetrics.activeConnections,
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        // Silently fail for metrics
    }
}

function cleanupStaleListeners() {
    let cleaned = 0;
    const now = Date.now();

    for (const [socketId, registry] of listenerRegistry) {
        // Check if socket is still active
        if (!io?.sockets?.sockets?.has(socketId)) {
            registry.cleanup();
            listenerRegistry.delete(socketId);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} stale listener registries`);
        connectionMetrics.lastCleanup = new Date().toISOString();
    }
}

function getIo() {
    if (!io) throw new Error("Socket.io not initialized");
    return io;
}

function sendToUser(userId, event, data) {
    const socketIds = userSockets.get(userId);
    if (socketIds && socketIds.size > 0) {
        socketIds.forEach((socketId) => {
            try {
                io.to(socketId).emit(event, data);
            } catch (error) {
                logger.error(`Failed to send to socket ${socketId}:`, error);
            }
        });
        return true;
    }
    return false;
}

function broadcastToRoom(roomId, event, data) {
    try {
        io.to(roomId).emit(event, data);
    } catch (error) {
        logger.error(`Failed to broadcast to room ${roomId}:`, error);
    }
}

function getActiveUsers() {
    return Array.from(userSockets.keys());
}

function getUserStatus(userId) {
    return userStatus.get(userId) || { status: 'offline', lastSeen: null };
}

function getOnlineCount() {
    return userSockets.size;
}

function getRoomParticipants(roomId) {
    const sockets = activeRooms.get(roomId);
    if (!sockets) return [];
    return Array.from(sockets)
        .map(sId => socketUsers.get(sId))
        .filter(id => id);
}

function getConnectionMetrics() {
    return {
        ...connectionMetrics,
        activeSockets: userSockets.size,
        activeRooms: activeRooms.size,
        typingUsers: typingUsers.size,
        queuedMessages: Array.from(messageQueue.values()).reduce((sum, q) => sum + q.length, 0)
    };
}

function cleanupAll() {
    logger.info('Starting full cleanup...');
    
    // Clean up all listener registries
    for (const [socketId, registry] of listenerRegistry) {
        try {
            registry.cleanup();
        } catch (error) {
            logger.error(`Failed to clean registry for ${socketId}:`, error);
        }
    }
    listenerRegistry.clear();

    // Clear all maps
    userSockets.clear();
    socketUsers.clear();
    typingUsers.clear();
    messageRateLimit.clear();
    activeRooms.clear();
    userStatus.clear();
    messageQueue.clear();
    offlineMessages.flushAll();

    // Clear heartbeat intervals
    for (const [socketId, interval] of heartbeatIntervals) {
        clearInterval(interval);
    }
    heartbeatIntervals.clear();

    for (const [socketId, timer] of tokenExpiryTimers) {
        clearTimeout(timer);
    }
    tokenExpiryTimers.clear();

    for (const [socketId, timer] of cleanupTimers) {
        clearTimeout(timer);
    }
    cleanupTimers.clear();

    connectionMetrics.activeConnections = 0;
    connectionMetrics.lastCleanup = new Date().toISOString();

    logger.info('Full cleanup completed');
}

function getSocketInfo(socketId) {
    try {
        const userId = socketUsers.get(socketId);
        const registry = listenerRegistry.get(socketId);
        return {
            socketId,
            userId,
            listenerCount: registry?.getCount() || 0,
            listeners: registry?.getAllListeners() || [],
            isActive: io?.sockets?.sockets?.has(socketId) || false,
            rooms: Array.from(activeRooms.entries())
                .filter(([_, sockets]) => sockets.has(socketId))
                .map(([room]) => room)
        };
    } catch (error) {
        return { socketId, error: error.message };
    }
}

module.exports = {
    initSocket,
    authenticateSocket,
    setupAuthenticatedSession,
    disconnectRevokedSessions,
    getIo,
    sendToUser,
    broadcastToRoom,
    getActiveUsers,
    getUserStatus,
    getOnlineCount,
    getRoomParticipants,
    getConnectionMetrics,
    cleanupAll,
    getSocketInfo,
    cleanupStaleListeners,
    redis,
    pubClient,
    subClient
};