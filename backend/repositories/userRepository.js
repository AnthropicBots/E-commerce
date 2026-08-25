// backend/repositories/userRepository.js
const BaseRepository = require('./baseRepository');

// Accounts a read is allowed to see. `users.deleted_at` exists
// (0001_baseline_schema.sql:47) and nothing in this file consulted it, so a
// deactivated account was still searchable, still listed by role and still
// counted in the admin statistics (#1566).
const LIVE = 'deleted_at IS NULL';

// The profile fields `users` actually carries. `findWithProfile` used to read
// them from a `user_profiles` table that does not exist in any migration; these
// are the columns the same information is really stored in
// (0001_baseline_schema.sql:24-58).
const PROFILE_COLUMNS = Object.freeze([
    'avatar',
    'phone',
    'address',
    'city',
    'state',
    'zip',
    'country'
]);

/**
 * Escape the characters that are metacharacters inside a LIKE pattern.
 *
 * Parameterising the term stops injection but not this: `%` and `_` keep their
 * wildcard meaning once the driver has substituted the value, so an admin
 * searching users for `%` matched the entire table. Backslash first, or it
 * would escape the escapes added after it.
 *
 * @param {any} value
 * @returns {string}
 */
const escapeLike = (value) =>
    String(value ?? '').replace(/[\\%_]/g, (character) => `\\${character}`);

/**
 * Read an "is this account enabled" argument in the forms callers use.
 *
 * `updateStatus` was written against a `status` ENUM this schema never had, so
 * its existing callers pass strings. The column is `is_active TINYINT(1)`, and
 * both spellings map onto it cleanly. Anything that is neither is rejected
 * rather than silently coerced to 0, which would deactivate the account.
 *
 * @param {any} value
 * @returns {0|1}
 */
const toIsActive = (value) => {
    if (value === true || value === 1 || value === '1') return 1;
    if (value === false || value === 0 || value === '0') return 0;

    const text = String(value ?? '').trim().toLowerCase();

    if (text === 'active') return 1;
    if (text === 'inactive' || text === 'suspended' || text === 'disabled') return 0;

    throw new Error(
        `Unrecognised account status: ${JSON.stringify(value)}. `
        + `Expected a boolean, or one of "active", "inactive", "suspended", "disabled".`
    );
};

class UserRepository extends BaseRepository {
    constructor() {
        super('users', 'id', { softDeleteColumn: 'deleted_at' });
    }

    /**
     * Find user by email
     */
    async findByEmail(email) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE email = ? AND ${LIVE}`,
            [email]
        );

        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Find user with their profile fields.
     *
     * This used to read `SELECT * FROM user_profiles`, and there is no such
     * table in `migrations/` -- so the method threw `ER_NO_SUCH_TABLE` on every
     * call (#1566). The information it was reaching for is on `users` itself.
     *
     * The destructuring was wrong as well, and would have stayed wrong even
     * against a real table: `db.query()` resolves to `[rows, fields]`, so
     * `const [profile] = ...` bound `profile` to the rows *array*. `profile ||
     * null` then kept it, because `[]` is truthy -- reporting a user with no
     * profile as `profile: []` and one with a profile as `profile: [ {...} ]`.
     * Neither is an object a caller can read a phone number off.
     *
     * @param {string} id user UUID
     * @returns {Promise<object|null>} the user, with a `profile` object
     */
    async findWithProfile(id) {
        const user = await this.findById(id);
        if (!user) return null;

        const profile = {};

        for (const column of PROFILE_COLUMNS) {
            profile[column] = user[column] ?? null;
        }

        return {
            ...user,
            profile
        };
    }

    /**
     * Update last login
     */
    async updateLastLogin(id) {
        await this.db.query(
            `UPDATE ${this.tableName} SET last_login = NOW() WHERE id = ? AND ${LIVE}`,
            [id]
        );
        this.cache.delete(id);
    }

    /**
     * Get users who signed in within the last `days`.
     *
     * `users` has no `status` column -- the flag is `is_active TINYINT(1)`
     * (0001_baseline_schema.sql:37). `status = 'active'` threw
     * `ER_BAD_FIELD_ERROR` (#1566).
     *
     * @param {number} [days=30]
     * @returns {Promise<object[]>}
     */
    async getActive(days = 30) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName}
             WHERE last_login > DATE_SUB(NOW(), INTERVAL ? DAY)
               AND is_active = 1
               AND ${LIVE}`,
            [days]
        );

        return rows;
    }

    /**
     * Get user by role
     */
    async findByRole(role) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE role = ? AND ${LIVE}`,
            [role]
        );

        return rows;
    }

    /**
     * Enable or disable an account.
     *
     * Writes `is_active`, for the same reason as `getActive`. Callers written
     * against the imagined `status` ENUM keep working: "active" and
     * "inactive"/"suspended"/"disabled" both map onto the flag, and anything
     * unrecognised throws rather than being coerced to 0 -- silently
     * deactivating an account is the worst available reading of a typo.
     *
     * @param {string} id
     * @param {boolean|string} status
     * @returns {Promise<boolean>} whether a row changed
     */
    async updateStatus(id, status) {
        const isActive = toIsActive(status);

        const [result] = await this.db.query(
            `UPDATE ${this.tableName}
                SET is_active = ?, updated_at = NOW()
              WHERE id = ? AND ${LIVE}`,
            [isActive, id]
        );

        this.cache.delete(id);
        return result.affectedRows > 0;
    }

    /**
     * Get user statistics.
     *
     * `status` took the whole statement down, not just the one column it
     * appeared in, so this returned nothing at all rather than a partly wrong
     * figure (#1566).
     *
     * `logged_in_today` was `COUNT(DISTINCT last_login)`, which counts distinct
     * login *timestamps* across all time. `last_login` is a DATETIME stamped to
     * the second, so that was close to a plain row count and had no
     * relationship to today. It now counts accounts whose last sign-in was
     * today, which is what the column name claims.
     *
     * @returns {Promise<object|null>}
     */
    async getStats() {
        const [rows] = await this.db.query(
            `SELECT
                COUNT(*) as total_users,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users,
                SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
                SUM(CASE WHEN created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as new_users,
                SUM(CASE WHEN DATE(last_login) = CURDATE() THEN 1 ELSE 0 END) as logged_in_today
             FROM ${this.tableName}
             WHERE ${LIVE}`
        );

        return rows[0] || null;
    }

    /**
     * Search users by name or email.
     *
     * The term is escaped before it is wrapped in wildcards. Parameterising it
     * stops injection but not the wildcards themselves, which keep their
     * meaning inside the substituted value -- so an admin searching for `%`
     * listed every account in the store.
     *
     * @param {string} query
     * @param {{limit?: number, offset?: number}} [options]
     * @returns {Promise<object[]>}
     */
    async search(query, options = {}) {
        const { limit = 20, offset = 0 } = options;
        const term = `%${escapeLike(query)}%`;

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName}
             WHERE (name LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\')
               AND ${LIVE}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [term, term, limit, offset]
        );

        return rows;
    }
}

module.exports = new UserRepository();