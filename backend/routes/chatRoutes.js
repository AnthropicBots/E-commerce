const express = require("express");
const router = express.Router();
const { authMiddleware, authorizeRoles } = require("../middleware/authMiddleware");
const { getConversations, getConversationDetails, updateStatus, assignAdmin } = require("../controllers/chat.controller");

// Admin only routes
router.use(authMiddleware);
router.use(authorizeRoles("admin"));

router.get("/conversations", getConversations);
router.get("/conversations/:id", getConversationDetails);
router.patch("/conversations/:id/status", updateStatus);
router.patch("/conversations/:id/assign", assignAdmin);

module.exports = router;
