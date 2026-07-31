// backend/services/outboxService.js
// Issue #1263: Outbox double-dispatch & idempotency expiration guards
const db = require('../config/db');
const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

// ============================================
// OUTBOX CONFIGURATION
// ============================================

const OUTBOX_CONFIG = {
    pollInterval: 5000,
    batchSize: 100,
    maxRetries: 5,
    retryDelay: 30000,

    retentionDays: 7,
    cleanupInterval: 3600000,

    processingTimeout: 60000,
    // Stale PROCESSING locks are released after 30s (issue #1263)
    staleProcessingMs: 30000,
    staleResetInterval: 10000,
    concurrentProcessors: 3,

    // Completed idempotency keys must outlive outbox retention to avoid
    // the "idempotency expiration → re-dispatch" vulnerability.
    idempotencyTtlDays: 14,
    idempotencyProcessingTtlMs: 30000
};

const OUTBOX_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    RETRY: 'retry'
};

const IDEMPOTENCY_STATUS = {
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    EXPIRED: 'expired'
};

const EVENT_TYPES = {
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_COMPLETED: 'order.completed',
    PAYMENT_COMPLETED: 'payment.completed',
    PAYMENT_FAILED: 'payment.failed',
    PRODUCT_UPDATED: 'product.updated',
    PRODUCT_CREATED: 'product.created',
    INVENTORY_UPDATED: 'inventory.updated',
    USER_REGISTERED: 'user.registered',
    USER_UPDATED: 'user.updated',
    NOTIFICATION_SENT: 'notification.sent',
    ANALYTICS_TRACKED: 'analytics.tracked',
    RECOMMENDATION_UPDATED: 'recommendation.updated'
};

// Stable namespace for UUID v5 idempotency keys
const IDEMPOTENCY_NAMESPACE = uuidv5('ecommerce.outbox.idempotency', uuidv5.DNS);

// ============================================
// OUTBOX SERVICE
// ============================================

class OutboxService {
    constructor() {
        this.isRunning = false;
        this.processors = [];
        this.eventHandlers = new Map();
        this.processingQueue = [];
        this.stats = {
            processed: 0,
            failed: 0,
            retried: 0,
            total: 0,
            skippedDuplicate: 0,
            optimisticLockConflicts: 0,
            staleLocksReset: 0
        };
        this.pollInterval = null;
        this.cleanupInterval = null;
        this.staleResetInterval = null;
    }

    async initialize() {
        if (this.isRunning) return;

        this.registerDefaultHandlers();
        this.startPolling();
        this.startCleanup();
        this.startStaleLockReset();

        this.isRunning = true;
        console.log('✅ Outbox Service initialized (idempotent dispatch enabled)');
        return this;
    }

