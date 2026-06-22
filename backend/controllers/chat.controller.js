const chatService = require("../services/chat.service");
const { getPagination, sanitizeString, safeNumber } = require("../utils/helpers");

const getConversations = async (req, res) => {
    try {
        const { page, limit } = getPagination(req.query.page, req.query.limit, 20);
        const filters = {
            status: sanitizeString(req.query.status),
            assigned_to: sanitizeString(req.query.assigned_to),
            search: sanitizeString(req.query.search)
        };

        const data = await chatService.getConversationList(filters, page, limit);
        res.status(200).json({ success: true, ...data });
    } catch (error) {
        console.error("GET CONVERSATIONS ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

const getConversationDetails = async (req, res) => {
    try {
        const id = safeNumber(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: "Invalid ID" });

        const messages = await chatService.getConversationMessages(id);
        res.status(200).json({ success: true, messages });
    } catch (error) {
        console.error("GET CONVERSATION DETAILS ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

const updateStatus = async (req, res) => {
    try {
        const id = safeNumber(req.params.id);
        const { status } = req.body;
        if (!id || !['open', 'pending', 'closed'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid payload" });
        }

        await chatService.updateConversationStatus(id, status);
        
        // Emit socket event if needed, handled in socket logic usually
        // but we return REST success
        res.status(200).json({ success: true, message: `Conversation ${status}` });
    } catch (error) {
        console.error("UPDATE CONV STATUS ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

const assignAdmin = async (req, res) => {
    try {
        const id = safeNumber(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: "Invalid ID" });

        await chatService.assignConversation(id, req.user.id);
        res.status(200).json({ success: true, message: "Conversation assigned successfully" });
    } catch (error) {
        console.error("ASSIGN CONV ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

module.exports = {
    getConversations,
    getConversationDetails,
    updateStatus,
    assignAdmin
};
