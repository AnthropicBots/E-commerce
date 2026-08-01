// backend/routes/refundRoutes.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const { ROLES } = require("../config/policy");
const refundController = require("../controllers/refundController");

// ==================== CUSTOMER ROUTES ====================

// Submit a return/refund request for a delivered order item
router.post("/request", authMiddleware, refundController.createRequest);

// List the authenticated user's own return requests
router.get("/mine", authMiddleware, refundController.listMyRequests);

// ==================== ADMIN ROUTES ====================

// List all return requests (optionally filtered by ?status=)
router.get("/", authMiddleware, authorizeRoles(ROLES.ADMIN), refundController.listAll);

// Approve a request and restock inventory
router.post(
    "/:id/approve",
    authMiddleware,
    authorizeRoles(ROLES.ADMIN),
    refundController.approveRequest
);

// Reject a request
router.post(
    "/:id/reject",
    authMiddleware,
    authorizeRoles(ROLES.ADMIN),
    refundController.rejectRequest
);

module.exports = router;