    registerHandler(eventType, handler) {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, []);
        }
        this.eventHandlers.get(eventType).push(handler);
        console.log(`✅ Handler registered for: ${eventType}`);
    }

    registerDefaultHandlers() {
        this.registerHandler(EVENT_TYPES.ORDER_CREATED, async (event) => {
            console.log(`📦 Order created: ${event.data.orderId}`);
            await this.processOrderCreated(event.data);
        });

        this.registerHandler(EVENT_TYPES.ORDER_COMPLETED, async (event) => {
            console.log(`✅ Order completed: ${event.data.orderId}`);
            await this.processOrderCompleted(event.data);
        });

        this.registerHandler(EVENT_TYPES.PAYMENT_COMPLETED, async (event) => {
            console.log(`💳 Payment completed: ${event.data.paymentId}`);
            await this.processPaymentCompleted(event.data);
        });

        this.registerHandler(EVENT_TYPES.NOTIFICATION_SENT, async (event) => {
            console.log(`📧 Notification sent: ${event.data.notificationId}`);
        });

        this.registerHandler(EVENT_TYPES.ANALYTICS_TRACKED, async (event) => {
            console.log(`📊 Analytics tracked: ${event.data.eventType}`);
        });

        this.registerHandler(EVENT_TYPES.RECOMMENDATION_UPDATED, async (event) => {
            console.log(`🎯 Recommendations updated for user: ${event.data.userId}`);
        });
    }

    /**
     * Deterministic UUID v5 from Event Type + Entity ID + Timestamp.
     */
    generateIdempotencyKey(eventType, entityId, timestamp) {
        const ts = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp || '');
        const name = `${eventType}|${entityId || 'none'}|${ts}`;
        return uuidv5(name, IDEMPOTENCY_NAMESPACE);
    }

    extractEntityId(data = {}) {
        return (
            data.orderId ||
            data.paymentId ||
            data.productId ||
            data.userId ||
            data.notificationId ||
            data.entityId ||
            data.id ||
            null
        );
    }

    async storeEvent(eventType, data, metadata = {}) {
        const createdAt = new Date();
        const entityId = this.extractEntityId(data);
        const idempotencyKey = this.generateIdempotencyKey(
            eventType,
            entityId,
            metadata.eventTimestamp || createdAt.toISOString()
        );

        const event = {
            id: this.generateEventId(),
            type: eventType,
            entityId,
            idempotencyKey,
            data,
            metadata: {
                ...metadata,
                idempotencyKey,
                entityId
            },
            status: OUTBOX_STATUS.PENDING,
            version: 0,
            attempts: 0,
            maxAttempts: OUTBOX_CONFIG.maxRetries,
            createdAt: createdAt.toISOString(),
            updatedAt: createdAt.toISOString(),
            processedAt: null,
            error: null
        };

        try {
            const [existing] = await db.query(
                `SELECT event_id, status FROM outbox_events WHERE idempotency_key = ? LIMIT 1`,
                [idempotencyKey]
            );
            if (existing.length > 0) {
                console.log(`♻️ Duplicate outbox store skipped: ${idempotencyKey}`);
                this.stats.skippedDuplicate++;
                return {
                    ...event,
                    id: existing[0].event_id,
                    status: existing[0].status,
                    duplicate: true
                };
            }

            await db.query(
                `INSERT INTO outbox_events
                 (event_id, event_type, entity_id, idempotency_key, data, metadata,
                  status, version, attempts, max_attempts, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    event.id,
                    event.type,
                    event.entityId,
                    event.idempotencyKey,
                    JSON.stringify(event.data),
                    JSON.stringify(event.metadata),
                    event.status,
                    event.version,
                    event.attempts,
                    event.maxAttempts,
                    event.createdAt,
                    event.updatedAt
                ]
            );

            this.stats.total++;
            console.log(`📝 Event stored: ${event.type} (${event.id}) key=${event.idempotencyKey}`);
            return event;
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                this.stats.skippedDuplicate++;
                console.log(`♻️ Duplicate outbox insert ignored for key ${idempotencyKey}`);
                return { ...event, duplicate: true };
            }
            console.error('Store event error:', error);
            throw error;
        }
    }

    startPolling() {
        if (this.pollInterval) return;
        this.pollInterval = setInterval(() => {
            this.processPendingEvents();
        }, OUTBOX_CONFIG.pollInterval);
        setTimeout(() => this.processPendingEvents(), 1000);
    }

    startCleanup() {
        if (this.cleanupInterval) return;
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldEvents();
        }, OUTBOX_CONFIG.cleanupInterval);
    }

    startStaleLockReset() {
        if (this.staleResetInterval) return;
        this.staleResetInterval = setInterval(() => {
            this.resetStaleProcessingLocks().catch((err) => {
                console.error('Stale lock reset error:', err);
            });
        }, OUTBOX_CONFIG.staleResetInterval);
        setTimeout(() => this.resetStaleProcessingLocks(), 2000);
    }

    async resetStaleProcessingLocks() {
        const staleSeconds = Math.floor(OUTBOX_CONFIG.staleProcessingMs / 1000);

        const [result] = await db.query(
            `UPDATE outbox_events
             SET status = ?,
                 processing_started_at = NULL,
                 version = version + 1,
                 updated_at = NOW(),
                 error = COALESCE(error, 'Stale processing lock reset')
             WHERE status = ?
               AND processing_started_at IS NOT NULL
               AND processing_started_at < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
            [OUTBOX_STATUS.RETRY, OUTBOX_STATUS.PROCESSING, staleSeconds]
        );

        if (result.affectedRows > 0) {
            this.stats.staleLocksReset += result.affectedRows;
            console.log(`🔓 Reset ${result.affectedRows} stale outbox processing lock(s)`);
        }

        await db.query(
            `UPDATE outbox_idempotency_keys
             SET status = ?
             WHERE status = ?
               AND expires_at < NOW()`,
            [IDEMPOTENCY_STATUS.EXPIRED, IDEMPOTENCY_STATUS.PROCESSING]
        );

        return result.affectedRows || 0;
    }

    async claimEventWithOptimisticLock(eventId, expectedVersion) {
        const [result] = await db.query(
            `UPDATE outbox_events
             SET status = ?,
                 version = version + 1,
                 processing_started_at = NOW(),
                 updated_at = NOW()
             WHERE event_id = ?
               AND version = ?
               AND status IN (?, ?)`,
            [
                OUTBOX_STATUS.PROCESSING,
                eventId,
                expectedVersion,
                OUTBOX_STATUS.PENDING,
                OUTBOX_STATUS.RETRY
            ]
        );

        if (result.affectedRows === 0) {
            this.stats.optimisticLockConflicts++;
            return false;
        }
        return true;
    }

    /**
     * Consumer-side idempotency claim.
     * Also guards against expired-key replay by checking outbox COMPLETED status.
     */
    async claimConsumerIdempotency(idempotencyKey, event, consumerName = 'default') {
        if (!idempotencyKey) {
            return { proceed: true, reason: 'missing_key' };
        }

        const [outboxRows] = await db.query(
            `SELECT status FROM outbox_events WHERE event_id = ? LIMIT 1`,
            [event.id]
        );
        if (outboxRows[0]?.status === OUTBOX_STATUS.COMPLETED) {
            return { proceed: false, reason: 'outbox_already_completed' };
        }

        const [existing] = await db.query(
            `SELECT status, expires_at, consumer_name
             FROM outbox_idempotency_keys
             WHERE idempotency_key = ? AND consumer_name = ?
             LIMIT 1`,
            [idempotencyKey, consumerName]
        );

        if (existing.length > 0) {
            const row = existing[0];
            const expired = new Date(row.expires_at).getTime() < Date.now();

            if (row.status === IDEMPOTENCY_STATUS.COMPLETED) {
                return { proceed: false, reason: 'idempotency_completed' };
            }

            if (row.status === IDEMPOTENCY_STATUS.PROCESSING && !expired) {
                return { proceed: false, reason: 'idempotency_in_flight' };
            }

            await db.query(
                `UPDATE outbox_idempotency_keys
                 SET status = ?,
                     event_id = ?,
                     event_type = ?,
                     expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                     completed_at = NULL
                 WHERE idempotency_key = ?
                   AND consumer_name = ?
                   AND status IN (?, ?)`,
                [
                    IDEMPOTENCY_STATUS.PROCESSING,
                    event.id,
                    event.type,
                    Math.floor(OUTBOX_CONFIG.idempotencyProcessingTtlMs / 1000),
                    idempotencyKey,
                    consumerName,
                    IDEMPOTENCY_STATUS.PROCESSING,
                    IDEMPOTENCY_STATUS.EXPIRED
                ]
            );
            return { proceed: true, reason: 'reclaimed_expired' };
        }

        try {
            await db.query(
                `INSERT INTO outbox_idempotency_keys
                 (idempotency_key, event_id, event_type, consumer_name, status, expires_at)
                 VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
                [
                    idempotencyKey,
                    event.id,
                    event.type,
                    consumerName,
                    IDEMPOTENCY_STATUS.PROCESSING,
                    Math.floor(OUTBOX_CONFIG.idempotencyProcessingTtlMs / 1000)
                ]
            );
            return { proceed: true, reason: 'claimed' };
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return { proceed: false, reason: 'idempotency_race' };
            }
            throw error;
        }
    }

    async completeConsumerIdempotency(idempotencyKey, consumerName = 'default') {
        if (!idempotencyKey) return;

        await db.query(
            `UPDATE outbox_idempotency_keys
             SET status = ?,
                 completed_at = NOW(),
                 expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
             WHERE idempotency_key = ?
               AND consumer_name = ?`,
            [
                IDEMPOTENCY_STATUS.COMPLETED,
                OUTBOX_CONFIG.idempotencyTtlDays,
                idempotencyKey,
                consumerName
            ]
        );
    }

    async processPendingEvents() {
        let connection;
        try {
            await this.resetStaleProcessingLocks();

            connection = await db.getConnection();
            await connection.beginTransaction();

            const [events] = await connection.query(
                `SELECT * FROM outbox_events
                 WHERE status IN (?, ?)
                   AND attempts < max_attempts
                 ORDER BY created_at ASC
                 LIMIT ?
                 FOR UPDATE SKIP LOCKED`,
                [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.RETRY, OUTBOX_CONFIG.batchSize]
            );

            await connection.commit();
            connection.release();
            connection = null;

            if (events.length === 0) return;

            for (const eventRow of events) {
                const claimed = await this.claimEventWithOptimisticLock(
                    eventRow.event_id,
                    eventRow.version
                );
                if (!claimed) {
                    console.log(`⏭️ Skipped event ${eventRow.event_id} (optimistic lock miss)`);
                    continue;
                }

                const event = {
                    id: eventRow.event_id,
                    type: eventRow.event_type,
                    entityId: eventRow.entity_id,
                    idempotencyKey:
                        eventRow.idempotency_key ||
                        this.generateIdempotencyKey(
                            eventRow.event_type,
                            eventRow.entity_id,
                            eventRow.created_at
                        ),
                    data: typeof eventRow.data === 'string'
                        ? JSON.parse(eventRow.data)
                        : eventRow.data,
                    metadata: typeof eventRow.metadata === 'string'
                        ? JSON.parse(eventRow.metadata || '{}')
                        : (eventRow.metadata || {}),
                    status: OUTBOX_STATUS.PROCESSING,
                    version: (eventRow.version || 0) + 1,
                    attempts: eventRow.attempts,
                    maxAttempts: eventRow.max_attempts,
                    createdAt: eventRow.created_at,
                    updatedAt: eventRow.updated_at,
                    error: eventRow.error
                };

                await this.processEvent(event);
            }
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch (_) {
                    /* ignore */
                }
                connection.release();
            }
            console.error('Process pending events error:', error);
        }
    }

    async processEvent(event) {
        const consumerName = 'outbox-dispatcher';
        const claim = await this.claimConsumerIdempotency(
            event.idempotencyKey,
            event,
            consumerName
        );

        if (!claim.proceed) {
            this.stats.skippedDuplicate++;
            console.log(`♻️ Skipping duplicate dispatch ${event.id} (${claim.reason})`);
            if (
                claim.reason === 'idempotency_completed' ||
                claim.reason === 'outbox_already_completed'
            ) {
                await this.updateEventStatus(event.id, OUTBOX_STATUS.COMPLETED, {
                    versionGuard: event.version
                });
            }
            return { skipped: true, reason: claim.reason };
        }

        try {
            const handlers = this.eventHandlers.get(event.type) || [];

            if (handlers.length === 0) {
                console.warn(`No handlers for event type: ${event.type}`);
                await this.updateEventStatus(event.id, OUTBOX_STATUS.COMPLETED, {
                    versionGuard: event.version
                });
                await this.completeConsumerIdempotency(event.idempotencyKey, consumerName);
                return { skipped: false, handlers: 0 };
            }

            for (const handler of handlers) {
                await handler(event);
            }

            const completed = await this.updateEventStatus(
                event.id,
                OUTBOX_STATUS.COMPLETED,
                { versionGuard: event.version }
            );

            if (!completed) {
                console.warn(`⚠️ Completion lock lost for ${event.id}`);
                return { skipped: false, lockLost: true };
            }

            await this.completeConsumerIdempotency(event.idempotencyKey, consumerName);
            this.stats.processed++;
            console.log(`✅ Event processed: ${event.type} (${event.id})`);
            return { skipped: false, processed: true };
        } catch (error) {
            console.error(`Error processing event ${event.id}:`, error);

            const newAttempts = event.attempts + 1;
            const newStatus =
                newAttempts >= event.maxAttempts
                    ? OUTBOX_STATUS.FAILED
                    : OUTBOX_STATUS.RETRY;

            await this.updateEventStatus(event.id, newStatus, {
                attempts: newAttempts,
                error: error.message,
                versionGuard: event.version,
                clearProcessingLock: true
            });

            await db.query(
                `UPDATE outbox_idempotency_keys
                 SET status = ?, expires_at = NOW()
                 WHERE idempotency_key = ? AND consumer_name = ? AND status = ?`,
                [
                    IDEMPOTENCY_STATUS.EXPIRED,
                    event.idempotencyKey,
                    consumerName,
                    IDEMPOTENCY_STATUS.PROCESSING
                ]
            );

            if (newStatus === OUTBOX_STATUS.FAILED) {
                this.stats.failed++;
                console.error(`💀 Event permanently failed: ${event.type} (${event.id})`);
            } else {
                this.stats.retried++;
                console.log(
                    `🔄 Event retrying: ${event.type} (${event.id}) attempt ${newAttempts}`
                );
            }

            return { skipped: false, failed: true, error: error.message };
        }
    }

    async updateEventStatus(eventId, status, additional = {}) {
        const updates = {
            status,
            updatedAt: new Date().toISOString(),
            ...additional
        };

        if (status === OUTBOX_STATUS.COMPLETED) {
            updates.processedAt = new Date().toISOString();
        }

        const params = [
            status,
            additional.attempts != null ? additional.attempts : null,
            additional.error != null ? additional.error : null,
            updates.processedAt || null,
            updates.updatedAt
        ];

        let sql = `UPDATE outbox_events
                   SET status = ?,
                       attempts = COALESCE(?, attempts),
                       error = COALESCE(?, error),
                       processed_at = COALESCE(?, processed_at),
                       updated_at = ?,
                       version = version + 1`;

        if (
            status === OUTBOX_STATUS.COMPLETED ||
            status === OUTBOX_STATUS.FAILED ||
            status === OUTBOX_STATUS.RETRY ||
            additional.clearProcessingLock
        ) {
            sql += `, processing_started_at = NULL`;
        }

        sql += ` WHERE event_id = ?`;
        params.push(eventId);

        if (additional.versionGuard != null) {
            sql += ` AND version = ?`;
            params.push(additional.versionGuard);
        }

        const [result] = await db.query(sql, params);
        if (result.affectedRows === 0 && additional.versionGuard != null) {
            this.stats.optimisticLockConflicts++;
            return false;
        }
        return true;
    }

    async cleanupOldEvents() {
        try {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - OUTBOX_CONFIG.retentionDays);

            const [result] = await db.query(
                `DELETE FROM outbox_events
                 WHERE status IN (?, ?)
                   AND updated_at < ?`,
                [OUTBOX_STATUS.COMPLETED, OUTBOX_STATUS.FAILED, cutoff.toISOString()]
            );

            await db.query(
                `DELETE FROM outbox_idempotency_keys
                 WHERE status = ?
                   AND expires_at < NOW()`,
                [IDEMPOTENCY_STATUS.COMPLETED]
            );

            if (result.affectedRows > 0) {
                console.log(`🧹 Cleaned up ${result.affectedRows} old events`);
            }
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'retry' THEN 1 ELSE 0 END) as retry,
                    AVG(attempts) as avg_attempts
                 FROM outbox_events`
            );

            const [idem] = await db.query(
                `SELECT
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as idempotency_completed,
                    SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as idempotency_processing,
                    SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as idempotency_expired
                 FROM outbox_idempotency_keys`
            );

            return {
                ...stats[0],
                ...(idem[0] || {}),
                ...this.stats,
                staleProcessingMs: OUTBOX_CONFIG.staleProcessingMs,
                idempotencyTtlDays: OUTBOX_CONFIG.idempotencyTtlDays,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            return null;
        }
    }

    async retryFailedEvents() {
        await db.query(
            `UPDATE outbox_events
             SET status = ?,
                 version = version + 1,
                 processing_started_at = NULL,
                 updated_at = NOW()
             WHERE status = ?
               AND attempts < max_attempts`,
            [OUTBOX_STATUS.RETRY, OUTBOX_STATUS.FAILED]
        );
        console.log('🔄 Retried failed events');
    }

    async getPendingCount() {
        const [result] = await db.query(
            'SELECT COUNT(*) as count FROM outbox_events WHERE status = ?',
            [OUTBOX_STATUS.PENDING]
        );
        return result[0]?.count || 0;
    }

    async getIdempotencyRecord(idempotencyKey) {
        const [rows] = await db.query(
            `SELECT * FROM outbox_idempotency_keys WHERE idempotency_key = ?`,
            [idempotencyKey]
        );
        return rows[0] || null;
    }

    async processOrderCreated(data) {
        await this.sendNotification({
            userId: data.userId,
            type: 'order_confirmation',
            template: 'order-confirmation',
            data: {
                orderId: data.orderId,
                total: data.total,
                items: data.items
            }
        });
        await this.updateAnalytics({
            event: 'order_created',
            userId: data.userId,
            orderId: data.orderId,
            total: data.total,
            timestamp: new Date().toISOString()
        });
        await this.updateRecommendations({
            userId: data.userId,
            orderId: data.orderId,
            items: data.items
        });
    }

    async processOrderCompleted(data) {
        await this.sendNotification({
            userId: data.userId,
            type: 'order_completed',
            template: 'order-completed',
            data: {
                orderId: data.orderId,
                deliveryDate: data.deliveryDate
            }
        });
        await this.updateAnalytics({
            event: 'order_completed',
            userId: data.userId,
            orderId: data.orderId,
            timestamp: new Date().toISOString()
        });
    }

    async processPaymentCompleted(data) {
        await this.sendNotification({
            userId: data.userId,
            type: 'payment_confirmation',
            template: 'payment-confirmation',
            data: {
                paymentId: data.paymentId,
                orderId: data.orderId,
                amount: data.amount
            }
        });
        await this.updateAnalytics({
            event: 'payment_completed',
            userId: data.userId,
            paymentId: data.paymentId,
            amount: data.amount,
            timestamp: new Date().toISOString()
        });
    }

    async sendNotification(data) {
        console.log(`📧 Notification: ${data.type} for user ${data.userId}`);
        return { sent: true };
    }

    async updateAnalytics(data) {
        console.log(`📊 Analytics: ${data.event}`);
        return { updated: true };
    }

    async updateRecommendations(data) {
        console.log(`🎯 Recommendations updated for user ${data.userId}`);
        return { updated: true };
    }

    generateEventId() {
        return `EVT_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    async shutdown() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (this.staleResetInterval) {
            clearInterval(this.staleResetInterval);
            this.staleResetInterval = null;
        }
        this.isRunning = false;
        console.log('⏹️ Outbox Service stopped');
    }
}

/**
 * Wrap an async event consumer so side-effects run at most once per
 * idempotency key (UUID v5 of type + entity + timestamp).
 */
function withIdempotency(consumerName, handler, outbox = null) {
    const service = outbox || module.exports.outboxService;

    return async (event) => {
        const idempotencyKey =
            event.idempotencyKey ||
            event.metadata?.idempotencyKey ||
            service.generateIdempotencyKey(
                event.type || event.name,
                service.extractEntityId(event.data || event),
                event.createdAt || event.metadata?.timestamp || event.metadata?.eventTimestamp
            );

        const normalized = {
            id: event.id || event.eventId || idempotencyKey,
            type: event.type || event.name,
            data: event.data || event,
            idempotencyKey,
            metadata: event.metadata || {}
        };

        const claim = await service.claimConsumerIdempotency(
            idempotencyKey,
            normalized,
            consumerName
        );

        if (!claim.proceed) {
            console.log(
                `♻️ Consumer "${consumerName}" skipped duplicate ${idempotencyKey} (${claim.reason})`
            );
            return { skipped: true, reason: claim.reason };
        }

        try {
            const result = await handler(normalized);
            await service.completeConsumerIdempotency(idempotencyKey, consumerName);
            return result;
        } catch (error) {
            await db.query(
                `UPDATE outbox_idempotency_keys
                 SET status = ?, expires_at = NOW()
                 WHERE idempotency_key = ? AND consumer_name = ? AND status = ?`,
                [
                    IDEMPOTENCY_STATUS.EXPIRED,
                    idempotencyKey,
                    consumerName,
                    IDEMPOTENCY_STATUS.PROCESSING
                ]
            );
            throw error;
        }
    };
}

const outboxService = new OutboxService();

module.exports = {
    OutboxService,
    OUTBOX_STATUS,
    IDEMPOTENCY_STATUS,
    EVENT_TYPES,
    OUTBOX_CONFIG,
    withIdempotency,
    outboxService
};
