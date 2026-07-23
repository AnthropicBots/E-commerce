// backend/repositories/wishlistRepository.js
const BaseRepository = require('./baseRepository');

class WishlistRepository extends BaseRepository {
    constructor() {
        super('wishlist', 'id');
    }

    /**
     * Get wishlist by user
     */
    async findByUser(userId) {
        const [rows] = await this.db.query(
            `SELECT w.*, p.name, p.price, p.image_url, p.stock
             FROM ${this.tableName} w
             LEFT JOIN products p ON w.product_id = p.id
             WHERE w.user_id = ?
             ORDER BY w.created_at DESC`,
            [userId]
        );

        return rows;
    }

    /**
     * Add to wishlist
     */
    async add(userId, productId) {
        // Check if already exists
        const [existing] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE user_id = ? AND product_id = ?`,
            [userId, productId]
        );

        if (existing.length > 0) {
            return existing[0];
        }

        const [result] = await this.db.query(
            `INSERT INTO ${this.tableName} (user_id, product_id, created_at) VALUES (?, ?, NOW())`,
            [userId, productId]
        );

        return this.findById(result.insertId);
    }

    /**
     * Remove from wishlist
     */
    async remove(userId, productId) {
        const [result] = await this.db.query(
            `DELETE FROM ${this.tableName} WHERE user_id = ? AND product_id = ?`,
            [userId, productId]
        );

        return result.affectedRows > 0;
    }

    /**
     * Check if in wishlist
     */
    async isInWishlist(userId, productId) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE user_id = ? AND product_id = ?`,
            [userId, productId]
        );

        return rows.length > 0;
    }

    /**
     * Clear user wishlist
     */
    async clear(userId) {
        const [result] = await this.db.query(
            `DELETE FROM ${this.tableName} WHERE user_id = ?`,
            [userId]
        );

        return result.affectedRows;
    }

    /**
     * Get wishlist count
     */
    async getCount(userId) {
        const [rows] = await this.db.query(
            `SELECT COUNT(*) as count FROM ${this.tableName} WHERE user_id = ?`,
            [userId]
        );

        return rows[0]?.count || 0;
    }

    /**
     * Get products in wishlist with details
     */
    async getProductsWithDetails(userId) {
        const [rows] = await this.db.query(
            `SELECT 
                w.id as wishlist_id,
                w.created_at as added_at,
                p.*
             FROM ${this.tableName} w
             LEFT JOIN products p ON w.product_id = p.id
             WHERE w.user_id = ?
             ORDER BY w.created_at DESC`,
            [userId]
        );

        return rows;
    }
}

module.exports = new WishlistRepository();