const adminService = require("../services/admin.service");
const {
    safeArray,
    safeNumber,
    safeUUID,
    sanitizeString,
    getPagination,
    buildPaginationMeta
} = require("../utils/helpers");
const logger = require("../utils/logger");
const { validateUserStatus } = require("../utils/userStatusValidator");

const { validateDateRange } = require("../utils/dateRangeValidator");

// =====================
// DASHBOARD STATS
// =====================
const getDashboardStats = async (req, res) => {
    try {
        const data = await adminService.getDashboardStats();

        logger.info("Admin dashboard accessed", {
            adminId: req.user.id,
            email: req.user.email,
            ip: req.ip
        });

        return res.status(200).json({
            success: true,
            data
        });

    } catch (error) {
        logger.error("Admin dashboard error:", {
            error: error.message,
            adminId: req.user?.id,
            ip: req.ip
        });

        return res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard statistics"
        });
    }
};

// =====================
// GET USERS (WITH PAGINATION + FILTERS)
// =====================
const getUsers = async (req, res) => {
    try {
        const { page, limit } = getPagination(
            req.query.page,
            req.query.limit,
            50
        );

        const filters = {
            search: sanitizeString(req.query.search),
            status: sanitizeString(req.query.status),
            role: sanitizeString(req.query.role),
            emailVerified: req.query.emailVerified === 'true' ? true :
                req.query.emailVerified === 'false' ? false : undefined
        };

        const result = await adminService.getUsers(filters, page, limit);

        return res.status(200).json({
            success: true,
            users: result.users,
            ...buildPaginationMeta(result.total, page, limit)
        });

    } catch (error) {
        logger.error("Admin get users error:", {
            error: error.message,
            adminId: req.user?.id,
            query: req.query
        });

        return res.status(500).json({
            success: false,
            message: "Failed to fetch users"
        });
    }
};

// =====================
// UPDATE USER STATUS (SECURED)
// =====================
const updateUserStatus = async (req, res) => {
    try {
        const targetId = safeUUID(req.params.id);
        const status = sanitizeString(req.body.status);

        // validation
        // validation using helper
        if (!targetId) {
            return res.status(400).json({
                success: false,
                message: "Invalid payload. Target user ID is required."
            });
        }

        try {
            validateUserStatus(status);
        } catch (validationError) {
            return res.status(400).json({
                success: false,
                message: validationError.message
            });
        }

        // prevent self-action
        if (targetId === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "You cannot modify your own status"
            });
        }

        await adminService.updateUserStatus(
            req.user.id,
            targetId,
            status,
            req.ip,
            req.headers["user-agent"]
        );

        return res.status(200).json({
            success: true,
            message: `User ${status === "active" ? "activated" : status === "blocked" ? "blocked" : "deactivated"} successfully`
        });

    } catch (error) {
        logger.error("Admin update user status error:", {
            error: error.message,
            adminId: req.user?.id,
            targetId: req.params.id,
            ip: req.ip
        });

        return res.status(500).json({
            success: false,
            message: "Failed to update user status"
        });
    }
};

// =====================
// BULK UPDATE USER STATUS (SECURED)
// =====================
const bulkUpdateUserStatus = async (req, res) => {
    try {
        const targetIds = [
            ...new Set(
                safeArray(req.body.userIds)
                    .map(id => safeUUID(id))
                    .filter(id => id && id !== req.user.id)
            )
        ];

        const status = sanitizeString(req.body.status);

        if (!targetIds.length) {
            return res.status(400).json({
                success: false,
                message: "Invalid payload. Provide at least one valid user ID."
            });
        }

        try {
            validateUserStatus(status);
        } catch (validationError) {
            return res.status(400).json({
                success: false,
                message: validationError.message
            });
        }

        if (targetIds.length > 50) {
            return res.status(400).json({
                success: false,
                message: "Cannot update more than 50 users at once"
            });
        }

        const result = await adminService.bulkUpdateUserStatus(
            req.user.id,
            targetIds,
            status,
            req.ip,
            req.headers["user-agent"]
        );

        return res.status(200).json({
            success: true,
            message: `${result.updatedCount} users ${status === "active" ? "activated" : status === "blocked" ? "blocked" : "deactivated"} successfully`,
            data: {
                updatedCount: result.updatedCount,
                failedCount: result.failedCount || 0,
                status
            }
        });

    } catch (error) {
        logger.error("Admin bulk update error:", {
            error: error.message,
            adminId: req.user?.id,
            userIds: req.body.userIds,
            ip: req.ip
        });

        return res.status(500).json({
            success: false,
            message: "Failed to update users"
        });
    }
};

