const db = require("../config/db");
const { safeArray, safeNumber, sanitizeString } = require("../utils/helpers");
const logger = require("../utils/logger");

// =====================
// AUDIT LOG HELPER
// =====================
const logAudit = async (connection, adminId, targetUserId, action, metadata, ip, userAgent) => {
    const query = `
        INSERT INTO user_audit_logs (admin_id, target_user_id, action, metadata, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    await connection.query(query, [adminId, targetUserId, action, JSON.stringify(metadata || {}), ip, userAgent]);
};

// =====================
// DASHBOARD STATS
// =====================
const getDashboardStats = async () => {
    // Collect basic statistics
    const [userStats] = await db.query(`
        SELECT 
            COUNT(*) as totalUsers,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeUsers,
            SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as blockedUsers,
            SUM(CASE WHEN is_email_verified = 1 THEN 1 ELSE 0 END) as verifiedUsers,
            SUM(CASE WHEN is_email_verified = 0 THEN 1 ELSE 0 END) as unverifiedUsers,
            SUM(CASE WHEN MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE()) THEN 1 ELSE 0 END) as newUsersThisMonth
        FROM users
    `);

    const [orderStats] = await db.query(`
        SELECT 
            COUNT(*) as totalOrders,
            SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as completedOrders,
            SUM(CASE WHEN status = 'pending' OR status = 'processing' THEN 1 ELSE 0 END) as pendingOrders,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledOrders,
            SUM(final_amount) as totalRevenue,
            SUM(CASE WHEN MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE()) THEN final_amount ELSE 0 END) as revenueThisMonth
        FROM orders
    `);

    const [productStats] = await db.query(`
        SELECT COUNT(*) as totalProducts FROM products
    `);

    const [adminStats] = await db.query(`
        SELECT COUNT(*) as totalAdmins FROM users WHERE role IN ('admin', 'superadmin')
    `);

    // Analytics: Revenue over the last 30 days
    const [revenueAnalytics] = await db.query(`
        SELECT DATE(created_at) as date, SUM(final_amount) as revenue
        FROM orders
        WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date ASC
    `);

    // Order status distribution
    const [orderStatusDistribution] = await db.query(`
        SELECT status, COUNT(*) as count
        FROM orders
        GROUP BY status
    `);

    return {
        stats: {
            ...userStats[0],
            ...orderStats[0],
            totalProducts: productStats[0].totalProducts,
            totalAdmins: adminStats[0].totalAdmins,
            averageOrderValue: orderStats[0].totalOrders ? (orderStats[0].totalRevenue / orderStats[0].totalOrders).toFixed(2) : 0
        },
        charts: {
            revenue: safeArray(revenueAnalytics),
            orderStatus: safeArray(orderStatusDistribution)
        }
    };
};

// =====================
// GET USERS WITH FILTERS
// =====================
const getUsers = async (filters, page, limit) => {
    const offset = (page - 1) * limit;
    let query = `SELECT id, name, email, role, is_active, is_email_verified, created_at, updated_at FROM users WHERE 1=1`;
    const params = [];

    if (filters.search) {
        query += ` AND (name LIKE ? OR email LIKE ?)`;
        params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    
    if (filters.status) {
        if (filters.status === 'active') {
            query += ` AND is_active = 1`;
        } else if (filters.status === 'blocked') {
            query += ` AND is_active = 0`;
        } else if (filters.status === 'inactive') {
            query += ` AND is_active = 0`;
        }
    }

    if (filters.role) {
        query += ` AND role = ?`;
        params.push(filters.role);
    }

    if (filters.emailVerified !== undefined) {
        query += ` AND is_email_verified = ?`;
        params.push(filters.emailVerified ? 1 : 0);
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as t`;
    const [countResult] = await db.query(countQuery, params);

    // Apply pagination
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [users] = await db.query(query, params);

    return {
        users: safeArray(users),
        total: countResult[0].total,
        page,
        limit
    };
};

