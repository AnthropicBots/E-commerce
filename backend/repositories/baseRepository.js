// backend/repositories/baseRepository.js
const db = require('../config/db').promise;
const { withTransaction } = require('../config/db');

// How many rows one repository will hold in its identity cache, and for how
// long. Both are bounded because `repositories/index.js` exports these classes
// as singletons: the instance lives as long as the process, so an unbounded map
// is a leak that grows with traffic, and an entry with no expiry is served
// until something happens to write through this same instance -- which a second
// app instance, a migration or a raw `db.query` never does.
const DEFAULT_CACHE_MAX_ENTRIES = 500;
const DEFAULT_CACHE_TTL_MS = 30 * 1000;

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
     * @param {number} [options.cacheMaxEntries=500] rows held by `findById`
     * @param {number} [options.cacheTtlMs=30000] how long an entry stays usable
     */
    constructor(
        tableName,
        primaryKey = 'id',
        {
            softDeleteColumn = null,
            cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
            cacheTtlMs = DEFAULT_CACHE_TTL_MS
        } = {}
    ) {
        this.tableName = tableName;
        this.primaryKey = primaryKey;
        this.softDeleteColumn = softDeleteColumn;
        this.db = db;
        // Still a Map, and still keyed by primary key, because every subclass
        // reaches into it directly with `this.cache.delete(id)` after a write.
        // What changed is what the values are: `{ row, expiresAt }` rather than
        // the row itself.
        this.cache = new Map();
        this.cacheEnabled = true;
        this.cacheMaxEntries = Math.max(0, Number(cacheMaxEntries) || 0);
        this.cacheTtlMs = Math.max(0, Number(cacheTtlMs) || 0);
    }

    /**
     * Read a row back out of the identity cache, honouring its expiry.
     *
     * An expired entry is dropped rather than merely ignored, so a key that is
     * looked up and never written again does not sit in the map for good.
     *
     * @param {string|number} id
     * @returns {object|null}
     */
    _cacheGet(id) {
        const entry = this.cache.get(id);

        if (!entry) {
            return null;
        }

        if (entry.expiresAt <= Date.now()) {
            this.cache.delete(id);
            return null;
        }

        return entry.row;
    }

    /**
     * Put a row in the identity cache, evicting the oldest entries first.
     *
     * A Map iterates in insertion order, so the first key it yields is the
     * least recently *inserted* one. Re-inserting on every write keeps that
     * ordering meaningful.
     *
     * @param {string|number} id
     * @param {object} row
     */
    _cacheSet(id, row) {
        if (!this.cacheEnabled || this.cacheMaxEntries === 0 || row == null) {
            return;
        }

        // Delete first so a refreshed key moves to the back of the queue rather
        // than keeping its original position and being evicted early.
        this.cache.delete(id);
        this.cache.set(id, { row, expiresAt: Date.now() + this.cacheTtlMs });

        while (this.cache.size > this.cacheMaxEntries) {
            const oldest = this.cache.keys().next();

            if (oldest.done) break;

            this.cache.delete(oldest.value);
        }
    }

    /**
     * Find by ID
     */
    async findById(id, options = {}) {
        const { useCache = true } = options;

        if (useCache && this.cacheEnabled) {
            const cached = this._cacheGet(id);
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

        this._cacheSet(id, result);

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
     * Find one by filters.
     *
     * `findAll()` returns the rows array itself -- it has already unwrapped the
     * `[rows, fields]` tuple the driver resolves to. Destructuring it a second
     * time here bound `rows` to *element 0 of the row set*, which made this
     * method wrong in both directions and never right in either:
     *
     *   - a matching row bound `rows` to the row object, whose `.length` is
     *     `undefined`, so the guard failed and it returned `null`;
     *   - no matching row bound `rows` to `undefined`, so reading `.length`
     *     threw `TypeError` -- a 500 out of every route that asked whether
     *     something existed.
     *
     * So it returned nothing on a hit and threw on a miss. There is no input
     * for which the old body produced a record.
     *
     * @param {object} [filters] column => value equality filters
     * @returns {Promise<object|null>} the first matching row, or null
     */
    async findOne(filters = {}) {
        const rows = await this.findAll(filters, { limit: 1 });

        // `findAll` always resolves to an array, but a subclass that overrides
        // it might not; treating a non-array as "no match" keeps the contract
        // this method advertises rather than throwing on `.length`.
        if (!Array.isArray(rows) || rows.length === 0) {
            return null;
        }

        return rows[0];
    }

    /**
     * Create new record.
     *
     * An empty payload used to build `INSERT INTO t () VALUES ()`, which MySQL
     * rejects with `ER_PARSE_ERROR`. A handler that filters its request body
     * down to nothing is asking for a no-op, not for a syntax error, so it gets
     * one back by name.
     *
     * @param {object} data column => value
     * @returns {Promise<object|null>} the inserted row, reloaded
     */
    async create(data) {
        const payload = data && typeof data === 'object' ? data : {};
        const columns = Object.keys(payload);

        if (columns.length === 0) {
            throw new Error(
                `Cannot insert into ${this.tableName}: no columns were supplied.`
            );
        }

        const values = Object.values(payload);
        const placeholders = columns.map(() => '?').join(',');

        const [result] = await this.db.query(
            `INSERT INTO ${this.tableName} (${columns.join(',')}) VALUES (${placeholders})`,
            values
        );

        // `insertId` is 0 for the UUID-keyed tables in this schema (`products`,
        // `orders`, `users` are all CHAR(36)), so fall back to the key the
        // caller supplied. Reloading by 0 would return the wrong row or none.
        const insertedId = result && result.insertId
            ? result.insertId
            : payload[this.primaryKey];

        if (insertedId === undefined || insertedId === null) {
            return null;
        }

        const newRecord = await this.findById(insertedId, { useCache: false });

        if (newRecord) {
            this._cacheSet(newRecord[this.primaryKey], newRecord);
        }

        return newRecord;
    }

    /**
     * Update record by ID.
     *
     * As with `create`, an empty payload produced `UPDATE t SET  WHERE id = ?`
     * and an `ER_PARSE_ERROR`. Nothing to write is a no-op: the row is returned
     * unchanged and no statement is sent.
     *
     * @param {string|number} id
     * @param {object} data column => value
     * @returns {Promise<object|null>} the row after the write
     */
    async update(id, data) {
        const payload = data && typeof data === 'object' ? data : {};
        const columns = Object.keys(payload);

        if (columns.length === 0) {
            return this.findById(id, { useCache: false });
        }

        const values = Object.values(payload);
        const setClause = columns.map(c => `${c} = ?`).join(',');

        await this.db.query(
            `UPDATE ${this.tableName} SET ${setClause} WHERE ${this.primaryKey} = ?`,
            [...values, id]
        );

        // Clear cache
        this.cache.delete(id);

        // Read past the cache: the entry was just dropped, but a concurrent
        // `findById` between the write and this read could have repopulated it
        // with the pre-update row.
        return this.findById(id, { useCache: false });
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