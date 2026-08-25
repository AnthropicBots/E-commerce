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

// Support queue (#1495). The contact form has been writing to
// contact_messages since #1445; nothing has ever read the table.
const {
    listContactMessages,
    getContactMessage,
    updateContactMessageStatus,
    getContactMessageSummary
} = require("../controllers/adminContactController");

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

// ==================== EMAIL LOGS ====================
const emailService = require('../services/emailService');
router.get("/email-logs", async (req, res) => {
    try {
        const logs = await emailService.getEmailLogs(req.query.limit || 50);
        return res.status(200).json({
            success: true,
            data: { logs }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to retrieve email logs"
        });
    }
});

// ==================== GDPR / DPDP ERASURE TRACKER (#1397) ====================
router.get("/erasure-requests", listErasureRequests);
router.get("/erasure-requests/:id", getErasureRequest);
router.get("/erasure-receipts/:receiptId", verifyErasureReceiptAdmin);

// ==================== SUPPORT QUEUE (#1495) ====================
//
// Every route on this router already has `adminLimiter`, `authMiddleware` and
// `adminMiddleware` applied above, so these inherit them rather than restating
// them -- which is the point of mounting the queue here instead of giving it a
// router of its own.
//
// "/summary" is declared BEFORE "/:id". Express matches in declaration order,
// and the id guard would otherwise reject "summary" as an invalid id.
router.get("/contact-messages/summary", getContactMessageSummary);
router.get("/contact-messages", listContactMessages);
router.get("/contact-messages/:id", getContactMessage);
router.patch("/contact-messages/:id/status", updateContactMessageStatus);

module.exports = router;