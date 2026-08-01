// backend/services/outboxService.js
const db = require('../config/db');
const { withTransaction } = require('../config/db');
const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

// ============================================
// OUTBOX CONFIGURATION
// ============================================

const OUTBOX_CONFIG = {
    // Polling configuration
    pollInterval: 5000, // 5 seconds
    batchSize: 100,
    maxRetries: 5,
    retryDelay: 30000, // 30 seconds

    // Event retention
    retentionDays: 7,
    cleanupInterval: 3600000, // 1 hour

    // Processing / stale lock (#1263)
    processingTimeout: 60000, // 1 minute
    staleProcessingMs: parseInt(process.env.OUTBOX_STALE_LOCK_MS, 10) || 30000, // 30s
    concurrentProcessors: 3,

    // Idempotency ledger must outlive short TTLs that caused re-dispatch bugs
    idempotencyRetentionDays: parseInt(process.env.OUTBOX_IDEMPOTENCY_DAYS, 10) || 90
};

const OUTBOX_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    RETRY: 'retry'
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

/** Fixed namespace for deterministic UUID v5 idempotency keys */
const IDEMPOTENCY_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

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
            staleReset: 0,
            optimisticLockConflicts: 0
        };
        this.pollInterval = null;
        this.cleanupInterval = null;
        this.staleResetInterval = null;
    }

    /**
     * Initialize outbox service
     */
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

    /**
     * Register an event handler
     */
    registerHandler(eventType, handler) {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, []);
        }
        this.eventHandlers.get(eventType).push(handler);
        console.log(`✅ Handler registered for: ${eventType}`);
    }

    /**
     * Register default event handlers
     */
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
     * UUID v5 derived from Event Type + Entity ID + Timestamp (#1263)
     */
    generateIdempotencyKey(eventType, data = {}, occurredAt = null) {
        const entityId =
            data.orderId ||
            data.paymentId ||
            data.productId ||
            data.userId ||
            data.entityId ||
            data.id ||
            'unknown';
        const ts = occurredAt || data.occurredAt || data.timestamp || new Date().toISOString();
        const name = `${eventType}|${entityId}|${ts}`;
        return uuidv5(name, IDEMPOTENCY_NAMESPACE);
    }

    /**
     * Store event in outbox with idempotency key + version=0
     */
    async storeEvent(eventType, data, metadata = {}) {
        const occurredAt = metadata.occurredAt || new Date().toISOString();
        const idempotencyKey = metadata.idempotencyKey
            || this.generateIdempotencyKey(eventType, data, occurredAt);

        // Deduplicate at write-time if the same logical event was already stored
        try {
            const [existing] = await db.query(
                `SELECT event_id, status FROM outbox_events WHERE idempotency_key = ? LIMIT 1`,
                [idempotencyKey]
            );
            if (existing.length > 0) {
                console.log(`⏭️ Duplicate outbox write skipped: ${idempotencyKey}`);
                this.stats.skippedDuplicate++;
                return {
                    id: existing[0].event_id,
                    type: eventType,
                    idempotencyKey,
                    status: existing[0].status,
                    duplicate: true
                };
            }
        } catch (err) {
            // Column may be missing on legacy DBs — continue insert path
            if (err.code !== 'ER_BAD_FIELD_ERROR') {
                console.warn('Idempotency pre-check warning:', err.message);
            }
        }

        const event = {
            id: this.generateEventId(),
            type: eventType,
            data: {
                ...data,
                idempotencyKey,
                occurredAt
            },
            metadata: {
                ...metadata,
                idempotencyKey,
                occurredAt
            },
            status: OUTBOX_STATUS.PENDING,
            attempts: 0,
            maxAttempts: OUTBOX_CONFIG.maxRetries,
            version: 0,
            idempotencyKey,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            processedAt: null,
            error: null
        };

        try {
            await db.query(
                `INSERT INTO outbox_events 
                 (event_id, event_type, data, metadata, status, attempts, 
                  max_attempts, version, idempotency_key, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    event.id,
                    event.type,
                    JSON.stringify(event.data),
                    JSON.stringify(event.metadata),
                    event.status,
                    event.attempts,
                    event.maxAttempts,
                    event.version,
                    event.idempotencyKey,
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
                return {
                    id: event.id,
                    type: eventType,
                    idempotencyKey,
                    duplicate: true
                };
            }
            console.error('Store event error:', error);
            throw error;
        }
    }

    /**
     * Start polling for pending events
     */
    startPolling() {
        if (this.pollInterval) return;

        this.pollInterval = setInterval(() => {
            this.processPendingEvents();
        }, OUTBOX_CONFIG.pollInterval);

        setTimeout(() => this.processPendingEvents(), 1000);
    }

    /**
     * Start cleanup
     */
    startCleanup() {
        if (this.cleanupInterval) return;

        this.cleanupInterval = setInterval(() => {
            this.cleanupOldEvents();
        }, OUTBOX_CONFIG.cleanupInterval);
    }

    /**
     * Automatically reset stale PROCESSING locks after 30s (#1263)
     */
    startStaleLockReset() {
        if (this.staleResetInterval) return;

        this.staleResetInterval = setInterval(() => {
            this.resetStaleProcessingLocks().catch((err) => {
                console.error('Stale lock reset error:', err.message);
            });
        }, Math.min(OUTBOX_CONFIG.staleProcessingMs, 15000));

        setTimeout(() => this.resetStaleProcessingLocks().catch(() => {}), 2000);
    }

    /**
     * PENDING/RETRY stuck in PROCESSING → RETRY when lock older than 30s
     */
    async resetStaleProcessingLocks() {
        const staleSeconds = Math.ceil(OUTBOX_CONFIG.staleProcessingMs / 1000);
        const [result] = await db.query(
            `UPDATE outbox_events
             SET status = ?,
                 processing_started_at = NULL,
                 updated_at = NOW()
             WHERE status = ?
               AND processing_started_at IS NOT NULL
               AND processing_started_at < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
            [OUTBOX_STATUS.RETRY, OUTBOX_STATUS.PROCESSING, staleSeconds]
        );

        const reset = result.affectedRows || 0;
        if (reset > 0) {
            this.stats.staleReset += reset;
            console.log(`🔓 Reset ${reset} stale outbox processing lock(s)`);
        }
        return { reset };
    }

    /**
     * Claim a single event with optimistic lock (version check).
     * Returns true only if this worker owns the transition PENDING/RETRY → PROCESSING.
     */
    async claimEventWithOptimisticLock(eventRow) {
        const currentVersion = eventRow.version != null ? Number(eventRow.version) : 0;
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
                eventRow.event_id,
                currentVersion,
                OUTBOX_STATUS.PENDING,
                OUTBOX_STATUS.RETRY
            ]
        );

        if (!result.affectedRows) {
            this.stats.optimisticLockConflicts++;
            return false;
        }

        eventRow.version = currentVersion + 1;
        return true;
    }

    /**
     * Consumer-side idempotency: reserve key before side-effects.
     * Returns { proceed: false } if already completed for this consumer.
     */
    async beginConsumerIdempotency(idempotencyKey, eventId, eventType, consumer = 'outbox-dispatcher') {
        if (!idempotencyKey) {
            return { proceed: true, skipped: false };
        }

        try {
            const [existing] = await db.query(
                `SELECT status FROM outbox_idempotency_ledger
                 WHERE idempotency_key = ? AND consumer = ?
                 LIMIT 1`,
                [idempotencyKey, consumer]
            );

            if (existing.length > 0) {
                if (existing[0].status === 'completed') {
                    this.stats.skippedDuplicate++;
                    return { proceed: false, skipped: true, reason: 'already_completed' };
                }
                // Allow retry of failed / abandoned processing rows after stale window
                if (existing[0].status === 'processing') {
                    await db.query(
                        `UPDATE outbox_idempotency_ledger
                         SET status = 'processing', event_id = ?, event_type = ?
                         WHERE idempotency_key = ? AND consumer = ? AND status != 'completed'`,
                        [eventId, eventType, idempotencyKey, consumer]
                    );
                    return { proceed: true, skipped: false, resumed: true };
                }
            }

            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + OUTBOX_CONFIG.idempotencyRetentionDays);

            await db.query(
                `INSERT INTO outbox_idempotency_ledger
                 (idempotency_key, event_id, consumer, event_type, status, created_at, expires_at)
                 VALUES (?, ?, ?, ?, 'processing', NOW(), ?)
                 ON DUPLICATE KEY UPDATE
                   event_id = IF(status = 'completed', event_id, VALUES(event_id)),
                   status = IF(status = 'completed', status, 'processing')`,
                [idempotencyKey, eventId, consumer, eventType, expiresAt]
            );

            // Re-read to honor concurrent completer
            const [again] = await db.query(
                `SELECT status FROM outbox_idempotency_ledger
                 WHERE idempotency_key = ? AND consumer = ? LIMIT 1`,
                [idempotencyKey, consumer]
            );
            if (again[0]?.status === 'completed') {
                this.stats.skippedDuplicate++;
                return { proceed: false, skipped: true, reason: 'race_completed' };
            }

            return { proceed: true, skipped: false };
        } catch (error) {
            // Fail closed for billing/notification safety if ledger insert races
            if (error.code === 'ER_DUP_ENTRY') {
                this.stats.skippedDuplicate++;
                return { proceed: false, skipped: true, reason: 'duplicate_key' };
            }
            console.error('Consumer idempotency begin error:', error.message);
            // Fail open only for missing table during migration
            if (error.code === 'ER_NO_SUCH_TABLE') {
                return { proceed: true, skipped: false, legacy: true };
            }
            throw error;
        }
    }

    async completeConsumerIdempotency(idempotencyKey, consumer = 'outbox-dispatcher', failed = false) {
        if (!idempotencyKey) return;
        try {
            await db.query(
                `UPDATE outbox_idempotency_ledger
                 SET status = ?, completed_at = NOW()
                 WHERE idempotency_key = ? AND consumer = ?`,
                [failed ? 'failed' : 'completed', idempotencyKey, consumer]
            );
        } catch (error) {
            if (error.code !== 'ER_NO_SUCH_TABLE') {
                console.error('Consumer idempotency complete error:', error.message);
            }
        }
    }

    /**
     * Process pending events with per-row optimistic claims
     */
    async processPendingEvents() {
        try {
            // Unlock stale processors first so retries are eligible
            await this.resetStaleProcessingLocks();

            // Only the batch claim belongs in the transaction. A handler can be
            // arbitrarily slow, and running the loop below inside this would
            // hold both the row locks taken by SKIP LOCKED and a pooled
            // connection for its whole duration, starving every other
            // processor.
            const events = await withTransaction(async (connection) => {
                const [rows] = await connection.query(
                    `SELECT * FROM outbox_events 
                     WHERE status IN (?, ?)
                     AND attempts < max_attempts
                     ORDER BY created_at ASC
                     LIMIT ?
                     FOR UPDATE SKIP LOCKED`,
                    [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.RETRY, OUTBOX_CONFIG.batchSize]
                );
                return rows;
            });

            if (events.length === 0) {
                return;
            }

            for (const eventRow of events) {
                const claimed = await this.claimEventWithOptimisticLock(eventRow);
                if (!claimed) {
                    continue;
                }

                let data = eventRow.data;
                let metadata = eventRow.metadata;
                try {
                    data = typeof data === 'string' ? JSON.parse(data) : data;
                    metadata = typeof metadata === 'string' ? JSON.parse(metadata || '{}') : (metadata || {});
                } catch {
                    data = {};
                    metadata = {};
                }

                const event = {
                    id: eventRow.event_id,
                    type: eventRow.event_type,
                    data,
                    metadata,
                    status: OUTBOX_STATUS.PROCESSING,
                    attempts: eventRow.attempts,
                    maxAttempts: eventRow.max_attempts,
                    version: eventRow.version,
                    idempotencyKey: eventRow.idempotency_key
                        || data.idempotencyKey
                        || metadata.idempotencyKey,
                    createdAt: eventRow.created_at,
                    updatedAt: eventRow.updated_at,
                    error: eventRow.error
                };

                await this.processEvent(event);
            }
        } catch (error) {
            console.error('Process pending events error:', error);
        }
    }

    /**
     * Process a single event with consumer-side idempotency gate
     */
    async processEvent(event) {
        const idempotencyKey = event.idempotencyKey
            || this.generateIdempotencyKey(event.type, event.data, event.metadata?.occurredAt);

        const gate = await this.beginConsumerIdempotency(
            idempotencyKey,
            event.id,
            event.type,
            'outbox-dispatcher'
        );

        if (!gate.proceed) {
            await this.updateEventStatus(event.id, OUTBOX_STATUS.COMPLETED, {
                version: event.version
            });
            console.log(`⏭️ Skipped duplicate dispatch: ${event.type} (${event.id})`);
            return;
        }

        try {
            const handlers = this.eventHandlers.get(event.type) || [];

            if (handlers.length === 0) {
                console.warn(`No handlers for event type: ${event.type}`);
                await this.completeConsumerIdempotency(idempotencyKey);
                await this.updateEventStatus(event.id, OUTBOX_STATUS.COMPLETED, {
                    version: event.version
                });
                return;
            }

            const payload = {
                ...event,
                data: {
                    ...event.data,
                    idempotencyKey
                },
                idempotencyKey
            };

            for (const handler of handlers) {
                await handler(payload);
            }

            await this.completeConsumerIdempotency(idempotencyKey);
            await this.updateEventStatus(event.id, OUTBOX_STATUS.COMPLETED, {
                version: event.version
            });
            this.stats.processed++;

            console.log(`✅ Event processed: ${event.type} (${event.id})`);
        } catch (error) {
            console.error(`Error processing event ${event.id}:`, error);

            await this.completeConsumerIdempotency(idempotencyKey, 'outbox-dispatcher', true);

            const newAttempts = event.attempts + 1;
            const newStatus = newAttempts >= event.maxAttempts
                ? OUTBOX_STATUS.FAILED
                : OUTBOX_STATUS.RETRY;

            await this.updateEventStatus(event.id, newStatus, {
                attempts: newAttempts,
                error: error.message,
                version: event.version,
                clearProcessingLock: true
            });

            if (newStatus === OUTBOX_STATUS.FAILED) {
                this.stats.failed++;
                console.error(`💀 Event permanently failed: ${event.type} (${event.id})`);
            } else {
                this.stats.retried++;
                console.log(`🔄 Event retrying: ${event.type} (${event.id}) attempt ${newAttempts}`);
            }
        }
    }

    /**
     * Update event status (optionally with optimistic version bump)
     */
    async updateEventStatus(eventId, status, additional = {}) {
        const updatedAt = new Date().toISOString();
        const processedAt = status === OUTBOX_STATUS.COMPLETED
            ? new Date().toISOString()
            : null;

        const clearLock = status === OUTBOX_STATUS.COMPLETED
            || status === OUTBOX_STATUS.FAILED
            || status === OUTBOX_STATUS.RETRY
            || additional.clearProcessingLock;

        if (additional.version != null) {
            const [result] = await db.query(
                `UPDATE outbox_events 
                 SET status = ?, 
                     attempts = COALESCE(?, attempts),
                     error = COALESCE(?, error),
                     processed_at = COALESCE(?, processed_at),
                     processing_started_at = IF(?, NULL, processing_started_at),
                     version = version + 1,
                     updated_at = ?
                 WHERE event_id = ?
                   AND version = ?`,
                [
                    status,
                    additional.attempts != null ? additional.attempts : null,
                    additional.error != null ? additional.error : null,
                    processedAt,
                    clearLock ? 1 : 0,
                    updatedAt,
                    eventId,
                    additional.version
                ]
            );

            if (!result.affectedRows) {
                this.stats.optimisticLockConflicts++;
                console.warn(`Optimistic lock miss on status update for ${eventId}`);
            }
            return;
        }

        await db.query(
            `UPDATE outbox_events 
             SET status = ?, 
                 attempts = COALESCE(?, attempts),
                 error = COALESCE(?, error),
                 processed_at = COALESCE(?, processed_at),
                 processing_started_at = IF(?, NULL, processing_started_at),
                 updated_at = ?
             WHERE event_id = ?`,
            [
                status,
                additional.attempts != null ? additional.attempts : null,
                additional.error != null ? additional.error : null,
                processedAt,
                clearLock ? 1 : 0,
                updatedAt,
                eventId
            ]
        );
    }

    /**
     * Clean up old events (keep idempotency ledger longer)
     */
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

            if (result.affectedRows > 0) {
                console.log(`🧹 Cleaned up ${result.affectedRows} old events`);
            }

            // Only purge ledger rows past long retention (avoid early expiration re-dispatch)
            const ledgerCutoff = new Date();
            ledgerCutoff.setDate(
                ledgerCutoff.getDate() - OUTBOX_CONFIG.idempotencyRetentionDays
            );
            await db.query(
                `DELETE FROM outbox_idempotency_ledger
                 WHERE status = 'completed'
                   AND (expires_at IS NOT NULL AND expires_at < NOW()
                        OR completed_at < ?)`,
                [ledgerCutoff.toISOString()]
            );
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }

    /**
     * Get event statistics
     */
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

            let ledger = null;
            try {
                const [ledgerRows] = await db.query(
                    `SELECT
                        COUNT(*) as ledger_total,
                        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as ledger_completed
                     FROM outbox_idempotency_ledger`
                );
                ledger = ledgerRows[0];
            } catch (_) {
                ledger = null;
            }

            return {
                ...stats[0],
                ...this.stats,
                ledger,
                staleProcessingMs: OUTBOX_CONFIG.staleProcessingMs,
                idempotencyRetentionDays: OUTBOX_CONFIG.idempotencyRetentionDays,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            return null;
        }
    }

    /**
     * Retry failed events
     */
    async retryFailedEvents() {
        await db.query(
            `UPDATE outbox_events 
             SET status = ?, 
                 processing_started_at = NULL,
                 updated_at = NOW()
             WHERE status = ? 
             AND attempts < max_attempts`,
            [OUTBOX_STATUS.RETRY, OUTBOX_STATUS.FAILED]
        );

        console.log('🔄 Retried failed events');
    }

    /**
     * Get pending events count
     */
    async getPendingCount() {
        const [result] = await db.query(
            'SELECT COUNT(*) as count FROM outbox_events WHERE status = ?',
            [OUTBOX_STATUS.PENDING]
        );
        return result[0]?.count || 0;
    }

    /**
     * Check whether an idempotency key was already consumed
     */
    async checkIdempotency(idempotencyKey, consumer = 'outbox-dispatcher') {
        const [rows] = await db.query(
            `SELECT status, event_id, completed_at, expires_at
             FROM outbox_idempotency_ledger
             WHERE idempotency_key = ? AND consumer = ?
             LIMIT 1`,
            [idempotencyKey, consumer]
        );
        if (!rows.length) {
            return { exists: false, completed: false };
        }
        return {
            exists: true,
            completed: rows[0].status === 'completed',
            status: rows[0].status,
            eventId: rows[0].event_id,
            completedAt: rows[0].completed_at,
            expiresAt: rows[0].expires_at
        };
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    async processOrderCreated(data) {
        await this.sendNotification({
            userId: data.userId,
            type: 'order_confirmation',
            template: 'order-confirmation',
            idempotencyKey: data.idempotencyKey,
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
            idempotencyKey: data.idempotencyKey,
            timestamp: new Date().toISOString()
        });

        await this.updateRecommendations({
            userId: data.userId,
            orderId: data.orderId,
            items: data.items,
            idempotencyKey: data.idempotencyKey
        });
    }

    async processOrderCompleted(data) {
        await this.sendNotification({
            userId: data.userId,
            type: 'order_completed',
            template: 'order-completed',
            idempotencyKey: data.idempotencyKey,
            data: {
                orderId: data.orderId,
                deliveryDate: data.deliveryDate
            }
        });

        await this.updateAnalytics({
            event: 'order_completed',
            userId: data.userId,
            orderId: data.orderId,
            idempotencyKey: data.idempotencyKey,
            timestamp: new Date().toISOString()
        });
    }

    async processPaymentCompleted(data) {
        await this.sendNotification({
            userId: data.userId,
            type: 'payment_confirmation',
            template: 'payment-confirmation',
            idempotencyKey: data.idempotencyKey,
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
            idempotencyKey: data.idempotencyKey,
            timestamp: new Date().toISOString()
        });
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    async sendNotification(data) {
        console.log(`📧 Notification: ${data.type} for user ${data.userId} key=${data.idempotencyKey || 'n/a'}`);
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

// ============================================
// EXPORT
// ============================================

module.exports = {
    OutboxService,
    OUTBOX_STATUS,
    EVENT_TYPES,
    OUTBOX_CONFIG,
    outboxService: new OutboxService()
};
