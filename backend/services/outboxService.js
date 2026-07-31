// backend/services/outboxService.js
const db = require('../config/db');
const crypto = require('crypto');

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
    
    // Processing
    processingTimeout: 60000, // 1 minute
    concurrentProcessors: 3
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
            total: 0
        };
        this.pollInterval = null;
        this.cleanupInterval = null;
    }

    /**
     * Initialize outbox service
     */
    async initialize() {
        if (this.isRunning) return;

        // Register default event handlers
        this.registerDefaultHandlers();

        // Start polling
        this.startPolling();

        // Start cleanup
        this.startCleanup();

        this.isRunning = true;
        console.log('✅ Outbox Service initialized');
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
        // Order event handlers
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

        // Notification handlers
        this.registerHandler(EVENT_TYPES.NOTIFICATION_SENT, async (event) => {
            console.log(`📧 Notification sent: ${event.data.notificationId}`);
        });

        // Analytics handlers
        this.registerHandler(EVENT_TYPES.ANALYTICS_TRACKED, async (event) => {
            console.log(`📊 Analytics tracked: ${event.data.eventType}`);
        });

        // Recommendation handlers
        this.registerHandler(EVENT_TYPES.RECOMMENDATION_UPDATED, async (event) => {
            console.log(`🎯 Recommendations updated for user: ${event.data.userId}`);
        });
    }

    /**
     * Store event in outbox
     */
    async storeEvent(eventType, data, metadata = {}) {
        const event = {
            id: this.generateEventId(),
            type: eventType,
            data,
            metadata,
            status: OUTBOX_STATUS.PENDING,
            attempts: 0,
            maxAttempts: OUTBOX_CONFIG.maxRetries,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            processedAt: null,
            error: null
        };

        try {
            await db.query(
                `INSERT INTO outbox_events 
                 (event_id, event_type, data, metadata, status, attempts, 
                  max_attempts, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    event.id,
                    event.type,
                    JSON.stringify(event.data),
                    JSON.stringify(event.metadata),
                    event.status,
                    event.attempts,
                    event.maxAttempts,
                    event.createdAt,
                    event.updatedAt
                ]
            );

            this.stats.total++;
            console.log(`📝 Event stored: ${event.type} (${event.id})`);

            return event;
        } catch (error) {
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

        // Initial processing
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
     * Process pending events
     */
    async processPendingEvents() {
        const connection = await db.getConnection();
        try {
            await connection.query('START TRANSACTION');

            // Get pending events using SKIP LOCKED to prevent race conditions
            const [events] = await connection.query(
                `SELECT * FROM outbox_events 
                 WHERE status IN (?, ?)
                 AND attempts < max_attempts
                 ORDER BY created_at ASC
                 LIMIT ?
                 FOR UPDATE SKIP LOCKED`,
                [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.RETRY, OUTBOX_CONFIG.batchSize]
            );

            if (events.length === 0) {
                await connection.query('COMMIT');
                connection.release();
                return;
            }

            // Mark events as processing atomically
            const eventIds = events.map(e => e.event_id);
            await connection.query(
                `UPDATE outbox_events SET status = ? WHERE event_id IN (?)`,
                [OUTBOX_STATUS.PROCESSING, eventIds]
            );

            await connection.query('COMMIT');
            connection.release();

            // Process each event
            for (const eventRow of events) {
                const event = {
                    id: eventRow.event_id,
                    type: eventRow.event_type,
                    data: JSON.parse(eventRow.data),
                    metadata: JSON.parse(eventRow.metadata || '{}'),
                    status: OUTBOX_STATUS.PROCESSING,
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
                await connection.query('ROLLBACK');
                connection.release();
            }
            console.error('Process pending events error:', error);
        }
    }

    /**
     * Process a single event
     */
    async processEvent(event) {
        // Update status to processing
        await this.updateEventStatus(event.id, OUTBOX_STATUS.PROCESSING);

        try {
            // Get handlers for this event type
            const handlers = this.eventHandlers.get(event.type) || [];

            if (handlers.length === 0) {
                console.warn(`No handlers for event type: ${event.type}`);
                await this.updateEventStatus(event.id, OUTBOX_STATUS.COMPLETED);
                return;
            }

            // Execute all handlers
            for (const handler of handlers) {
                await handler(event);
            }

            // Update status to completed
            await this.updateEventStatus(event.id, OUTBOX_STATUS.COMPLETED);
            this.stats.processed++;

            console.log(`✅ Event processed: ${event.type} (${event.id})`);

        } catch (error) {
            console.error(`Error processing event ${event.id}:`, error);

            // Increment attempts
            const newAttempts = event.attempts + 1;
            const newStatus = newAttempts >= event.maxAttempts 
                ? OUTBOX_STATUS.FAILED 
                : OUTBOX_STATUS.RETRY;

            await this.updateEventStatus(event.id, newStatus, {
                attempts: newAttempts,
                error: error.message,
                updatedAt: new Date().toISOString()
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
     * Update event status
     */
    async updateEventStatus(eventId, status, additional = {}) {
        const updates = {
            status,
            updatedAt: new Date().toISOString(),
            ...additional
        };

        if (status === OUTBOX_STATUS.COMPLETED) {
            updates.processedAt = new Date().toISOString();
        }

        await db.query(
            `UPDATE outbox_events 
             SET status = ?, 
                 attempts = COALESCE(?, attempts),
                 error = COALESCE(?, error),
                 processed_at = COALESCE(?, processed_at),
                 updated_at = ?
             WHERE event_id = ?`,
            [
                status,
                additional.attempts || null,
                additional.error || null,
                updates.processedAt || null,
                updates.updatedAt,
                eventId
            ]
        );
    }

    /**
     * Clean up old events
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

            return {
                ...stats[0],
                ...this.stats,
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

    // ============================================
    // EVENT HANDLERS
    // ============================================

    /**
     * Process order created event
     */
    async processOrderCreated(data) {
        // Send notification
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

        // Update analytics
        await this.updateAnalytics({
            event: 'order_created',
            userId: data.userId,
            orderId: data.orderId,
            total: data.total,
            timestamp: new Date().toISOString()
        });

        // Update recommendations
        await this.updateRecommendations({
            userId: data.userId,
            orderId: data.orderId,
            items: data.items
        });
    }

    /**
     * Process order completed event
     */
    async processOrderCompleted(data) {
        // Send delivery notification
        await this.sendNotification({
            userId: data.userId,
            type: 'order_completed',
            template: 'order-completed',
            data: {
                orderId: data.orderId,
                deliveryDate: data.deliveryDate
            }
        });

        // Update analytics
        await this.updateAnalytics({
            event: 'order_completed',
            userId: data.userId,
            orderId: data.orderId,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Process payment completed event
     */
    async processPaymentCompleted(data) {
        // Send payment confirmation
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

        // Update analytics
        await this.updateAnalytics({
            event: 'payment_completed',
            userId: data.userId,
            paymentId: data.paymentId,
            amount: data.amount,
            timestamp: new Date().toISOString()
        });
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    /**
     * Send notification (simplified)
     */
    async sendNotification(data) {
        // In production, send actual notification
        console.log(`📧 Notification: ${data.type} for user ${data.userId}`);
        return { sent: true };
    }

    /**
     * Update analytics (simplified)
     */
    async updateAnalytics(data) {
        // In production, update analytics
        console.log(`📊 Analytics: ${data.event}`);
        return { updated: true };
    }

    /**
     * Update recommendations (simplified)
     */
    async updateRecommendations(data) {
        // In production, update recommendations
        console.log(`🎯 Recommendations updated for user ${data.userId}`);
        return { updated: true };
    }

    /**
     * Generate event ID
     */
    generateEventId() {
        return `EVT_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    /**
     * Stop the outbox service
     */
    async shutdown() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
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
    outboxService: new OutboxService()
};