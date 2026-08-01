// backend/routes/refundRoutes.js — RMA FSM (#1389)
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const refundController = require("../controllers/refundController");

// ==================== CUSTOMER ROUTES ====================

router.get("/reason-codes", authMiddleware, refundController.getReasonCodes);

router.post("/request", authMiddleware, refundController.createRequest);

router.get("/mine", authMiddleware, refundController.listMyRequests);

router.get("/mine/:id", authMiddleware, refundController.getMyRequest);

router.post("/:id/in-transit", authMiddleware, refundController.markInTransit);

router.post("/:id/cancel", authMiddleware, refundController.cancelMyRequest);

// ==================== ADMIN ROUTES ====================

router.get("/", authMiddleware, authorizeRoles("admin"), refundController.listAll);

router.post(
    "/:id/approve",
    authMiddleware,
    authorizeRoles("admin"),
    refundController.approveRequest
);

router.post(
    "/:id/reject",
    authMiddleware,
    authorizeRoles("admin"),
    refundController.rejectRequest
);

router.post(
    "/:id/received",
    authMiddleware,
    authorizeRoles("admin"),
    refundController.markReceived
);

router.post(
    "/:id/refunded",
    authMiddleware,
    authorizeRoles("admin"),
    refundController.markRefunded
);

module.exports = router;
