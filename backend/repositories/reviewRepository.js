// backend/repositories/reviewRepository.js
const BaseRepository = require('./baseRepository');

const TABLE = 'reviews';
const LIVE = 'deleted_at IS NULL';

class ReviewRepository extends BaseRepository {
    constructor() {
        super(TABLE, 'id', { softDeleteColumn: 'deleted_at' });
    }

    /**
     * Create a review
     * @param {Object} reviewData
     * @returns {Promise<Object>} Created review record
     */
    async create({ productId, userId, rating, comment, title = null, images = null, isVerified = 0 }) {
        const numRating = Math.max(1, Math.min(5, Number(rating) || 5));
        const jsonImages = Array.isArray(images) ? JSON.stringify(images) : (typeof images === 'string' ? images : null);

        const [result] = await this.db.query(
            `INSERT INTO ${this.tableName} (product_id, user_id, rating, title, comment, images, is_verified, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [productId, userId, numRating, title, comment, jsonImages, isVerified ? 1 : 0]
        );

        return this.findById(result.insertId);
    }

    /**
     * Find review by ID
     * @param {number|string} id
     * @returns {Promise<Object|null>}
     */
    async findById(id) {
        const [rows] = await this.db.query(
            `SELECT r.*, u.name as user_name
             FROM ${this.tableName} r
             LEFT JOIN users u ON r.user_id = u.id
             WHERE r.id = ? AND r.${LIVE}`,
            [id]
        );
        return rows[0] || null;
    }

    /**
     * Find reviews by product ID
     *
     * Visibility is decided by `moderation_status`, not by `is_approved`.
     * `0026_review_moderation.sql` made the status the authority and kept the
     * boolean only so a legacy reader still saw something sensible; every
     * other reader in the codebase filters on the status -- reviewController
     * and reviewModerationService alike. Two readers of one table disagreeing
     * about which column decides what the public sees is the defect, whichever
     * way they happen to agree today (#1653).
     *
     * @param {string} productId
     * @param {Object} options
     * @returns {Promise<Object[]>}
     */
    async findByProduct(productId, { page = 1, limit = 20 } = {}) {
        const offset = Math.max(0, (page - 1) * limit);
        const [rows] = await this.db.query(
            `SELECT r.*, u.name as user_name
             FROM ${this.tableName} r
             LEFT JOIN users u ON r.user_id = u.id
             WHERE r.product_id = ? AND r.${LIVE} AND r.moderation_status = 'approved'
             ORDER BY r.created_at DESC
             LIMIT ? OFFSET ?`,
            [productId, Number(limit), Number(offset)]
        );
        return rows;
    }

    /**
     * Find reviews by user ID
     * @param {string} userId
     * @param {Object} options
     * @returns {Promise<Object[]>}
     */
    async findByUser(userId, { page = 1, limit = 20 } = {}) {
        const offset = Math.max(0, (page - 1) * limit);
        const [rows] = await this.db.query(
            `SELECT r.*, p.name as product_name
             FROM ${this.tableName} r
             LEFT JOIN products p ON r.product_id = p.id
             WHERE r.user_id = ? AND r.${LIVE}
             ORDER BY r.created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, Number(limit), Number(offset)]
        );
        return rows;
    }

    /**
     * Update review
     * @param {number|string} id
     * @param {Object} data
     * @returns {Promise<Object|null>}
     */
    async update(id, data) {
        const fields = [];
        const values = [];

        if (data.rating !== undefined) {
            fields.push('rating = ?');
            values.push(Math.max(1, Math.min(5, Number(data.rating) || 5)));
        }
        if (data.comment !== undefined) {
            fields.push('comment = ?');
            values.push(data.comment);
        }
        if (data.title !== undefined) {
            fields.push('title = ?');
            values.push(data.title);
        }
        if (data.images !== undefined) {
            fields.push('images = ?');
            values.push(Array.isArray(data.images) ? JSON.stringify(data.images) : data.images);
        }

        if (!fields.length) {
            return this.findById(id);
        }

        fields.push('updated_at = NOW()');
        values.push(id);

        await this.db.query(
            `UPDATE ${this.tableName} SET ${fields.join(', ')} WHERE id = ? AND ${LIVE}`,
            values
        );

        return this.findById(id);
    }

    /**
     * Delete (soft-delete) review
     * @param {number|string} id
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        const [result] = await this.db.query(
            `UPDATE ${this.tableName} SET deleted_at = NOW() WHERE id = ? AND ${LIVE}`,
            [id]
        );
        return result.affectedRows > 0;
    }
}

module.exports = new ReviewRepository();
