const chatService = require("../services/chat.service");
const {
  getPagination,
  sanitizeString,
  safeNumber,
  safeInteger,
} = require("../utils/helpers");
const logger = require("../utils/logger");
const { PERMISSIONS, hasPermission } = require("../config/policy");

/**
 * The id of a conversation, or null.
 *
 * `chat_conversations.id` is `INT AUTO_INCREMENT` (migrations/0001, line 940),
 * and `chat.service` has always parsed it as one -- `findOrCreateConversation`
 * returns `result.insertId`. These handlers validated it with `safeUUID`, which
 * every integer fails, so every request naming a real conversation was refused
 * as "Invalid ID format" before the service was reached (#1527).
 *
 * @param {*} value
 * @returns {number|null}
 */
function conversationId(value) {
  // Digits and nothing else, checked before parsing. `safeInteger` is
  // `parseInt`, which reads a leading number and discards the rest -- so
  // "42-and-a-half", or a UUID beginning "3f25…", would resolve to a real
  // conversation that the caller did not name.
  if (!/^\d+$/.test(String(value ?? "").trim())) {
    return null;
  }

  const id = safeInteger(value, 0);

  return id > 0 ? id : null;
}

const getConversations = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    let limit = parseInt(req.query.limit) || 20;

    const MAX_LIMIT = 100;
    if (limit > MAX_LIMIT) {
      limit = MAX_LIMIT;
    }
    if (limit < 1) {
      limit = 1;
    }

    const filters = {
      status: sanitizeString(req.query.status),
      assigned_to: sanitizeString(req.query.assigned_to),
      search: sanitizeString(req.query.search),
    };

    const validStatuses = ["open", "pending", "closed", "archived"];
    if (filters.status && !validStatuses.includes(filters.status)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid status value. Allowed: open, pending, closed, archived",
      });
    }

    const data = await chatService.getConversationList(filters, page, limit);

    const response = {
      success: true,
      data: data.conversations || data.data || [],
      pagination: {
        page: page,
        limit: limit,
        total: data.total || 0,
        totalPages: data.totalPages || Math.ceil((data.total || 0) / limit),
        hasNext:
          page < (data.totalPages || Math.ceil((data.total || 0) / limit)),
        hasPrev: page > 1,
      },
    };

    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");

    res.status(200).json(response);
  } catch (error) {
    console.error("GET CONVERSATIONS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
    });
  }
};

const getConversationDetails = async (req, res) => {
  try {
    const id = conversationId(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format",
      });
    }

    const hasAccess = await chatService.verifyConversationAccess(
      id,
      req.user.id,
      req.user.role,
    );
    if (!hasAccess) {
      logger.warn(
        `[AUDIT] Unauthorized access attempt: User ${req.user.id} tried to access conversation ${id}`,
      );
      return res.status(403).json({
        success: false,
        message:
          "Access forbidden: You don't have permission to view this conversation",
      });
    }

    // The page the caller asked for. `getConversationMessages` has taken a
    // limit and an offset from the start; this handler passed neither, so a
    // conversation longer than fifty messages could not be read past its
    // first page from anywhere.
    const limit = safeNumber(req.query.limit, 50);
    const offset = safeNumber(req.query.offset, 0);

    const result = await chatService.getConversationMessages(id, limit, offset);

    res.set("Cache-Control", "private, max-age=60");

    // `messages` at the top level as well as under `data`.
    //
    // The chat widget reads `res.messages` (frontend/scripts/chat-widget.js),
    // so it saw `undefined.length` and threw into its own catch on every open
    // -- the history simply never appeared. Both shapes are served rather than
    // breaking the widget in a change about conversation ids.
    res.status(200).json({
      success: true,
      data: result,
      messages: result.messages,
      total: result.total,
      conversationId: id,
    });
  } catch (error) {
    console.error("GET CONVERSATION DETAILS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch conversation details",
    });
  }
};