// =====================
// UPDATE SINGLE USER STATUS
// =====================
const updateUserStatus = async (adminId, targetId, status, ip, userAgent) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        // Check if user exists
        const [userCheck] = await connection.query(`SELECT id, is_active FROM users WHERE id = ?`, [targetId]);
        if (userCheck.length === 0) {
            throw new Error("User not found");
        }

        const oldStatus = userCheck[0].is_active;
        const newStatus = status === 'active' ? 1 : 0;
        
        const [result] = await connection.query(
            `UPDATE users SET is_active = ? WHERE id = ?`, 
            [newStatus, targetId]
        );
        
        if (result.affectedRows === 0) {
            throw new Error("Failed to update user status");
        }
        
        await logAudit(
            connection, 
            adminId, 
            targetId, 
            status === 'active' ? 'USER_UNBLOCKED' : 'USER_BLOCKED', 
            { oldStatus, newStatus, status },
            ip, 
            userAgent
        );

        await connection.commit();
        return { updated: true, userId: targetId, status };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
};

// =====================
// BULK UPDATE USER STATUS
// =====================
const bulkUpdateUserStatus = async (adminId, targetIds, status, ip, userAgent) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        if (safeArray(targetIds).length > 0) {
            const placeholders = targetIds.map(() => '?').join(',');
            const newStatus = status === 'active' ? 1 : 0;
            
            const [result] = await connection.query(
                `UPDATE users SET is_active = ? WHERE id IN (${placeholders})`, 
                [newStatus, ...targetIds]
            );
            
            if (result.affectedRows === 0) {
                throw new Error("No users found to update");
            }
            
            for (const id of targetIds) {
                await logAudit(
                    connection, 
                    adminId, 
                    id, 
                    status === 'active' ? 'BULK_UNBLOCK' : 'BULK_BLOCK', 
                    { status },
                    ip, 
                    userAgent
                );
            }
        }

        await connection.commit();
        return { requestedCount: targetIds.length, updatedCount: result.affectedRows };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
};

// =====================
// UPDATE USER ROLE
// =====================
const updateUserRole = async (adminId, targetId, role, ip, userAgent) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        // Check if user exists
        const [userCheck] = await connection.query(`SELECT id, role FROM users WHERE id = ?`, [targetId]);
        if (userCheck.length === 0) {
            throw new Error("User not found");
        }

        const oldRole = userCheck[0].role;

        // Prevent removing last admin
        if (oldRole === 'admin' && role !== 'admin') {
            const [adminCount] = await connection.query(
                `SELECT COUNT(*) as count FROM users WHERE role IN ('admin', 'superadmin')`
            );
            if (adminCount[0].count <= 1) {
                throw new Error("Cannot remove the last admin user");
            }
        }

        const [result] = await connection.query(
            `UPDATE users SET role = ? WHERE id = ?`, 
            [role, targetId]
        );
        
        if (result.affectedRows === 0) {
            throw new Error("Failed to update user role");
        }
        
        await logAudit(
            connection, 
            adminId, 
            targetId, 
            'UPDATE_USER_ROLE', 
            { oldRole, newRole: role },
            ip, 
            userAgent
        );

        await connection.commit();
        return { id: targetId, oldRole, newRole: role };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
};

// =====================
// BULK UPDATE USER ROLE
// =====================
const bulkUpdateUserRole = async (adminId, targetIds, role, ip, userAgent) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        if (safeArray(targetIds).length > 0) {
            // Check if any admin is being downgraded
            const [adminUsers] = await connection.query(
                `SELECT id FROM users WHERE id IN (${targetIds.map(() => '?').join(',')}) AND role IN ('admin', 'superadmin')`,
                targetIds
            );

            if (adminUsers.length > 0 && role !== 'admin') {
                const [totalAdmins] = await connection.query(
                    `SELECT COUNT(*) as count FROM users WHERE role IN ('admin', 'superadmin')`
                );
                if (totalAdmins[0].count <= adminUsers.length) {
                    throw new Error("Cannot downgrade all admin users");
                }
            }

            const placeholders = targetIds.map(() => '?').join(',');
            const [result] = await connection.query(
                `UPDATE users SET role = ? WHERE id IN (${placeholders})`, 
                [role, ...targetIds]
            );
            
            if (result.affectedRows === 0) {
                throw new Error("No users found to update");
            }
            
            for (const id of targetIds) {
                await logAudit(
                    connection, 
                    adminId, 
                    id, 
                    'BULK_UPDATE_USER_ROLE', 
                    { role },
                    ip, 
                    userAgent
                );
            }
        }

        await connection.commit();
        return { updatedCount: targetIds.length };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
};

