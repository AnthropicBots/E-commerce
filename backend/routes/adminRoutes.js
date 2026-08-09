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
    verifyErasureReceiptAdmin
} = require("../controllers/admin.controller");

const authMiddleware = require("../middleware/authMiddleware");
const { adminMiddleware } = require("../middleware/rbacMiddleware");
const { adminLimiter } = require("../middleware/authLimiter");
const {
    validateUpdateUserStatus,
    validateBulkUpdateUserStatus,
    validateUpdateUserRole,
    validateBulkUpdateUserRole,
    validateDeleteUser,
    validateVerifyUserEmail
} = require("../validators/adminValidator");


// Apply admin rate limiter
router.use(adminLimiter);

// Apply auth and admin middleware
router.use(authMiddleware);
router.use(adminMiddleware);

// ==================== DASHBOARD ====================
router.get("/dashboard", getDashboardStats);

// ==================== USER MANAGEMENT ====================
router.get("/users", getUsers);

router.patch("/users/:id/status", validateUpdateUserStatus, updateUserStatus);

router.post("/users/bulk-status", validateBulkUpdateUserStatus, bulkUpdateUserStatus);

router.put("/users/:id/role", validateUpdateUserRole, updateUserRole);

router.put("/users/bulk/role", validateBulkUpdateUserRole, bulkUpdateUserRole);

router.delete("/users/:id", validateDeleteUser, deleteUser);

router.post("/users/verify-email", validateVerifyUserEmail, verifyUserEmail);

// ==================== ADMIN LOGS ====================
router.get("/logs", getAdminLogs);

// ==================== GDPR / DPDP ERASURE TRACKER (#1397) ====================
router.get("/erasure-requests", listErasureRequests);
router.get("/erasure-requests/:id", getErasureRequest);
router.get("/erasure-receipts/:receiptId", verifyErasureReceiptAdmin);

module.exports = router;