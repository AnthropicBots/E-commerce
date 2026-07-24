const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const chatService = require("../services/chat.service");
const logger = require("./logger");
const { sanitizeString } = require("./helpers");
const NodeCache = require('node-cache');

let io;
const userSockets = new Map();
const socketUsers = new Map();
const typingUsers = new Map();
const messageRateLimit = new Map();
const activeRooms = new Map();
const userStatus = new Map();
const messageQueue = new Map();
const offlineMessages = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

const RATE_LIMIT = parseInt(process.env.SOCKET_RATE_LIMIT) || 10;
const RATE_WINDOW = parseInt(process.env.SOCKET_RATE_WINDOW) || 60000;
const TYPING_TIMEOUT = parseInt(process.env.TYPING_TIMEOUT) || 5000;
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL) || 30000;
const MAX_CONNECTIONS_PER_USER = parseInt(process.env.MAX_SOCKET_CONNECTIONS) || 3;
const MESSAGE_QUEUE_LIMIT = parseInt(process.env.MESSAGE_QUEUE_LIMIT) || 100;

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

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                logger.warn("Socket connection attempt without token");
                return next(new Error("Authentication required"));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            socket.user = decoded;
            socket.userId = decoded.id;
            socket.userRole = decoded.role || 'customer';

            const existingSockets = userSockets.get(socket.userId) || new Set();

            if (existingSockets.size >= MAX_CONNECTIONS_PER_USER) {
                logger.warn(`User ${socket.userId} exceeded max connections`);
                return next(new Error("Too many connections"));
            }

            next();
        } catch (err) {
            logger.error(`Socket auth error: ${err.message}`);
            return next(new Error("Authentication failed"));
        }
    });

    io.on("connection", (socket) => {
        const userId = socket.userId;
        const userRole = socket.userRole;

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

        setupEventHandlers(socket);
        setupHeartbeat(socket);

        socket.on("disconnect", () => {
            handleDisconnect(socket);
        });
    });

    return io;
};

function setupEventHandlers(socket) {
    const userId = socket.userId;
    const userRole = socket.userRole;

    socket.on("join_conversation", async (data, callback) => {
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

            // deliver queued messages only after the socket has joined the room
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
    });

    socket.on("send_message", async (data, callback) => {
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
    });

    socket.on("typing", (data) => {
        handleTyping(socket, data);
    });

    socket.on("stop_typing", (data) => {
        handleStopTyping(socket, data);
    });

    socket.on("message_read", async (data) => {
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
    });

    socket.on("edit_message", async (data) => {
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
    });

    socket.on("delete_message", async (data) => {
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
    });

    socket.on("join_admin_room", () => {
        if (userRole === 'admin') {
            socket.join('admin_room');
            logger.info(`Admin ${userId} joined admin_room`);
            socket.emit('admin_room_joined', { success: true });
        }
    });

    socket.on("get_active_users", () => {
        const activeUsers = Array.from(userSockets.keys());
        socket.emit('active_users', activeUsers);
    });

    socket.on("get_online_count", () => {
        socket.emit('online_count', userSockets.size);
    });

    socket.on("pong", () => {
        socket.lastPong = Date.now();
    });
}

function cleanupPreviousRooms(socket) {
    for (const [room, sockets] of activeRooms) {
        if (sockets.has(socket.id)) {
            sockets.delete(socket.id);
            if (sockets.size === 0) {
                activeRooms.delete(room);
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

function setupHeartbeat(socket) {
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

    socket.on('disconnect', () => {
        clearInterval(heartbeatInterval);
    });
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

function handleDisconnect(socket) {
    const userId = socket.userId;
    if (userId) {
        cleanupPreviousRooms(socket);

        const userSocketSet = userSockets.get(userId);

        if (userSocketSet) {
            userSocketSet.delete(socket.id);

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

        socketUsers.delete(socket.id);
        clearTypingForUser(userId);

        io.emit('users_online', userSockets.size);
        logger.info(`User disconnected: ${userId}`);
    }

    const rateKey = socket.id;
    if (messageRateLimit.has(rateKey)) {
        messageRateLimit.delete(rateKey);
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
            io.to(socketId).emit(event, data);
        });
        return true;
    }
    return false;
}

function broadcastToRoom(roomId, event, data) {
    io.to(roomId).emit(event, data);
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

function cleanup() {
    userSockets.clear();
    socketUsers.clear();
    typingUsers.clear();
    messageRateLimit.clear();
    activeRooms.clear();
    userStatus.clear();
    messageQueue.clear();
    offlineMessages.flushAll();
    logger.info('Socket manager cleanup completed');
}

module.exports = {
    initSocket,
    getIo,
    sendToUser,
    broadcastToRoom,
    getActiveUsers,
    getUserStatus,
    getOnlineCount,
    getRoomParticipants,
    cleanup
};