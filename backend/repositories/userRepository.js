// backend/repositories/userRepository.js
const BaseRepository = require('./baseRepository');

class UserRepository extends BaseRepository {
    constructor() {
        super('users', 'id');
    }

    /**
     * Find user by email
     */
    async findByEmail(email) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE email = ?`,
            [email]
        );

        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Find user with profile
     */
    async findWithProfile(id) {
        const user = await this.findById(id);
        if (!user) return null;

        const [profile] = await this.db.query(
            `SELECT * FROM user_profiles WHERE user_id = ?`,
            [id]
        );

        return {
            ...user,
            profile: profile || null
        };
    }

    /**
     * Update last login
     */
    async updateLastLogin(id) {
        await this.db.query(
            `UPDATE ${this.tableName} SET last_login = NOW() WHERE id = ?`,
            [id]
        );
        this.cache.delete(id);
    }

    /**
     * Get active users
     */
    async getActive(days = 30) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} 
             WHERE last_login > DATE_SUB(NOW(), INTERVAL ? DAY)
             AND status = 'active'`,
            [days]
        );

        return rows;
    }

    /**
     * Get user by role
     */
    async findByRole(role) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE role = ?`,
            [role]
        );

        return rows;
    }

    /**
     * Update user status
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
     * Get user statistics
     */
    async getStats() {
        const [rows] = await this.db.query(
            `SELECT 
                COUNT(*) as total_users,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
                SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
                SUM(CASE WHEN created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as new_users,
                COUNT(DISTINCT last_login) as logged_in_today
             FROM ${this.tableName}`
        );

        return rows[0] || null;
    }

    /**
     * Search users
     */
    async search(query, options = {}) {
        const { limit = 20, offset = 0 } = options;

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} 
             WHERE name LIKE ? OR email LIKE ? 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [`%${query}%`, `%${query}%`, limit, offset]
        );

        return rows;
    }
}

module.exports = new UserRepository();