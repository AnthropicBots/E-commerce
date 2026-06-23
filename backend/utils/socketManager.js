const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const chatService = require("../services/chat.service");

let io;

const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: ["http://localhost:5500", "http://127.0.0.1:5500"],
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    // Middleware for Auth
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error("Authentication error"));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            socket.user = decoded;
            next();
        } catch (err) {
            next(new Error("Authentication error"));
        }
    });

    io.on("connection", (socket) => {
        console.log(`User connected: ${socket.user.id} (${socket.user.role})`);

        socket.on("join_conversation", async (data, callback) => {
            try {
                let conversationId = data?.conversationId;
                
                // If customer joins without ID, find or create their default convo
                if (socket.user.role === 'customer' && !conversationId) {
                    const conv = await chatService.findOrCreateConversation(socket.user.id);
                    conversationId = conv.id;
                }

                if (!conversationId) {
                    if (callback) callback({ success: false, message: "No conversation ID" });
                    return;
                }

                // Verify access
                const hasAccess = await chatService.verifyConversationAccess(conversationId, socket.user.id, socket.user.role);
                if (!hasAccess) {
                    if (callback) callback({ success: false, message: "Unauthorized access to conversation" });
                    return;
                }

                socket.join(`conversation:${conversationId}`);
                console.log(`User ${socket.user.id} joined conversation:${conversationId}`);
                
                if (callback) callback({ success: true, conversationId });
            } catch (err) {
                console.error("Socket Join Error:", err);
                if (callback) callback({ success: false, message: "Server error" });
            }
        });

        socket.on("send_message", async (data, callback) => {
            try {
                const { conversationId, message } = data;
                if (!conversationId || !message?.trim()) return;

                // Check access
                const hasAccess = await chatService.verifyConversationAccess(conversationId, socket.user.id, socket.user.role);
                if (!hasAccess) return;

                const senderType = socket.user.role === 'admin' ? 'admin' : 'customer';
                const savedMessage = await chatService.saveMessage(conversationId, socket.user.id, senderType, message);

                // Broadcast to everyone in the room including sender
                io.to(`conversation:${conversationId}`).emit("message_received", savedMessage);
                
                // Notify admins about new message (for dashboard updates)
                io.to('admin_room').emit("conversation_updated", { conversationId, last_message: message });

                if (callback) callback({ success: true, message: savedMessage });
            } catch (err) {
                console.error("Socket Send Message Error:", err);
                if (callback) callback({ success: false, message: "Server error" });
            }
        });

        socket.on("join_admin_room", () => {
            if (socket.user.role === 'admin') {
                socket.join('admin_room');
                console.log(`Admin ${socket.user.id} joined admin_room`);
            }
        });

        socket.on("disconnect", () => {
            console.log(`User disconnected: ${socket.user.id}`);
        });
    });

    return io;
};

const getIo = () => {
    if (!io) throw new Error("Socket.io not initialized");
    return io;
};

module.exports = { initSocket, getIo };
