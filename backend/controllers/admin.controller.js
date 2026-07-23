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


module.exports = {
    getDashboardStats,
    getUsers,
    updateUserStatus,
    bulkUpdateUserStatus,
    updateUserRole,
    bulkUpdateUserRole,
    deleteUser,
    verifyUserEmail,
    getAdminLogs
};