// backend/modules/core/entity.js
class Entity {
    constructor(id) {
        this.id = id;
        this.createdAt = new Date().toISOString();
        this.updatedAt = new Date().toISOString();
        this._isDeleted = false;
    }

    /**
     * Check if entity is deleted
     */
    isDeleted() {
        return this._isDeleted;
    }

    /**
     * Mark entity as deleted
     */
    delete() {
        this._isDeleted = true;
        this.updatedAt = new Date().toISOString();
    }

    /**
     * Get entity identifier
     */
    getId() {
        return this.id;
    }

    /**
     * Compare two entities
     */
    equals(other) {
        if (!other) return false;
        if (!(other instanceof Entity)) return false;
        return this.id === other.id && this.constructor.name === other.constructor.name;
    }

    /**
     * Update timestamp
     */
    touch() {
        this.updatedAt = new Date().toISOString();
    }
}

module.exports = { Entity };