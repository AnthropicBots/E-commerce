const express = require("express");
const router = express.Router();

const {
    getDashboardStats,
    getUsers,
    updateUserStatus,
    bulkUpdateUserStatus,
    updateUserRole,
    bulkUpdateUserRole,  
    deleteUser,
    getAdminLogs,
    verifyUserEmail,
    listErasureRequests,
    getErasureRequest,
    verifyErasureReceiptAdmin,
    startImpersonation,
    revokeImpersonation,
    listImpersonationAudit
} = require("../controllers/admin.controller");

const authMiddleware = require("../middleware/authMiddleware");
const { adminMiddleware } = require("../middleware/rbacMiddleware");
const { adminLimiter } = require("../middleware/authLimiter");

// Apply admin rate limiter
router.use(adminLimiter);

// Apply auth and admin middleware
router.use(authMiddleware);
router.use(adminMiddleware);

// ==================== DASHBOARD ====================
router.get("/dashboard", getDashboardStats);

// ==================== USER MANAGEMENT ====================
router.get("/users", getUsers);

router.patch("/users/:id/status", updateUserStatus);

router.post("/users/bulk-status", bulkUpdateUserStatus);

router.put("/users/:id/role", updateUserRole);


router.put("/users/bulk/role", bulkUpdateUserRole);

router.delete("/users/:id", deleteUser);

router.post("/users/verify-email", verifyUserEmail);

// ==================== ADMIN LOGS ====================
router.get("/logs", getAdminLogs);

// ==================== GDPR / DPDP ERASURE TRACKER (#1397) ====================
router.get("/erasure-requests", listErasureRequests);
router.get("/erasure-requests/:id", getErasureRequest);
router.get("/erasure-receipts/:receiptId", verifyErasureReceiptAdmin);

// ==================== IMPERSONATION (#1393) ====================
// Mint / revoke must be done as the real admin (not while already impersonating).
router.post("/impersonate", (req, res, next) => {
    if (req.user?.impersonation || req.impersonation) {
        return res.status(403).json({
            success: false,
            code: "NESTED_IMPERSONATION_FORBIDDEN",
            message: "End the current impersonation session before starting another"
        });
    }
    return startImpersonation(req, res, next);
});
router.post("/impersonate/revoke", revokeImpersonation);
router.get("/impersonate/audit", listImpersonationAudit);

module.exports = router;