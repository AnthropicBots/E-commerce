const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const { ROLES } = require("../config/policy");
const {
  getConversations,
  getConversationDetails,
  getUnreadCount,
  updateStatus,
  assignAdmin,
  getConnectionTelemetry,
  getDashboardStats
} = require("../controllers/chat.controller");

// Require auth for all chat routes
router.use(authMiddleware);

// Admin-only routes
router.get("/conversations", authorizeRoles(ROLES.ADMIN), getConversations);
router.patch("/conversations/:id/status", authorizeRoles(ROLES.ADMIN), updateStatus);
router.patch("/conversations/:id/assign", authorizeRoles(ROLES.ADMIN), assignAdmin);

// Support-desk telemetry. Both handlers were written and exported and neither
// had a route, so the numbers behind the desk existed with nothing able to
// read them.
router.get("/stats", authorizeRoles(ROLES.ADMIN), getDashboardStats);
router.get("/telemetry", authorizeRoles(ROLES.ADMIN), getConnectionTelemetry);

// How many messages are waiting for the caller.
//
// Any signed-in shopper's own count rather than an admin route: the chat
// widget on every page asks for this path, and nothing has ever served it, so
// the unread badge has never appeared for anybody.
router.get("/unread-count", getUnreadCount);

// Accessible by admin or the owner customer
router.get("/conversations/:id", getConversationDetails);

module.exports = router;
