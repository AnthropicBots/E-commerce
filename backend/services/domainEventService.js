// backend/services/domainEventService.js
// Issue #1263: Attach UUID v5 idempotency keys + consumer-side verification
const EventEmitter = require('events');
const db = require('../config/db').promise;
const { v5: uuidv5 } = require('uuid');
const {
    withIdempotency,
    outboxService
} = require('./outboxService');

// ============================================
// DOMAIN EVENTS CONFIGURATION
// ============================================

const DOMAIN_EVENTS = {
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_COMPLETED: 'order.completed',
    ORDER_PAYMENT_SUCCESS: 'order.payment.success',
    ORDER_PAYMENT_FAILED: 'order.payment.failed',

    PRODUCT_VIEWED: 'product.viewed',
    PRODUCT_ADDED: 'product.added',
    PRODUCT_UPDATED: 'product.updated',
    PRODUCT_REMOVED: 'product.removed',
    PRODUCT_REVIEWED: 'product.reviewed',

    WISHLIST_ITEM_ADDED: 'wishlist.item.added',
    WISHLIST_ITEM_REMOVED: 'wishlist.item.removed',

    CART_ITEM_ADDED: 'cart.item.added',
    CART_ITEM_REMOVED: 'cart.item.removed',
    CART_CLEARED: 'cart.cleared',

    USER_REGISTERED: 'user.registered',
    USER_LOGGED_IN: 'user.logged.in',
    USER_LOGGED_OUT: 'user.logged.out',
    USER_UPDATED: 'user.updated',

    PAYMENT_INITIATED: 'payment.initiated',
    PAYMENT_COMPLETED: 'payment.completed',
    PAYMENT_REFUNDED: 'payment.refunded',

    COUPON_APPLIED: 'coupon.applied',
    COUPON_CREATED: 'coupon.created',
    COUPON_EXPIRED: 'coupon.expired',

    ANALYTICS_TRACK: 'analytics.track',
    ANALYTICS_PAGE_VIEW: 'analytics.page.view'
};

const DOMAIN_IDEMPOTENCY_NAMESPACE = uuidv5('ecommerce.domain.events', uuidv5.DNS);

function isKnownEvent(eventName) {
    return Object.values(DOMAIN_EVENTS).includes(eventName);
}

function extractEntityId(data = {}) {
    return (
        data.orderId ||
        data.paymentId ||
        data.productId ||
        data.userId ||
        data.entityId ||
        data.id ||
        null
    );
}

/**
 * UUID v5 idempotency key: Event Type + Entity ID + Timestamp
 */