// =====================
// UPDATE USER ROLE
// =====================
const updateUserRole = async (req, res) => {
    try {
        const targetId = safeUUID(req.params.id);
        const role = sanitizeString(req.body.role);

        if (!targetId || !["user", "admin", "moderator"].includes(role)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payload. Role must be: user, admin, or moderator"
            });
        }

        // Prevent self role change
        if (targetId === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "You cannot change your own role"
            });
        }

        // Prevent downgrading the only super admin (if applicable)
        const result = await adminService.updateUserRole(
            req.user.id,
            targetId,
            role,
            req.ip,
            req.headers["user-agent"]
        );

        return res.status(200).json({
            success: true,
            message: "User role updated successfully",
            data: result
        });

    } catch (error) {
        logger.error("Admin update user role error:", {
            error: error.message,
            adminId: req.user?.id,
            targetId: req.params.id,
            ip: req.ip
        });

        if (error.message.includes("Cannot remove last admin")) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to update user role"
        });
    }
};

// =====================
// BULK UPDATE USER ROLE
// =====================
const bulkUpdateUserRole = async (req, res) => {
    try {
        const targetIds = safeArray(req.body.userIds)
            .map(id => safeUUID(id))
            .filter(id => id && id !== req.user.id);

        const role = sanitizeString(req.body.role);

        if (!targetIds.length || !["user", "admin", "moderator"].includes(role)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payload. Provide at least one valid user ID and valid role"
            });
        }

        if (targetIds.length > 30) {
            return res.status(400).json({
                success: false,
                message: "Cannot update more than 30 users at once"
            });
        }

        const result = await adminService.bulkUpdateUserRole(
            req.user.id,
            targetIds,
            role,
            req.ip,
            req.headers["user-agent"]
        );

        return res.status(200).json({
            success: true,
            message: `${result.updatedCount} users role updated to ${role}`,
            data: result
        });

    } catch (error) {
        logger.error("Admin bulk update role error:", {
            error: error.message,
            adminId: req.user?.id,
            userIds: req.body.userIds,
            ip: req.ip
        });

        return res.status(500).json({
            success: false,
            message: "Failed to update user roles"
        });
    }
};

// =====================
// DELETE USER
// =====================
const deleteUser = async (req, res) => {
    try {
        const targetId = safeUUID(req.params.id);
        const permanent = req.body.permanent === true;
        const reason = sanitizeString(req.body.reason) || "No reason provided";

        if (!targetId) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID"
            });
        }

        // Prevent self deletion
        if (targetId === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "You cannot delete your own account"
            });
        }

        const result = await adminService.deleteUser(
            req.user.id,
            targetId,
            permanent,
            reason,
            req.ip,
            req.headers["user-agent"]
        );

        return res.status(200).json({
            success: true,
            message: permanent ? "User permanently deleted" : "User soft deleted",
            data: result
        });

    } catch (error) {
        logger.error("Admin delete user error:", {
            error: error.message,
            adminId: req.user?.id,
            targetId: req.params.id,
            ip: req.ip
        });

        if (error.message.includes("Cannot delete")) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to delete user"
        });
    }
};

// =====================
// VERIFY USER EMAIL
// =====================
const verifyUserEmail = async (req, res) => {
    try {
        const { email, userId } = req.body;

        if (!email && !userId) {
            return res.status(400).json({
                success: false,
                message: "Either email or userId is required"
            });
        }

        const result = await adminService.verifyUserEmail(
            req.user.id,
            { email: sanitizeString(email), userId: userId ? safeUUID(userId) : undefined },
            req.ip,
            req.headers["user-agent"]
        );

        return res.status(200).json({
            success: true,
            message: "Email verified successfully",
            data: result
        });

    } catch (error) {
        logger.error("Admin verify email error:", {
            error: error.message,
            adminId: req.user?.id,
            email: req.body.email,
            userId: req.body.userId,
            ip: req.ip
        });

        if (error.message.includes("already verified")) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to verify email"
        });
    }
};

// =====================
// GET ADMIN LOGS
// =====================
const getAdminLogs = async (req, res) => {
    try {
        const { page, limit } = getPagination(
            req.query.page,
            req.query.limit,
            50
        );

        let startDate = req.query.startDate;
        let endDate = req.query.endDate;
        try {
            validateDateRange(startDate, endDate, { maxRangeDays: 365 });
        } catch (validationError) {
            return res.status(400).json({
                success: false,
                message: validationError.message
            });
        }

        const filters = {
            action: sanitizeString(req.query.action),
            userId: req.query.userId ? safeUUID(req.query.userId) : undefined,
            startDate: startDate,
            endDate: endDate
        };

        const result = await adminService.getAdminLogs(
            req.user.id,
            filters,
            page,
            limit
        );
        return res.status(200).json({
            success: true,
            logs: result.logs,
            ...buildPaginationMeta(result.total, page, limit)
        });

    } catch (error) {
        logger.error("Admin get logs error:", {
            error: error.message,
            adminId: req.user?.id,
            ip: req.ip
        });

        return res.status(500).json({
            success: false,
            message: "Failed to fetch admin logs"
        });
    }
};

// =====================
// GDPR / DPDP ERASURE TRACKER (#1397)
// =====================
const dataErasureService = require("../services/dataErasureService");

