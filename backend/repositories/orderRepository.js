// backend/repositories/orderRepository.js
const BaseRepository = require('./baseRepository');

class OrderRepository extends BaseRepository {
    constructor() {
        super('orders', 'id');
    }

    /**
     * Find orders by user
     */
    async findByUser(userId, options = {}) {
        const { limit = 20, offset = 0, status } = options;

        let query = `SELECT * FROM ${this.tableName} WHERE user_id = ?`;
        const params = [userId];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [rows] = await this.db.query(query, params);
        return rows;
    }

    /**
     * Get order with items
     */
    async findWithItems(id) {
        const order = await this.findById(id);
        if (!order) return null;

        const [items] = await this.db.query(
            `SELECT oi.*, p.name as product_name, p.price as product_price
             FROM order_items oi
             LEFT JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [id]
        );

        return {
            ...order,
            items
        };
    }

    /**
     * Get orders by status
     */
    async findByStatus(status) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE status = ? ORDER BY created_at DESC`,
            [status]
        );

        return rows;
    }

    /**
     * Update order status
     */
    async updateStatus(id, status) {
        const [result] = await this.db.query(
            `UPDATE ${this.tableName} SET status = ?, updated_at = NOW() WHERE id = ?`,
            [status, id]
        );

        this.cache.delete(id);
        return result.affectedRows > 0;
    }

    /**
     * Get order statistics
     */
    async getStats(userId = null) {
        let query = `
            SELECT 
                COUNT(*) as total_orders,
                SUM(total_amount) as total_revenue,
                AVG(total_amount) as avg_order_value,
                MIN(total_amount) as min_order,
                MAX(total_amount) as max_order
            FROM ${this.tableName}
            WHERE status != 'cancelled'
        `;
        const params = [];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        const [rows] = await this.db.query(query, params);
        return rows[0] || null;
    }

    /**
     * Get recent orders
     */
    async getRecent(limit = 10) {
        const [rows] = await this.db.query(
            `SELECT o.*, u.name as user_name, u.email as user_email
             FROM ${this.tableName} o
             LEFT JOIN users u ON o.user_id = u.id
             ORDER BY o.created_at DESC
             LIMIT ?`,
            [limit]
        );

        return rows;
    }

    /**
     * Get orders by date range
     */
    async getByDateRange(startDate, endDate) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} 
             WHERE created_at BETWEEN ? AND ? 
             ORDER BY created_at DESC`,
            [startDate, endDate]
        );

        return rows;
    }

    /**
     * Cancel order
     */
    async cancel(id, reason) {
        const [result] = await this.db.query(
            `UPDATE ${this.tableName} 
             SET status = 'cancelled', 
                 cancellation_reason = ?,
                 cancelled_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?`,
            [reason, id]
        );

        this.cache.delete(id);
        return result.affectedRows > 0;
    }

    /**
     * Get pending orders
     */
    async getPending() {
        return this.findByStatus('pending');
    }

    /**
     * Get processing orders
     */
    async getProcessing() {
        return this.findByStatus('processing');
    }

    /**
     * Get completed orders
     */
    async getCompleted() {
        return this.findByStatus('completed');
    }
}

module.exports = new OrderRepository();