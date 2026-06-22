const db = require("../config/db");
const { safeArray, safeNumber } = require("../utils/helpers");

const findOrCreateConversation = async (customerId) => {
    // Check if open or pending conversation exists
    const [existing] = await db.query(
        `SELECT * FROM chat_conversations WHERE customer_id = ? AND status IN ('open', 'pending') LIMIT 1`,
        [customerId]
    );

    if (existing.length > 0) return existing[0];

    // Create new
    const [result] = await db.query(
        `INSERT INTO chat_conversations (customer_id, status) VALUES (?, 'open')`,
        [customerId]
    );

    const [newConv] = await db.query(`SELECT * FROM chat_conversations WHERE id = ?`, [result.insertId]);
    return newConv[0];
};

const getConversationList = async (filters, page = 1, limit = 20) => {
    const offset = (page - 1) * limit;
    let query = `
        SELECT c.*, u.name as customer_name, u.email as customer_email,
        (SELECT message FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_activity
        FROM chat_conversations c
        JOIN users u ON c.customer_id = u.id
        WHERE 1=1
    `;
    const params = [];

    if (filters.status) {
        query += ` AND c.status = ?`;
        params.push(filters.status);
    }
    
    if (filters.assigned_to) {
        if (filters.assigned_to === 'unassigned') {
            query += ` AND c.assigned_admin_id IS NULL`;
        } else {
            query += ` AND c.assigned_admin_id = ?`;
            params.push(filters.assigned_to);
        }
    }

    if (filters.search) {
        query += ` AND (u.name LIKE ? OR u.email LIKE ?)`;
        params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    // Get total count
    const [countResult] = await db.query(`SELECT COUNT(*) as total FROM (${query}) as t`, params);

    // Apply sorting and pagination
    query += ` ORDER BY last_activity DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [conversations] = await db.query(query, params);

    return {
        conversations: safeArray(conversations),
        total: countResult[0].total,
        page,
        limit
    };
};

const getConversationMessages = async (conversationId) => {
    const [messages] = await db.query(
        `SELECT m.*, u.name as sender_name 
         FROM chat_messages m 
         JOIN users u ON m.sender_id = u.id 
         WHERE m.conversation_id = ? 
         ORDER BY m.created_at ASC`,
        [conversationId]
    );
    return safeArray(messages);
};

const saveMessage = async (conversationId, senderId, senderType, message) => {
    const [result] = await db.query(
        `INSERT INTO chat_messages (conversation_id, sender_id, sender_type, message) VALUES (?, ?, ?, ?)`,
        [conversationId, senderId, senderType, message]
    );
    
    // Update conversation updated_at implicitly
    await db.query(`UPDATE chat_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [conversationId]);
    
    const [newMsg] = await db.query(
        `SELECT m.*, u.name as sender_name FROM chat_messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?`, 
        [result.insertId]
    );
    return newMsg[0];
};

const updateConversationStatus = async (conversationId, status) => {
    let query = `UPDATE chat_conversations SET status = ?`;
    const params = [status];
    
    if (status === 'closed') {
        query += `, closed_at = CURRENT_TIMESTAMP`;
    } else {
        query += `, closed_at = NULL`;
    }
    
    query += ` WHERE id = ?`;
    params.push(conversationId);
    
    await db.query(query, params);
};

const assignConversation = async (conversationId, adminId) => {
    await db.query(
        `UPDATE chat_conversations SET assigned_admin_id = ?, status = 'pending' WHERE id = ?`,
        [adminId, conversationId]
    );
};

const verifyConversationAccess = async (conversationId, userId, role) => {
    const [conv] = await db.query(`SELECT * FROM chat_conversations WHERE id = ?`, [conversationId]);
    if (!conv.length) return false;
    
    if (role === 'admin') return true;
    return conv[0].customer_id === userId;
};

module.exports = {
    findOrCreateConversation,
    getConversationList,
    getConversationMessages,
    saveMessage,
    updateConversationStatus,
    assignConversation,
    verifyConversationAccess
};