const listErasureRequests = async (req, res) => {
    try {
        const page = safeNumber(req.query.page) || 1;
        const limit = safeNumber(req.query.limit) || 20;
        const status = req.query.status ? sanitizeString(req.query.status) : null;

        const result = await dataErasureService.listErasureRequests({
            status,
            page,
            limit
        });

        return res.status(200).json({
            success: true,
            requests: result.requests,
            total: result.total,
            page: result.page,
            limit: result.limit
        });
    } catch (error) {
        logger.error("Admin list erasure requests error:", {
            error: error.message,
            adminId: req.user?.id
        });
        return res.status(500).json({
            success: false,
            message: "Failed to list erasure requests"
        });
    }
};

const getErasureRequest = async (req, res) => {
    try {
        const id = sanitizeString(req.params.id || "");
        const erasure = await dataErasureService.getErasureStatus(id, {
            asAdmin: true
        });
        return res.status(200).json({
            success: true,
            erasure
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            success: false,
            code: error.code || "ERASURE_ERROR",
            message: error.message || "Failed to fetch erasure request"
        });
    }
};

const verifyErasureReceiptAdmin = async (req, res) => {
    try {
        const receiptId = sanitizeString(req.params.receiptId || "");
        const receipt = await dataErasureService.verifyReceipt(receiptId);
        return res.status(200).json({
            success: true,
            receipt
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            success: false,
            code: error.code || "ERASURE_ERROR",
            message: error.message || "Failed to verify receipt"
        });
    }
};

// =====================
// ADMIN IMPERSONATION (#1393)
// =====================
const impersonationService = require("../services/impersonationService");

function adminClientMeta(req) {
    const ip =
        req.ip ||
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        null;
    const userAgent = req.headers["user-agent"] || "";
    return { ip, userAgent };
}

/**
 * POST /api/admin/impersonate
 * Body: { userId, reason, ticketId, ttlMinutes? }
 */
const startImpersonation = async (req, res) => {
    try {
        const { ip, userAgent } = adminClientMeta(req);
        const result = await impersonationService.mintImpersonationToken({
            actorAdmin: req.user,
            subjectUserId: req.body?.userId || req.body?.subjectUserId,
            reason: req.body?.reason,
            ticketId: req.body?.ticketId || req.body?.ticket,
            ttlMinutes: req.body?.ttlMinutes,
            ip,
            userAgent
        });

        logger.info("Admin impersonation minted", {
            adminId: result.actorAdminId,
            subjectUserId: result.subjectUserId,
            grantId: result.grantId,
            ticketId: result.ticketId
        });

        return res.status(201).json({
            success: true,
            message:
                "Impersonation token minted. Use as Bearer token; responses include X-Impersonating.",
            ...result
        });
    } catch (error) {
        logger.error("Admin impersonation mint error:", {
            error: error.message,
            adminId: req.user?.id
        });
        return res.status(error.status || 500).json({
            success: false,
            code: error.code || "IMPERSONATION_ERROR",
            message: error.message || "Failed to start impersonation"
        });
    }
};

/**
 * POST /api/admin/impersonate/revoke
 * Body: { grantId? , jti? }
 */
const revokeImpersonation = async (req, res) => {
    try {
        const { ip, userAgent } = adminClientMeta(req);
        const result = await impersonationService.revokeImpersonationGrant({
            grantId: req.body?.grantId,
            jti: req.body?.jti,
            revokedBy: req.user,
            ip,
            userAgent
        });

        return res.status(200).json({
            success: true,
            message: result.alreadyRevoked
                ? "Impersonation grant was already revoked"
                : "Impersonation grant revoked",
            ...result
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            code: error.code || "IMPERSONATION_ERROR",
            message: error.message || "Failed to revoke impersonation"
        });
    }
};

/**
 * GET /api/admin/impersonate/audit
 */
const listImpersonationAudit = async (req, res) => {
    try {
        const result = await impersonationService.listImpersonationAudit({
            grantId: req.query.grantId || null,
            actorAdminId: req.query.actorAdminId || null,
            subjectUserId: req.query.subjectUserId || null,
            page: req.query.page,
            limit: req.query.limit
        });

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        logger.error("Admin impersonation audit list error:", {
            error: error.message,
            adminId: req.user?.id
        });
        return res.status(500).json({
            success: false,
            message: "Failed to list impersonation audit"
        });
    }
};

/**
 * GET /api/admin/query-budget
 * Top SQL query-budget offenders + open circuits (#1391).
 */
const getQueryBudgetMetrics = async (req, res) => {
    try {
        const {
            getQueryBudgetMetrics: loadMetrics
        } = require("../middleware/queryBudgetMiddleware");
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const metrics = loadMetrics(limit);
        return res.status(200).json({
            success: true,
            message: "Query budget metrics",
            ...metrics
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to load query budget metrics"
        });
    }
};


module.exports = {
    getDashboardStats,
    getUsers,
    updateUserStatus,
    bulkUpdateUserStatus,
    updateUserRole,
    bulkUpdateUserRole,
    deleteUser,
    verifyUserEmail,
    getAdminLogs,
    listErasureRequests,
    getErasureRequest,
    verifyErasureReceiptAdmin,
    startImpersonation,
    revokeImpersonation,
    listImpersonationAudit,
    getQueryBudgetMetrics
};