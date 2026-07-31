// backend/services/domainEventService.js
const EventEmitter = require('events');
const db = require('../config/db').promise;

// ============================================
// DOMAIN EVENTS CONFIGURATION
// ============================================

const DOMAIN_EVENTS = {
    // Order events
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_COMPLETED: 'order.completed',
    ORDER_PAYMENT_SUCCESS: 'order.payment.success',
    ORDER_PAYMENT_FAILED: 'order.payment.failed',
    
    // Product events
    PRODUCT_VIEWED: 'product.viewed',
    PRODUCT_ADDED: 'product.added',
    PRODUCT_UPDATED: 'product.updated',
    PRODUCT_REMOVED: 'product.removed',
    PRODUCT_REVIEWED: 'product.reviewed',
    
    // Wishlist events
    WISHLIST_ITEM_ADDED: 'wishlist.item.added',
    WISHLIST_ITEM_REMOVED: 'wishlist.item.removed',
    
    // Cart events
    CART_ITEM_ADDED: 'cart.item.added',
    CART_ITEM_REMOVED: 'cart.item.removed',
    CART_CLEARED: 'cart.cleared',
    
    // User events
    USER_REGISTERED: 'user.registered',
    USER_LOGGED_IN: 'user.logged.in',
    USER_LOGGED_OUT: 'user.logged.out',
    USER_UPDATED: 'user.updated',
    
    // Payment events
    PAYMENT_INITIATED: 'payment.initiated',
    PAYMENT_COMPLETED: 'payment.completed',
    PAYMENT_REFUNDED: 'payment.refunded',
    
    // Promo events
    COUPON_APPLIED: 'coupon.applied',
    COUPON_CREATED: 'coupon.created',
    COUPON_EXPIRED: 'coupon.expired',
    
    // Analytics events
    ANALYTICS_TRACK: 'analytics.track',
    ANALYTICS_PAGE_VIEW: 'analytics.page.view'
};

// ============================================
// DOMAIN EVENT SERVICE
// ============================================

class DomainEventService {
    constructor() {
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(100);
        this.eventHistory = [];
        this.subscribers = new Map();
        this.eventLogs = [];
        this.isProcessing = false;
        this.eventQueue = [];
    }

    /**
     * Register a subscriber for a domain event
     */
    subscribe(eventName, handler, context = {}) {
        if (!DOMAIN_EVENTS[Object.keys(DOMAIN_EVENTS).find(key => DOMAIN_EVENTS[key] === eventName)]) {
            throw new Error(`Unknown event: ${eventName}`);
        }

        if (!this.subscribers.has(eventName)) {
            this.subscribers.set(eventName, []);
        }

        const subscription = {
            id: this.generateSubscriptionId(),
            handler,
            context,
            subscribedAt: new Date().toISOString()
        };

        this.subscribers.get(eventName).push(subscription);
        
        this.emitter.on(eventName, async (data) => {
            try {
                await handler(data, context);
            } catch (error) {
                console.error(`Error in subscriber for ${eventName}:`, error);
                await this.logError(eventName, data, error);
            }
        });

        console.log(`✅ Subscriber registered for: ${eventName}`);
        return subscription;
    }

    /**
     * Emit a domain event
     */
    async emit(eventName, data, metadata = {}) {
        if (!DOMAIN_EVENTS[Object.keys(DOMAIN_EVENTS).find(key => DOMAIN_EVENTS[key] === eventName)]) {
            throw new Error(`Unknown event: ${eventName}`);
        }

        const event = {
            id: this.generateEventId(),
            name: eventName,
            data,
            metadata: {
                ...metadata,
                timestamp: new Date().toISOString(),
                source: metadata.source || 'application'
            },
            status: 'pending'
        };

        // Log event
        await this.logEvent(event);

        // Store in memory
        this.eventHistory.push(event);

        // Emit synchronously (for immediate effects)
        this.emitter.emit(eventName, data);

        // Process async subscribers
        this.processAsyncSubscribers(event);

        console.log(`📡 Event emitted: ${eventName}`);
        return event;
    }

    /**
     * Process async subscribers
     */
    async processAsyncSubscribers(event) {
        const subscribers = this.subscribers.get(event.name) || [];
        const asyncSubscribers = subscribers.filter(s => s.context.async !== false);

        for (const subscriber of asyncSubscribers) {
            try {
                await subscriber.handler(event.data, subscriber.context);
            } catch (error) {
                console.error(`Async subscriber error for ${event.name}:`, error);
                await this.logError(event.name, event.data, error);
            }
        }
    }

    /**
     * Get all events
     */
    getEvents(filter = {}) {
        let events = this.eventHistory;

        if (filter.eventName) {
            events = events.filter(e => e.name === filter.eventName);
        }

        if (filter.fromDate) {
            events = events.filter(e => e.metadata.timestamp >= filter.fromDate);
        }

        if (filter.toDate) {
            events = events.filter(e => e.metadata.timestamp <= filter.toDate);
        }

        return events.slice(-100);
    }

    /**
     * Get subscribers
     */
    getSubscribers(eventName) {
        return this.subscribers.get(eventName) || [];
    }

    /**
     * Get event statistics
     */
    getStatistics() {
        const stats = {
            totalEvents: this.eventHistory.length,
            eventsByType: {},
            subscribersByType: {},
            eventQueueSize: this.eventQueue.length
        };

        // Count events by type
        for (const event of this.eventHistory) {
            stats.eventsByType[event.name] = (stats.eventsByType[event.name] || 0) + 1;
        }

        // Count subscribers by type
        for (const [eventName, subscribers] of this.subscribers) {
            stats.subscribersByType[eventName] = subscribers.length;
        }

        return stats;
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            totalEvents: this.eventHistory.length,
            totalSubscribers: Array.from(this.subscribers.values()).reduce((sum, s) => sum + s.length, 0),
            eventTypes: Object.keys(DOMAIN_EVENTS),
            isProcessing: this.isProcessing,
            queueSize: this.eventQueue.length
        };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateEventId() {
        return `EVT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    generateSubscriptionId() {
        return `SUB_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    async logEvent(event) {
        try {
            await db.query(
                `INSERT INTO domain_events_log 
                 (event_id, event_name, event_data, metadata, status, created_at)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    event.id,
                    event.name,
                    JSON.stringify(event.data),
                    JSON.stringify(event.metadata),
                    event.status
                ]
            );
        } catch (error) {
            console.error('Log event error:', error);
        }
    }

    async logError(eventName, data, error) {
        try {
            await db.query(
                `INSERT INTO domain_event_errors 
                 (event_name, event_data, error_message, error_stack, created_at)
                 VALUES (?, ?, ?, ?, NOW())`,
                [
                    eventName,
                    JSON.stringify(data),
                    error.message || 'Unknown error',
                    error.stack || ''
                ]
            );
        } catch (dbError) {
            console.error('Log error error:', dbError);
        }
    }

    /**
     * Clear old events
     */
    async clearOldEvents(days = 30) {
        try {
            await db.query(
                `DELETE FROM domain_events_log 
                 WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [days]
            );
            console.log(`✅ Cleared events older than ${days} days`);
        } catch (error) {
            console.error('Clear events error:', error);
        }
    }
}

// ============================================
// DOMAIN EVENT SUBSCRIBERS
// ============================================

const domainEventService = new DomainEventService();

// ============================================
// EXPORT
// ============================================

module.exports = {
    domainEventService,
    DOMAIN_EVENTS
};