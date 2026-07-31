// backend/modules/core/domainEventBus.js
const EventEmitter = require('events');

class DomainEventBus extends EventEmitter {
    constructor() {
        super();
        this.eventHandlers = new Map();
        this.eventHistory = [];
        this.isPublishing = false;
    }

    /**
     * Register a handler for an event
     */
    subscribe(eventName, handler, context = {}) {
        if (!this.eventHandlers.has(eventName)) {
            this.eventHandlers.set(eventName, []);
        }

        const subscription = {
            handler,
            context,
            id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
        };

        this.eventHandlers.get(eventName).push(subscription);

        this.on(eventName, async (data) => {
            try {
                await handler(data, context);
            } catch (error) {
                console.error(`Event handler error for ${eventName}:`, error);
                this.emit('handler.error', { eventName, error, subscription });
            }
        });

        return subscription;
    }

    /**
     * Publish an event
     */
    async publish(eventName, data, metadata = {}) {
        const event = {
            id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            name: eventName,
            data,
            metadata: {
                ...metadata,
                timestamp: new Date().toISOString(),
                source: metadata.source || 'application'
            },
            publishedAt: new Date().toISOString(),
            processed: false
        };

        this.eventHistory.push(event);

        // Emit event synchronously
        this.emit(eventName, data);
        this.emit('event.published', event);

        return event;
    }

    /**
     * Get event history
     */
    getEventHistory(filters = {}) {
        let events = this.eventHistory;

        if (filters.eventName) {
            events = events.filter(e => e.name === filters.eventName);
        }

        if (filters.fromDate) {
            events = events.filter(e => e.publishedAt >= filters.fromDate);
        }

        if (filters.toDate) {
            events = events.filter(e => e.publishedAt <= filters.toDate);
        }

        return events.slice(-100);
    }

    /**
     * Clear event history
     */
    clearHistory() {
        this.eventHistory = [];
    }

    /**
     * Get statistics
     */
    getStatistics() {
        const eventCounts = {};
        for (const event of this.eventHistory) {
            eventCounts[event.name] = (eventCounts[event.name] || 0) + 1;
        }

        return {
            totalEvents: this.eventHistory.length,
            eventCounts,
            subscribers: this.eventHandlers.size,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = { DomainEventBus };