const adminService = require("../services/admin.service");
const { safeArray, safeNumber, sanitizeString, getPagination, buildPaginationMeta } = require("../utils/helpers");

const getDashboardStats = async (req, res) => {
    try {
        const data = await adminService.getDashboardStats();
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("ADMIN DASHBOARD ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

const getUsers = async (req, res) => {
    try {
        const { page, limit } = getPagination(req.query.page, req.query.limit, 50);
        const filters = {
            search: sanitizeString(req.query.search),
            status: sanitizeString(req.query.status),
            role: sanitizeString(req.query.role)
        };

        const result = await adminService.getUsers(filters, page, limit);
        
        return res.status(200).json({
            success: true,
            users: result.users,
            ...buildPaginationMeta(result.total, page, limit)
        });
    } catch (error) {
        console.error("ADMIN GET USERS ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

const updateUserStatus = async (req, res) => {
    try {
        const targetId = safeNumber(req.params.id);
        const status = sanitizeString(req.body.status); // 'active' or 'blocked'
        
        if (!targetId || !['active', 'blocked'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid payload" });
        }

        if (targetId === req.user.id) {
            return res.status(400).json({ success: false, message: "Cannot modify own status" });
        }

        await adminService.updateUserStatus(req.user.id, targetId, status, req.ip, req.headers['user-agent']);
        return res.status(200).json({ success: true, message: `User ${status === 'active' ? 'unblocked' : 'blocked'} successfully` });
    } catch (error) {
        console.error("ADMIN UPDATE USER ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

const bulkUpdateUserStatus = async (req, res) => {
    try {
        const targetIds = safeArray(req.body.userIds).map(id => safeNumber(id)).filter(id => id > 0 && id !== req.user.id);
        const status = sanitizeString(req.body.status); // 'active' or 'blocked'
        
        if (!targetIds.length || !['active', 'blocked'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid payload or users" });
        }

        await adminService.bulkUpdateUserStatus(req.user.id, targetIds, status, req.ip, req.headers['user-agent']);
        return res.status(200).json({ success: true, message: `Users ${status === 'active' ? 'unblocked' : 'blocked'} successfully` });
    } catch (error) {
        console.error("ADMIN BULK UPDATE ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

module.exports = {
    getDashboardStats,
    getUsers,
    updateUserStatus,
    bulkUpdateUserStatus
};
