// backend/modules/core/domainService.js
const { DomainEventBus } = require('./domainEventBus');

class DomainService {
    constructor() {
        this.eventBus = new DomainEventBus();
    }

    /**
     * Publish event
     */
    publishEvent(eventName, data, metadata = {}) {
        return this.eventBus.publish(eventName, data, metadata);
    }

    /**
     * Subscribe to event
     */
    subscribe(eventName, handler, context = {}) {
        return this.eventBus.subscribe(eventName, handler, context);
    }

    /**
     * Validate business rule
     */
    validate(rule, data, errorMessage) {
        if (!rule(data)) {
            throw new Error(errorMessage);
        }
        return true;
    }

    /**
     * Generate ID
     */
    generateId(prefix = '') {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 6);
        return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
    }

    /**
     * Calculate business metrics
     */
    calculateMetrics(data, formula) {
        return formula(data);
    }
}

module.exports = { DomainService };