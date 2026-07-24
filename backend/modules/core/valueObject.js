// backend/modules/core/valueObject.js
class ValueObject {
    constructor(data) {
        this._data = data || {};
        this._hash = this.generateHash();
    }

    /**
     * Get value
     */
    get(key, defaultValue = null) {
        return this._data[key] !== undefined ? this._data[key] : defaultValue;
    }

    /**
     * Get all values
     */
    getValue() {
        return { ...this._data };
    }

    /**
     * Check if value object is equal
     */
    equals(other) {
        if (!other) return false;
        if (!(other instanceof ValueObject)) return false;
        return this._hash === other._hash;
    }

    /**
     * Generate hash
     */
    generateHash() {
        const string = JSON.stringify(this._data);
        let hash = 0;
        for (let i = 0; i < string.length; i++) {
            const char = string.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    /**
     * To string
     */
    toString() {
        return JSON.stringify(this._data);
    }
}

module.exports = { ValueObject };