// =====================
// DELETE USER
// =====================
const deleteUser = async (adminId, targetId, permanent, reason, ip, userAgent) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        // Check if user exists
        const [userCheck] = await connection.query(`SELECT id, role, is_active FROM users WHERE id = ?`, [targetId]);
        if (userCheck.length === 0) {
            throw new Error("User not found");
        }

        // Prevent deleting admin users
        if (userCheck[0].role === 'admin' || userCheck[0].role === 'superadmin') {
            throw new Error("Cannot delete admin users");
        }

        if (permanent) {
            await connection.query(`DELETE FROM users WHERE id = ?`, [targetId]);
            await logAudit(
                connection, adminId, targetId, 'PERMANENT_DELETE_USER',
                { reason, permanent: true }, ip, userAgent
            );
        } else {
            await connection.query(
                `UPDATE users SET is_active = 0, deleted_at = NOW(), delete_reason = ? WHERE id = ?`,
                [reason, targetId]
            );
            await logAudit(
                connection, adminId, targetId, 'SOFT_DELETE_USER',
                { reason, permanent: false }, ip, userAgent
            );
        }

        await connection.commit();
        return { id: targetId, permanent, reason };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
};

// =====================
// VERIFY USER EMAIL
// =====================
const verifyUserEmail = async (adminId, { email, userId }, ip, userAgent) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        let query = `SELECT id, email, is_email_verified FROM users WHERE `;
        const params = [];
        
        if (email) {
            query += `email = ?`;
            params.push(email);
        } else if (userId) {
            query += `id = ?`;
            params.push(userId);
        } else {
            throw new Error("Either email or userId is required");
        }
        
        const [userCheck] = await connection.query(query, params);
        if (userCheck.length === 0) {
            throw new Error("User not found");
        }

        if (userCheck[0].is_email_verified === 1) {
            throw new Error("Email is already verified");
        }

        await connection.query(
            `UPDATE users SET is_email_verified = 1 WHERE id = ?`,
            [userCheck[0].id]
        );
        
        await logAudit(
            connection, adminId, userCheck[0].id, 'VERIFY_USER_EMAIL',
            { email: userCheck[0].email }, ip, userAgent
        );

        await connection.commit();
        return { 
            id: userCheck[0].id, 
            email: userCheck[0].email, 
            isEmailVerified: true 
        };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
};

// =====================
// GET ADMIN LOGS
// =====================
const getAdminLogs = async (adminId, filters, page, limit) => {
    const offset = (page - 1) * limit;
    let query = `
        SELECT l.*, u.name as admin_name, u.email as admin_email
        FROM user_audit_logs l
        LEFT JOIN users u ON l.admin_id = u.id
        WHERE 1=1
    `;
    const params = [];

    if (filters.action) {
        query += ` AND l.action = ?`;
        params.push(filters.action);
    }

    if (filters.userId) {
        query += ` AND l.target_user_id = ?`;
        params.push(filters.userId);
    }

    if (filters.startDate) {
        query += ` AND l.created_at >= ?`;
        params.push(filters.startDate);
    }

    if (filters.endDate) {
        query += ` AND l.created_at <= ?`;
        params.push(filters.endDate + ' 23:59:59');
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as t`;
    const [countResult] = await db.query(countQuery, params);

    // Apply pagination
    query += ` ORDER BY l.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [logs] = await db.query(query, params);

    return {
        logs: safeArray(logs),
        total: countResult[0].total,
        page,
        limit
    };
};

// =====================
// EXPORTS
// =====================
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