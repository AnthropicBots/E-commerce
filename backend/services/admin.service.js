const db = require("../config/db");
const { safeArray, safeNumber, sanitizeString } = require("../utils/helpers");

const logAudit = async (connection, adminId, targetUserId, action, metadata, ip, userAgent) => {
    const query = `
        INSERT INTO user_audit_logs (admin_id, target_user_id, action, metadata, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    await connection.query(query, [adminId, targetUserId, action, JSON.stringify(metadata || {}), ip, userAgent]);
};

const getDashboardStats = async () => {
    // Collect basic statistics
    const [userStats] = await db.query(`
        SELECT 
            COUNT(*) as totalUsers,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeUsers,
            SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as blockedUsers,
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

    const [productStats] = await db.query(`SELECT COUNT(*) as totalProducts FROM products`);

    // Analytics: Revenue over the last 30 days (simplified)
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
            averageOrderValue: orderStats[0].totalOrders ? (orderStats[0].totalRevenue / orderStats[0].totalOrders).toFixed(2) : 0
        },
        charts: {
            revenue: safeArray(revenueAnalytics),
            orderStatus: safeArray(orderStatusDistribution)
        }
    };
};

const getUsers = async (filters, page, limit) => {
    const offset = (page - 1) * limit;
    let query = `SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE 1=1`;
    const params = [];

    if (filters.search) {
        query += ` AND (name LIKE ? OR email LIKE ?)`;
        params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    
    if (filters.status) {
        query += ` AND is_active = ?`;
        params.push(filters.status === 'active' ? 1 : 0);
    }

    if (filters.role) {
        query += ` AND role = ?`;
        params.push(filters.role);
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

const updateUserStatus = async (adminId, targetId, status, ip, userAgent) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        const [result] = await connection.query(`UPDATE users SET is_active = ? WHERE id = ?`, [status === 'active' ? 1 : 0, targetId]);
        
        if (result.affectedRows === 0) {
            throw new Error("User not found");
        }
        
        await logAudit(
            connection, 
            adminId, 
            targetId, 
            status === 'active' ? 'USER_UNBLOCKED' : 'USER_BLOCKED', 
            {}, 
            ip, 
            userAgent
        );

        await connection.commit();
        return true;
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
};

const bulkUpdateUserStatus = async (adminId, targetIds, status, ip, userAgent) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        if (safeArray(targetIds).length > 0) {
            const placeholders = targetIds.map(() => '?').join(',');
            const [result] = await connection.query(`UPDATE users SET is_active = ? WHERE id IN (${placeholders})`, [status === 'active' ? 1 : 0, ...targetIds]);
            
            if (result.affectedRows === 0) {
                throw new Error("No users found to update");
            }
            
            for (const id of targetIds) {
                await logAudit(
                    connection, 
                    adminId, 
                    id, 
                    status === 'active' ? 'BULK_UNBLOCK' : 'BULK_BLOCK', 
                    {}, 
                    ip, 
                    userAgent
                );
            }
        }

        await connection.commit();
        return true;
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
};

module.exports = {
    getDashboardStats,
    getUsers,
    updateUserStatus,
    bulkUpdateUserStatus
};
