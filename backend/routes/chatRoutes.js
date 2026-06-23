const express = require("express");
const router = express.Router();
const { authMiddleware, authorizeRoles } = require("../middleware/authMiddleware");
const { getConversations, getConversationDetails, updateStatus, assignAdmin } = require("../controllers/chat.controller");

// Require auth for all chat routes
router.use(authMiddleware);

// Admin-only routes
router.get("/conversations", authorizeRoles("admin"), getConversations);
router.patch("/conversations/:id/status", authorizeRoles("admin"), updateStatus);
router.patch("/conversations/:id/assign", authorizeRoles("admin"), assignAdmin);

// Accessible by admin or the owner customer
router.get("/conversations/:id", getConversationDetails);

module.exports = router;