function buildDomainIdempotencyKey(eventName, data, timestamp) {
    const entityId = extractEntityId(data);
    const ts = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp || '');
    return uuidv5(`${eventName}|${entityId || 'none'}|${ts}`, DOMAIN_IDEMPOTENCY_NAMESPACE);
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
     * Register a subscriber. Pass context.idempotent=true (default for async)
     * to wrap the handler with consumer-side idempotency checks.
     */
    subscribe(eventName, handler, context = {}) {
        if (!isKnownEvent(eventName)) {
            throw new Error(`Unknown event: ${eventName}`);
        }

        if (!this.subscribers.has(eventName)) {
            this.subscribers.set(eventName, []);
        }

        const consumerName = context.consumerName || `domain:${eventName}`;
        const useIdempotency = context.idempotent !== false;

        const guardedHandler = useIdempotency
            ? withIdempotency(consumerName, async (normalized) => {
                return handler(normalized.data, {
                    ...context,
                    event: normalized,
                    idempotencyKey: normalized.idempotencyKey
                });
            })
            : async (eventPayload) => handler(eventPayload.data || eventPayload, context);

        const subscription = {
            id: this.generateSubscriptionId(),
            handler: guardedHandler,
            rawHandler: handler,
            context: { ...context, consumerName, idempotent: useIdempotency },
            subscribedAt: new Date().toISOString()
        };

        this.subscribers.get(eventName).push(subscription);

        this.emitter.on(eventName, async (envelope) => {
            try {
                await guardedHandler(envelope);
            } catch (error) {
                console.error(`Error in subscriber for ${eventName}:`, error);
                await this.logError(eventName, envelope?.data || envelope, error);
            }
        });

        console.log(`✅ Subscriber registered for: ${eventName} (idempotent=${useIdempotency})`);
        return subscription;
    }

    /**
     * Emit a domain event with an attached UUID v5 idempotency key.
     * Optionally mirrors the event into the transactional outbox.
     */
    async emit(eventName, data, metadata = {}) {
        if (!isKnownEvent(eventName)) {
            throw new Error(`Unknown event: ${eventName}`);
        }

        const timestamp = metadata.timestamp || new Date().toISOString();
        const entityId = extractEntityId(data);
        const idempotencyKey =
            metadata.idempotencyKey ||
            buildDomainIdempotencyKey(eventName, data, timestamp);

        const event = {
            id: this.generateEventId(),
            name: eventName,
            type: eventName,
            data,
            entityId,
            idempotencyKey,
            metadata: {
                ...metadata,
                timestamp,
                entityId,
                idempotencyKey,
                source: metadata.source || 'application'
            },
            createdAt: timestamp,
            status: 'pending'
        };

        await this.logEvent(event);
        this.eventHistory.push(event);

        // Persist to outbox when explicitly requested (durable dispatch path)
        if (metadata.useOutbox === true) {
            try {
                await outboxService.storeEvent(eventName, data, {
                    ...event.metadata,
                    eventTimestamp: timestamp,
                    domainEventId: event.id
                });
            } catch (error) {
                console.error('Outbox mirror failed:', error.message);
            }
        }

        // Emit envelope (not raw data) so consumers receive idempotencyKey
        const envelope = {
            id: event.id,
            name: eventName,
            type: eventName,
            data,
            entityId,
            idempotencyKey,
            metadata: event.metadata,
            createdAt: timestamp
        };

        this.emitter.emit(eventName, envelope);
        this.processAsyncSubscribers(envelope);

        console.log(`📡 Event emitted: ${eventName} key=${idempotencyKey}`);
        return event;
    }

    async processAsyncSubscribers(event) {
        const subscribers = this.subscribers.get(event.name) || [];
        // Emitter already invoked handlers; this path covers explicit async fan-out
        // for subscribers registered with context.asyncFanout=true only.
        const asyncSubscribers = subscribers.filter((s) => s.context.asyncFanout === true);

        for (const subscriber of asyncSubscribers) {
            try {
                await subscriber.handler(event);
            } catch (error) {
                console.error(`Async subscriber error for ${event.name}:`, error);
                await this.logError(event.name, event.data, error);
            }
        }
    }

    getEvents(filter = {}) {
        let events = this.eventHistory;

        if (filter.eventName) {
            events = events.filter((e) => e.name === filter.eventName);
        }
        if (filter.fromDate) {
            events = events.filter((e) => e.metadata.timestamp >= filter.fromDate);
        }
        if (filter.toDate) {
            events = events.filter((e) => e.metadata.timestamp <= filter.toDate);
        }
        if (filter.idempotencyKey) {
            events = events.filter((e) => e.idempotencyKey === filter.idempotencyKey);
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
            totalSubscribers: Array.from(this.subscribers.values()).reduce(
                (sum, s) => sum + s.length,
                0
            ),
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
 * Express middleware: require / attach Idempotency-Key for mutating APIs
 * that publish domain events. Rejects replayed keys that are still active.
 */
function consumerIdempotencyMiddleware(options = {}) {
    const {
        headerName = 'idempotency-key',
        consumerName = 'http-api',
        requireKey = false
    } = options;

    return async (req, res, next) => {
        try {
            const headerKey =
                req.headers[headerName] ||
                req.headers['x-idempotency-key'] ||
                req.body?.idempotencyKey;

            if (!headerKey && requireKey) {
                return res.status(400).json({
                    success: false,
                    message: 'Idempotency-Key header is required'
                });
            }

            if (!headerKey) {
                return next();
            }

            const syntheticEvent = {
                id: `HTTP_${headerKey}`,
                type: `${req.method}:${req.path}`,
                data: req.body || {},
                idempotencyKey: String(headerKey)
            };

            const claim = await outboxService.claimConsumerIdempotency(
                String(headerKey),
                syntheticEvent,
                consumerName
            );

            if (!claim.proceed) {
                return res.status(409).json({
                    success: false,
                    message: 'Duplicate request rejected by idempotency guard',
                    reason: claim.reason,
                    idempotencyKey: headerKey
                });
            }

            req.idempotencyKey = String(headerKey);
            req.idempotencyConsumer = consumerName;

            const originalJson = res.json.bind(res);
            res.json = async function idempotentJson(payload) {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        await outboxService.completeConsumerIdempotency(
                            String(headerKey),
                            consumerName
                        );
                    }
                } catch (err) {
                    console.error('Idempotency completion error:', err.message);
                }
                return originalJson(payload);
            };

            return next();
        } catch (error) {
            console.error('Idempotency middleware error:', error);
            return res.status(500).json({
                success: false,
                message: 'Idempotency check failed'
            });
        }
    };
}

const domainEventService = new DomainEventService();

module.exports = {
    domainEventService,
    DOMAIN_EVENTS,
    buildDomainIdempotencyKey,
    consumerIdempotencyMiddleware,
    withIdempotency
};
