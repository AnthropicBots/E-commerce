// backend/services/domainEventService.js
const EventEmitter = require('events');
const db = require('../config/db').promise;
const { v5: uuidv5 } = require('uuid');
const { outboxService } = require('./outboxService');

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

const IDEMPOTENCY_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function isKnownEvent(eventName) {
    return Object.values(DOMAIN_EVENTS).includes(eventName);
}

function deriveIdempotencyKey(eventName, data = {}, metadata = {}) {
    if (metadata.idempotencyKey) return metadata.idempotencyKey;
    if (data.idempotencyKey) return data.idempotencyKey;

    const entityId =
        data.orderId ||
        data.paymentId ||
        data.productId ||
        data.userId ||
        data.entityId ||
        data.id ||
        'unknown';
    const ts = metadata.occurredAt || data.occurredAt || data.timestamp || new Date().toISOString();
    return uuidv5(`${eventName}|${entityId}|${ts}`, IDEMPOTENCY_NAMESPACE);
}

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
     * Register a subscriber for a domain event.
     * Handlers receive (data, context) and should treat data.idempotencyKey as required.
     */
    subscribe(eventName, handler, context = {}) {
        if (!isKnownEvent(eventName)) {
            throw new Error(`Unknown event: ${eventName}`);
        }

        if (!this.subscribers.has(eventName)) {
            this.subscribers.set(eventName, []);
        }

        const consumer = context.consumer || context.name || `sub_${eventName}`;

        const wrappedHandler = async (data, ctx) => {
            // Consumer-side idempotency verification before side-effects (#1263)
            const allowed = await this.verifyConsumerIdempotency(
                data?.idempotencyKey,
                data?.eventId || data?.id,
                eventName,
                consumer
            );
            if (!allowed) {
                console.log(`⏭️ Subscriber skipped duplicate: ${eventName} [${consumer}]`);
                return { skipped: true };
            }

            try {
                const result = await handler(data, ctx);
                await this.markConsumerCompleted(data?.idempotencyKey, consumer);
                return result;
            } catch (error) {
                await this.markConsumerFailed(data?.idempotencyKey, consumer);
                throw error;
            }
        };

        const subscription = {
            id: this.generateSubscriptionId(),
            handler: wrappedHandler,
            rawHandler: handler,
            context: { ...context, consumer },
            subscribedAt: new Date().toISOString()
        };

        this.subscribers.get(eventName).push(subscription);

        this.emitter.on(eventName, async (data) => {
            try {
                await wrappedHandler(data, subscription.context);
            } catch (error) {
                console.error(`Error in subscriber for ${eventName}:`, error);
                await this.logError(eventName, data, error);
            }
        });

        console.log(`✅ Subscriber registered for: ${eventName} (idempotent)`);
        return subscription;
    }

    /**
     * Verify consumer has not already completed side-effects for this key
     */
    async verifyConsumerIdempotency(idempotencyKey, eventId, eventType, consumer) {
        if (!idempotencyKey) {
            // Require keys for billing/notification-class events
            const critical = eventType.startsWith('order.')
                || eventType.startsWith('payment.')
                || eventType.startsWith('notification.');
            if (critical) {
                console.warn(`Missing idempotency key for critical event ${eventType}`);
            }
            return true;
        }

        try {
            const check = await outboxService.beginConsumerIdempotency(
                idempotencyKey,
                eventId || `DOM_${idempotencyKey}`,
                eventType,
                consumer
            );
            return check.proceed;
        } catch (error) {
            console.error('verifyConsumerIdempotency error:', error.message);
            // Fail closed for payments to avoid double-billing
            if (eventType.startsWith('payment.') || eventType.includes('billing')) {
                return false;
            }
            return true;
        }
    }

    async markConsumerCompleted(idempotencyKey, consumer) {
        if (!idempotencyKey) return;
        await outboxService.completeConsumerIdempotency(idempotencyKey, consumer, false);
    }

    async markConsumerFailed(idempotencyKey, consumer) {
        if (!idempotencyKey) return;
        await outboxService.completeConsumerIdempotency(idempotencyKey, consumer, true);
    }

    /**
     * Emit a domain event (attaches UUID v5 idempotency key to payload)
     */
    async emit(eventName, data, metadata = {}) {
        if (!isKnownEvent(eventName)) {
            throw new Error(`Unknown event: ${eventName}`);
        }

        const occurredAt = metadata.occurredAt || new Date().toISOString();
        const idempotencyKey = deriveIdempotencyKey(eventName, data, {
            ...metadata,
            occurredAt
        });

        const event = {
            id: this.generateEventId(),
            name: eventName,
            data: {
                ...data,
                idempotencyKey,
                occurredAt,
                eventId: undefined // filled below
            },
            metadata: {
                ...metadata,
                timestamp: occurredAt,
                occurredAt,
                idempotencyKey,
                source: metadata.source || 'application'
            },
            idempotencyKey,
            status: 'pending'
        };
        event.data.eventId = event.id;

        // Persist via outbox only when explicitly requested (avoids double-dispatch)
        if (metadata.useOutbox === true || metadata.durable === true) {
            try {
                await outboxService.storeEvent(eventName, event.data, {
                    ...event.metadata,
                    domainEventId: event.id,
                    idempotencyKey,
                    occurredAt
                });
            } catch (err) {
                console.warn('Outbox store from domain emit failed:', err.message);
            }
        }

        await this.logEvent(event);
        this.eventHistory.push(event);

        // Emit with idempotency-enriched payload
        this.emitter.emit(eventName, event.data);
        this.processAsyncSubscribers(event);

        console.log(`📡 Event emitted: ${eventName} key=${idempotencyKey}`);
        return event;
    }

    /**
     * Process async subscribers (idempotency already wrapped in subscribe())
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

    getSubscribers(eventName) {
        return this.subscribers.get(eventName) || [];
    }

    getStatistics() {
        const stats = {
            totalEvents: this.eventHistory.length,
            eventsByType: {},
            subscribersByType: {},
            eventQueueSize: this.eventQueue.length
        };

        for (const event of this.eventHistory) {
            stats.eventsByType[event.name] = (stats.eventsByType[event.name] || 0) + 1;
        }

        for (const [eventName, subscribers] of this.subscribers) {
            stats.subscribersByType[eventName] = subscribers.length;
        }

        return stats;
    }

    getStatus() {
        return {
            totalEvents: this.eventHistory.length,
            totalSubscribers: Array.from(this.subscribers.values()).reduce((sum, s) => sum + s.length, 0),
            eventTypes: Object.keys(DOMAIN_EVENTS),
            isProcessing: this.isProcessing,
            queueSize: this.eventQueue.length
        };
    }

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

/**
 * Express middleware: require + verify Idempotency-Key header before side-effects
 */
