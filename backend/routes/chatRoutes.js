const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const { ROLES } = require("../config/policy");
const { getConversations, getConversationDetails, updateStatus, assignAdmin } = require("../controllers/chat.controller");

// Require auth for all chat routes
router.use(authMiddleware);

// Admin-only routes
router.get("/conversations", authorizeRoles(ROLES.ADMIN), getConversations);
router.patch("/conversations/:id/status", authorizeRoles(ROLES.ADMIN), updateStatus);
router.patch("/conversations/:id/assign", authorizeRoles(ROLES.ADMIN), assignAdmin);

// Accessible by admin or the owner customer
router.get("/conversations/:id", getConversationDetails);

module.exports = router;