const updateStatus = async (req, res) => {
  try {
    const id = conversationId(req.params.id);
    const { status } = req.body;

    const validStatuses = ["open", "pending", "closed", "archived"];
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${validStatuses.join(", ")}`,
      });
    }

    logger.info(
      `[AUDIT] User ${req.user.id} updated conversation ${id} status to ${status} at ${new Date().toISOString()}`,
    );

    await chatService.updateConversationStatus(id, status);

    res.set("Cache-Control", "no-store, no-cache, must-revalidate");

    res.status(200).json({
      success: true,
      message: `Conversation status updated to ${status}`,
      data: { id, status, updatedAt: new Date().toISOString() },
    });
  } catch (error) {
    console.error("UPDATE CONV STATUS ERROR:", error);

    if (error.message === "Conversation not found") {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update conversation status"
    });
  }
};

const assignAdmin = async (req, res) => {
  try {
    const id = conversationId(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

    if (!hasPermission(req.user, PERMISSIONS.CHAT_MANAGE)) {
      logger.warn(
        `[AUDIT] Unauthorized assignment attempt: User ${req.user.id} (${req.user.role}) tried to assign conversation ${id}`,
      );
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Only admins can assign conversations",
      });
    }

    logger.info(
      `[AUDIT] User ${req.user.id} (Admin) assigned conversation ${id} at ${new Date().toISOString()}`,
    );

    await chatService.assignConversation(id, req.user.id);

    res.set("Cache-Control", "no-store, no-cache, must-revalidate");

    res.status(200).json({
      success: true,
      message: "Conversation assigned successfully",
      data: {
        conversationId: id,
        assignedBy: req.user.id,
        assignedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("ASSIGN CONV ERROR:", error);

    if (error.message === "Conversation not found") {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to assign conversation",
    });
  }
};

/**
 * GET /api/chat/unread-count
 *
 * How many messages are waiting for the caller. `chatService.getUnreadCount`
 * has existed since the chat was written and nothing served it -- the widget
 * asks for this path on every page load and has always got a 404, so the
 * badge never appeared.
 *
 * Scoped to `req.user.id`. The count is a fact about the caller's own inbox,
 * and a `userId` parameter here would be an endpoint for reading how much
 * unread mail somebody else has.
 */
const getUnreadCount = async (req, res) => {
  try {
    const scopedConversation = req.query.conversationId
      ? conversationId(req.query.conversationId)
      : null;

    if (req.query.conversationId && !scopedConversation) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

    if (scopedConversation) {
      const hasAccess = await chatService.verifyConversationAccess(
        scopedConversation,
        req.user.id,
        req.user.role,
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message:
            "Access forbidden: You don't have permission to view this conversation",
        });
      }
    }

    const count = await chatService.getUnreadCount(
      req.user.id,
      scopedConversation,
    );

    res.set("Cache-Control", "no-store, no-cache, must-revalidate");

    res.status(200).json({
      success: true,
      count,
      data: { count },
    });
  } catch (error) {
    console.error("GET UNREAD COUNT ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get unread count",
    });
  }
};

const getConnectionTelemetry = async (req, res) => {
  try {
    const activeConnections = await chatService.getActiveConnections();
    const totalConnections = await chatService.getTotalConnectionCount();
    
    res.status(200).json({
      success: true,
      data: {
        active: activeConnections,
        totalSockets: activeConnections.reduce((sum, c) => sum + c.socketCount, 0),
        lifetime: totalConnections,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("GET CONNECTION TELEMETRY ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get connection telemetry"
    });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const stats = await chatService.getDashboardStats();
    res.status(200).json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("GET DASHBOARD STATS ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get dashboard stats"
    });
  }
};

module.exports = {
  getConversations,
  getConversationDetails,
  getUnreadCount,
  updateStatus,
  assignAdmin,
  getConnectionTelemetry,
  getDashboardStats
};