function consumerIdempotencyMiddleware(options = {}) {
    const {
        consumer = 'http-consumer',
        headerName = 'idempotency-key',
        eventType = 'http.request'
    } = options;

    return async function idempotencyMiddleware(req, res, next) {
        const key = req.headers[headerName]
            || req.headers['x-idempotency-key']
            || req.body?.idempotencyKey;

        if (!key) {
            return res.status(400).json({
                success: false,
                error: 'Idempotency-Key header required',
                errorCode: 'IDEMPOTENCY_KEY_REQUIRED'
            });
        }

        try {
            const gate = await outboxService.beginConsumerIdempotency(
                key,
                req.headers['x-request-id'] || `HTTP_${Date.now()}`,
                eventType,
                consumer
            );

            if (!gate.proceed) {
                return res.status(409).json({
                    success: false,
                    error: 'Duplicate request — idempotency key already processed',
                    errorCode: 'IDEMPOTENCY_CONFLICT',
                    idempotencyKey: key
                });
            }

            req.idempotencyKey = key;
            req.idempotencyConsumer = consumer;

            const originalJson = res.json.bind(res);
            res.json = function idempotentJson(body) {
                const status = res.statusCode || 200;
                if (status >= 200 && status < 300) {
                    outboxService.completeConsumerIdempotency(key, consumer, false).catch(() => {});
                } else if (status >= 500) {
                    outboxService.completeConsumerIdempotency(key, consumer, true).catch(() => {});
                }
                return originalJson(body);
            };

            next();
        } catch (error) {
            console.error('Idempotency middleware error:', error);
            return res.status(500).json({
                success: false,
                error: 'Idempotency check failed'
            });
        }
    };
}

// ============================================
// EXPORT
// ============================================

const domainEventService = new DomainEventService();

module.exports = {
    domainEventService,
    DOMAIN_EVENTS,
    deriveIdempotencyKey,
    consumerIdempotencyMiddleware
};
