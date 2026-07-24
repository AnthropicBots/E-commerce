const chatService = require("../services/chat.service");
const {
  getPagination,
  sanitizeString,
  safeNumber,
  safeUUID,
} = require("../utils/helpers");

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
    const id = safeUUID(req.params.id);
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
      console.log(
        `[AUDIT] Unauthorized access attempt: User ${req.user.id} tried to access conversation ${id}`,
      );
      return res.status(403).json({
        success: false,
        message:
          "Access forbidden: You don't have permission to view this conversation",
      });
    }

    const messages = await chatService.getConversationMessages(id);

    res.set("Cache-Control", "private, max-age=60");

    res.status(200).json({
      success: true,
      data: messages,
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
    const id = safeUUID(req.params.id);
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

    console.log(
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
    const id = safeUUID(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

    if (req.user.role !== "admin") {
      console.log(
        `[AUDIT] Unauthorized assignment attempt: User ${req.user.id} (${req.user.role}) tried to assign conversation ${id}`,
      );
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Only admins can assign conversations",
      });
    }

    console.log(
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

module.exports = {
  getConversations,
  getConversationDetails,
  updateStatus,
  assignAdmin,
};
