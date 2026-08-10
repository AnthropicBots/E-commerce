// backend/repositories/baseRepository.js
const db = require('../config/db').promise;
const { withTransaction } = require('../config/db');

/**
 * Base Repository class providing common CRUD operations
 */
class BaseRepository {
    /**
     * @param {string} tableName
     * @param {string} [primaryKey='id']
     * @param {object} [options]
     * @param {string|null} [options.softDeleteColumn=null]
     *   Column marking a row as deleted. When set, `delete()` stamps it instead
     *   of removing the row.
     *
     *   Declared explicitly rather than sniffed from the schema: a repository
     *   whose behaviour depends on whether a column happens to exist is a
     *   repository that silently changes behaviour when someone adds one.
     */
    constructor(tableName, primaryKey = 'id', { softDeleteColumn = null } = {}) {
        this.tableName = tableName;
        this.primaryKey = primaryKey;
        this.softDeleteColumn = softDeleteColumn;
        this.db = db;
        this.cache = new Map();
        this.cacheEnabled = true;
    }

    /**
     * Find by ID
     */
    async findById(id, options = {}) {
        const { useCache = true } = options;

        if (useCache && this.cacheEnabled) {
            const cached = this.cache.get(id);
            if (cached) {
                return cached;
            }
        }

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ?`,
            [id]
        );

        if (rows.length === 0) {
            return null;
        }

        const result = rows[0];

        if (this.cacheEnabled) {
            this.cache.set(id, result);
        }

        return result;
    }

    /**
     * Find all with optional filters
     */
    async findAll(filters = {}, options = {}) {
        const { limit = 100, offset = 0, orderBy = 'created_at DESC' } = options;

        let query = `SELECT * FROM ${this.tableName}`;
        const params = [];

        // Build WHERE clause
        const conditions = [];
        for (const [key, value] of Object.entries(filters)) {
            if (value !== undefined && value !== null) {
                conditions.push(`${key} = ?`);
                params.push(value);
            }
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [rows] = await this.db.query(query, params);
        return rows;
    }

    /**
     * Find one by filters
     */
    async findOne(filters = {}) {
        const [rows] = await this.findAll(filters, { limit: 1 });
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Create new record
     */
    async create(data) {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = columns.map(() => '?').join(',');

        const [result] = await this.db.query(
            `INSERT INTO ${this.tableName} (${columns.join(',')}) VALUES (${placeholders})`,
            values
        );

        const newRecord = await this.findById(result.insertId);
        
        if (this.cacheEnabled) {
            this.cache.set(newRecord[this.primaryKey], newRecord);
        }

        return newRecord;
    }

    /**
     * Update record by ID
     */
    async update(id, data) {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const setClause = columns.map(c => `${c} = ?`).join(',');

        await this.db.query(
            `UPDATE ${this.tableName} SET ${setClause} WHERE ${this.primaryKey} = ?`,
            [...values, id]
        );

        // Clear cache
        this.cache.delete(id);

        return this.findById(id);
    }

    /**
     * Delete record by ID.
     *
     * Soft when the repository declares a `softDeleteColumn`, hard otherwise.
     *
     * This is the second door onto the same problem as #1457: the controller's
     * `DELETE FROM products` was the visible one, but `productService.deleteProduct()`
     * reaches the row through here, so fixing only the controller would have
     * left the cascade -- fourteen tables off `products(id)`, plus `order_items`
     * and `refund_requests` nulled -- one method call away.
     *
     * Already-deleted rows are excluded so a repeat call reports `false`
     * rather than moving the timestamp forward and losing when the deletion
     * actually happened.
     *
     * @param {string|number} id
     * @returns {Promise<boolean>} whether a row changed.
     */
    async delete(id) {
        const [result] = this.softDeleteColumn
            ? await this.db.query(
                `UPDATE ${this.tableName}
                    SET ${this.softDeleteColumn} = NOW()
                  WHERE ${this.primaryKey} = ?
                    AND ${this.softDeleteColumn} IS NULL`,
                [id]
            )
            : await this.db.query(
                `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = ?`,
                [id]
            );

        this.cache.delete(id);

        return result.affectedRows > 0;
    }

    /**
     * Remove a row for good, cascades and all.
     *
     * Split out from `delete()` so that erasing a row is something a caller has
     * to ask for by name. `dataErasureService` is the legitimate case -- an
     * erasure request is supposed to destroy data.
     *
     * @param {string|number} id
     * @returns {Promise<boolean>}
     */
    async hardDelete(id) {
        const [result] = await this.db.query(
            `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = ?`,
            [id]
        );

        this.cache.delete(id);

        return result.affectedRows > 0;
    }

    /**
     * Count records
     */
    async count(filters = {}) {
        let query = `SELECT COUNT(*) as total FROM ${this.tableName}`;
        const params = [];

        const conditions = [];
        for (const [key, value] of Object.entries(filters)) {
            if (value !== undefined && value !== null) {
                conditions.push(`${key} = ?`);
                params.push(value);
            }
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        const [rows] = await this.db.query(query, params);
        return rows[0]?.total || 0;
    }

    /**
     * Check if record exists
     */
    async exists(id) {
        const count = await this.count({ [this.primaryKey]: id });
        return count > 0;
    }

    /**
     * Bulk create
     */
    async bulkCreate(dataArray) {
        if (dataArray.length === 0) return [];

        const results = [];
        for (const data of dataArray) {
            const result = await this.create(data);
            results.push(result);
        }

        return results;
    }

    /**
     * Bulk update
     */
    async bulkUpdate(updates) {
        const results = [];
        for (const { id, data } of updates) {
            const result = await this.update(id, data);
            results.push(result);
        }
        return results;
    }

    /**
     * Get paginated results
     */
    async paginate(filters = {}, options = {}) {
        const { page = 1, limit = 10, orderBy = 'created_at DESC' } = options;
        const offset = (page - 1) * limit;

        const data = await this.findAll(filters, { limit, offset, orderBy });
        const total = await this.count(filters);

        return {
            data,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
                hasNext: page * limit < total,
                hasPrev: page > 1
            }
        };
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Enable/disable cache
     */
    setCacheEnabled(enabled) {
        this.cacheEnabled = enabled;
        if (!enabled) {
            this.clearCache();
        }
    }

    /**
     * Run `fn` inside a transaction, committing on return and rolling back on
     * throw.
     *
     * `fn` is handed a repository bound to the transaction's own connection, so
     * calls made through it are part of the transaction; the outer repository
     * still talks to the pool and must not be used inside `fn`.
     *
     *     await orders.transaction(async (repo) => {
     *         const order = await repo.create({ ... });
     *         await repo.update(order.id, { ... });
     *     });
     */
    async transaction(fn) {
        return withTransaction(async (connection) => {
            const scoped = Object.create(this);
            scoped.db = connection;
            return fn(scoped);
        });
    }

    /**
     * Get table name
     */
    getTableName() {
        return this.tableName;
    }

    /**
     * Get primary key
     */
    getPrimaryKey() {
        return this.primaryKey;
    }
}

module.exports = BaseRepository;