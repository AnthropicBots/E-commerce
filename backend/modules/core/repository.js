// backend/modules/core/repository.js
class Repository {
    constructor(db, tableName, entityClass) {
        this.db = db;
        this.tableName = tableName;
        this.entityClass = entityClass;
        this.cache = new Map();
        this.cacheEnabled = true;
    }

    /**
     * Save entity
     */
    async save(entity) {
        const data = { ...entity };
        delete data.domainEvents;

        if (entity.isNew()) {
            await this.insert(data);
            entity.markAsExisting();
        } else {
            await this.update(entity.id, data);
        }

        // Store in cache
        if (this.cacheEnabled) {
            this.cache.set(entity.id, entity);
        }

        // Publish domain events
        for (const event of entity.getDomainEvents()) {
            // Events would be published here
            console.log(`📢 Domain Event: ${event.name}`, event.data);
        }
        entity.clearDomainEvents();

        return entity;
    }

    /**
     * Insert entity
     */
    async insert(data) {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = columns.map(() => '?').join(',');

        await this.db.query(
            `INSERT INTO ${this.tableName} (${columns.join(',')}) VALUES (${placeholders})`,
            values
        );
    }

    /**
     * Update entity
     */
    async update(id, data) {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const setClause = columns.map(c => `${c} = ?`).join(',');

        await this.db.query(
            `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`,
            [...values, id]
        );
    }

    /**
     * Find by ID
     */
    async findById(id) {
        // Check cache
        if (this.cacheEnabled && this.cache.has(id)) {
            return this.cache.get(id);
        }

        const [results] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE id = ?`,
            [id]
        );

        if (results.length === 0) {
            return null;
        }

        const entity = new this.entityClass(results[0]);
        entity.markAsExisting();

        if (this.cacheEnabled) {
            this.cache.set(id, entity);
        }

        return entity;
    }

    /**
     * Find all
     */
    async findAll(filters = {}) {
        let query = `SELECT * FROM ${this.tableName}`;
        const params = [];

        const whereClauses = [];
        for (const [key, value] of Object.entries(filters)) {
            whereClauses.push(`${key} = ?`);
            params.push(value);
        }

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        const [results] = await this.db.query(query, params);
        return results.map(r => {
            const entity = new this.entityClass(r);
            entity.markAsExisting();
            return entity;
        });
    }

    /**
     * Delete entity
     */
    async delete(id) {
        await this.db.query(
            `DELETE FROM ${this.tableName} WHERE id = ?`,
            [id]
        );

        if (this.cacheEnabled) {
            this.cache.delete(id);
        }
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
}

module.exports = { Repository };