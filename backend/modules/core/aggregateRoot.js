// backend/modules/core/aggregateRoot.js
class AggregateRoot {
    constructor() {
        this.domainEvents = [];
        this.version = 0;
        this._isNew = true;
    }

    /**
     * Add a domain event
     */
    addDomainEvent(eventName, data) {
        this.domainEvents.push({
            name: eventName,
            data,
            timestamp: new Date().toISOString(),
            aggregateId: this.id,
            aggregateType: this.constructor.name
        });
    }

    /**
     * Get all domain events
     */
    getDomainEvents() {
        return this.domainEvents;
    }

    /**
     * Clear domain events
     */
    clearDomainEvents() {
        this.domainEvents = [];
    }

    /**
     * Mark aggregate as existing (not new)
     */
    markAsExisting() {
        this._isNew = false;
        this.version++;
    }

    /**
     * Check if aggregate is new
     */
    isNew() {
        return this._isNew;
    }

    /**
     * Increment version
     */
    incrementVersion() {
        this.version++;
    }
}

module.exports = { AggregateRoot };