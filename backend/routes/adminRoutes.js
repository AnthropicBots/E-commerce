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
    verifyUserEmail
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

module.exports = router;