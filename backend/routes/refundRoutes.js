// backend/routes/refundRoutes.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const refundController = require("../controllers/refundController");

// ==================== CUSTOMER ROUTES ====================

// Submit a return/refund request for a delivered order item
router.post("/request", authMiddleware, refundController.createRequest);

// List the authenticated user's own return requests
router.get("/mine", authMiddleware, refundController.listMyRequests);

module.exports = router;
