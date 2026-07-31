// backend/services/notificationBrokerService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// NOTIFICATION BROKER CONFIGURATION
// ============================================

const NOTIFICATION_TYPES = {
    PRODUCT_BACK_IN_STOCK: 'product.back_in_stock',
    ORDER_DELIVERED: 'order.delivered',
    COUPON_EXPIRED: 'coupon.expired',
    WISHLIST_PRICE_DROP: 'wishlist.price_drop',
    PAYMENT_CONFIRMED: 'payment.confirmed',
    ORDER_SHIPPED: 'order.shipped',
    ORDER_CANCELLED: 'order.cancelled',
    LOW_STOCK_ALERT: 'low.stock.alert',
    PRICE_CHANGE: 'price.change',
    NEW_PRODUCT: 'new.product',
    REVIEW_ADDED: 'review.added',
    PROMOTION_STARTED: 'promotion.started'
};

const NOTIFICATION_PRIORITY = {
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
};

const NOTIFICATION_STATUS = {
    PENDING: 'pending',
    SENT: 'sent',
    DELIVERED: 'delivered',
    READ: 'read',
    FAILED: 'failed'
};

const CHANNEL_TYPES = {
    EMAIL: 'email',
    SMS: 'sms',
    PUSH: 'push',
    IN_APP: 'in_app',
    WEBHOOK: 'webhook'
};

// ============================================
// NOTIFICATION BROKER
// ============================================

class NotificationBroker extends EventEmitter {
    constructor() {
        super();
        this.subscribers = new Map();
        this.notifications = new Map();
        this.channels = new Map();
        this.deliveryQueue = [];
        this.failedNotifications = [];
        this.isProcessing = false;
        this.retryQueue = [];
    }

    /**
     * Initialize notification broker
     */
    async initialize() {
        // Load subscribers from database
        await this.loadSubscribers();

        // Load pending notifications
        await this.loadPendingNotifications();

        // Start processing
        this.startProcessing();

        console.log('✅ Notification Broker initialized');
        return this;
    }

    /**
     * Register a notification channel
     */
    registerChannel(type, handler, config = {}) {
        this.channels.set(type, {
            handler,
            config,
            registeredAt: new Date().toISOString()
        });

        console.log(`📢 Channel registered: ${type}`);
        return this;
    }

    /**
     * Subscribe to notifications
     */
    subscribe(notificationType, handler, options = {}) {
        if (!this.subscribers.has(notificationType)) {
            this.subscribers.set(notificationType, []);
        }

        const subscription = {
            id: this.generateSubscriptionId(),
            handler,
            options,
            createdAt: new Date().toISOString()
        };

        this.subscribers.get(notificationType).push(subscription);

        // Store in database
        this.storeSubscription(notificationType, subscription);

        console.log(`📬 Subscribed to: ${notificationType}`);
        return subscription;
    }

    /**
     * Publish a notification
     */
    async publish(notificationType, data, options = {}) {
        const notification = {
            id: this.generateNotificationId(),
            type: notificationType,
            data,
            priority: options.priority || NOTIFICATION_PRIORITY.MEDIUM,
            channels: options.channels || ['in_app'],
            status: NOTIFICATION_STATUS.PENDING,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deliveredAt: null,
            readAt: null,
            metadata: options.metadata || {},
            retryCount: 0,
            maxRetries: options.maxRetries || 3
        };

        // Store notification
        this.notifications.set(notification.id, notification);
        this.deliveryQueue.push(notification);

        await this.storeNotification(notification);

        console.log(`📨 Notification published: ${notificationType} (${notification.id})`);
        this.emit('notification.published', notification);

        // Process immediately if high priority
        if (notification.priority === NOTIFICATION_PRIORITY.HIGH) {
            await this.processNotification(notification);
        }

        return notification;
    }

    /**
     * Process notifications from queue
     */
    startProcessing() {
        if (this.isProcessing) return;

        this.isProcessing = true;
        this.processQueue();

        console.log('🔄 Notification processing started');
    }

    /**
     * Process the delivery queue
     */
    async processQueue() {
        if (!this.isProcessing) return;

        while (this.deliveryQueue.length > 0) {
            const notification = this.deliveryQueue.shift();
            await this.processNotification(notification);
        }

        // Process retries
        await this.processRetries();

        // Schedule next check
        setTimeout(() => this.processQueue(), 5000);
    }

    /**
     * Process a single notification
     */
    async processNotification(notification) {
        try {
            // Get subscribers
            const subscribers = this.subscribers.get(notification.type) || [];

            // If no subscribers, mark as delivered but log
            if (subscribers.length === 0) {
                notification.status = NOTIFICATION_STATUS.DELIVERED;
                notification.deliveredAt = new Date().toISOString();
                await this.updateNotification(notification);
                return;
            }

            // Deliver to each subscriber
            const deliveryResults = [];

            for (const subscriber of subscribers) {
                try {
                    const result = await subscriber.handler(notification.data, notification);
                    deliveryResults.push({
                        subscriberId: subscriber.id,
                        success: true,
                        result
                    });
                } catch (error) {
                    deliveryResults.push({
                        subscriberId: subscriber.id,
                        success: false,
                        error: error.message
                    });
                }
            }

            // Check if all deliveries succeeded
            const allSucceeded = deliveryResults.every(r => r.success);

            if (allSucceeded) {
                notification.status = NOTIFICATION_STATUS.DELIVERED;
                notification.deliveredAt = new Date().toISOString();
            } else {
                // Some deliveries failed
                const failedCount = deliveryResults.filter(r => !r.success).length;
                notification.status = NOTIFICATION_STATUS.PENDING;

                if (notification.retryCount < notification.maxRetries) {
                    notification.retryCount++;
                    this.retryQueue.push(notification);
                    console.warn(`⚠️ Notification ${notification.id} has ${failedCount} failed deliveries, retrying (${notification.retryCount}/${notification.maxRetries})`);
                } else {
                    notification.status = NOTIFICATION_STATUS.FAILED;
                    this.failedNotifications.push(notification);
                    console.error(`❌ Notification ${notification.id} failed after ${notification.retryCount} retries`);
                }
            }

            // Send through channels
            await this.sendThroughChannels(notification);

            await this.updateNotification(notification);

            this.emit('notification.processed', {
                notificationId: notification.id,
                status: notification.status
            });

        } catch (error) {
            console.error(`Error processing notification ${notification.id}:`, error);

            if (notification.retryCount < notification.maxRetries) {
                notification.retryCount++;
                this.retryQueue.push(notification);
            } else {
                notification.status = NOTIFICATION_STATUS.FAILED;
                this.failedNotifications.push(notification);
                await this.updateNotification(notification);
            }
        }
    }

    /**
     * Send notification through channels
     */
    async sendThroughChannels(notification) {
        const channels = notification.channels || ['in_app'];

        for (const channelType of channels) {
            const channel = this.channels.get(channelType);
            if (!channel) continue;

            try {
                await channel.handler(notification.data, notification);
                console.log(`📤 Notification sent via ${channelType}: ${notification.id}`);
            } catch (error) {
                console.error(`Failed to send via ${channelType}:`, error);
            }
        }
    }

    /**
     * Process retries
     */
    async processRetries() {
        while (this.retryQueue.length > 0) {
            const notification = this.retryQueue.shift();
            await this.processNotification(notification);
        }
    }

    /**
     * Mark notification as read
     */
    async markAsRead(notificationId, userId) {
        const notification = this.notifications.get(notificationId);
        if (!notification) {
            throw new Error(`Notification not found: ${notificationId}`);
        }

        notification.status = NOTIFICATION_STATUS.READ;
        notification.readAt = new Date().toISOString();
        notification.readBy = userId;

        await this.updateNotification(notification);

        this.emit('notification.read', { notificationId, userId });

        return notification;
    }

    /**
     * Get user notifications
     */
    async getUserNotifications(userId, filters = {}) {
        const { limit = 20, offset = 0, status = null } = filters;

        let query = `SELECT * FROM notifications WHERE user_id = ?`;
        const params = [userId];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [rows] = await db.query(query, params);

        return rows.map(row => ({
            ...row,
            data: JSON.parse(row.data),
            metadata: JSON.parse(row.metadata || '{}')
        }));
    }

    /**
     * Get unread count
     */
    async getUnreadCount(userId) {
        const [rows] = await db.query(
            `SELECT COUNT(*) as count FROM notifications 
             WHERE user_id = ? AND status != ?`,
            [userId, NOTIFICATION_STATUS.READ]
        );

        return rows[0]?.count || 0;
    }

    /**
     * Retry failed notification
     */
    async retryNotification(notificationId) {
        const notification = this.notifications.get(notificationId);
        if (!notification) {
            throw new Error(`Notification not found: ${notificationId}`);
        }

        if (notification.status !== NOTIFICATION_STATUS.FAILED) {
            throw new Error(`Notification is not in failed state`);
        }

        notification.status = NOTIFICATION_STATUS.PENDING;
        notification.retryCount = 0;

        this.deliveryQueue.push(notification);
        await this.updateNotification(notification);

        this.emit('notification.retry', { notificationId });

        return notification;
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateNotificationId() {
        return `NOTIF_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateSubscriptionId() {
        return `SUB_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadSubscribers() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM notification_subscribers WHERE active = 1'
            );

            for (const row of rows) {
                const handler = eval(row.handler); // Use with caution in production
                if (!this.subscribers.has(row.notification_type)) {
                    this.subscribers.set(row.notification_type, []);
                }

                this.subscribers.get(row.notification_type).push({
                    id: row.subscription_id,
                    handler,
                    options: JSON.parse(row.options || '{}'),
                    createdAt: row.created_at
                });
            }

            console.log(`📬 Loaded ${rows.length} subscribers`);
        } catch (error) {
            console.error('Load subscribers error:', error);
        }
    }

    async loadPendingNotifications() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM notifications 
                 WHERE status IN (?, ?) 
                 ORDER BY created_at ASC`,
                [NOTIFICATION_STATUS.PENDING, NOTIFICATION_STATUS.PENDING]
            );

            for (const row of rows) {
                const notification = {
                    ...row,
                    data: JSON.parse(row.data),
                    metadata: JSON.parse(row.metadata || '{}')
                };

                this.notifications.set(notification.id, notification);
                this.deliveryQueue.push(notification);
            }

            console.log(`📨 Loaded ${rows.length} pending notifications`);
        } catch (error) {
            console.error('Load pending notifications error:', error);
        }
    }

    async storeNotification(notification) {
        try {
            await db.query(
                `INSERT INTO notifications 
                 (notification_id, type, data, priority, channels, status,
                  user_id, created_at, updated_at, metadata, retry_count, max_retries)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    notification.id,
                    notification.type,
                    JSON.stringify(notification.data),
                    notification.priority,
                    JSON.stringify(notification.channels),
                    notification.status,
                    notification.data.userId || null,
                    notification.createdAt,
                    notification.updatedAt,
                    JSON.stringify(notification.metadata),
                    notification.retryCount,
                    notification.maxRetries
                ]
            );
        } catch (error) {
            console.error('Store notification error:', error);
        }
    }

    async updateNotification(notification) {
        try {
            await db.query(
                `UPDATE notifications 
                 SET status = ?, updated_at = ?, delivered_at = ?, read_at = ?,
                     retry_count = ?
                 WHERE notification_id = ?`,
                [
                    notification.status,
                    notification.updatedAt,
                    notification.deliveredAt || null,
                    notification.readAt || null,
                    notification.retryCount,
                    notification.id
                ]
            );
        } catch (error) {
            console.error('Update notification error:', error);
        }
    }

    async storeSubscription(notificationType, subscription) {
        try {
            await db.query(
                `INSERT INTO notification_subscribers 
                 (subscription_id, notification_type, handler, options, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    subscription.id,
                    notificationType,
                    subscription.handler.toString(),
                    JSON.stringify(subscription.options),
                    subscription.createdAt
                ]
            );
        } catch (error) {
            console.error('Store subscription error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_notifications,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
                SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as read,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                COUNT(DISTINCT type) as unique_types
             FROM notifications`
        );

        return {
            ...stats[0],
            pendingRetries: this.retryQueue.length,
            activeSubscribers: Array.from(this.subscribers.values()).reduce((acc, s) => acc + s.length, 0),
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            notifications: this.notifications.size,
            pendingQueue: this.deliveryQueue.length,
            retryQueue: this.retryQueue.length,
            failedCount: this.failedNotifications.length,
            subscribers: this.subscribers.size,
            channels: this.channels.size,
            types: Object.values(NOTIFICATION_TYPES)
        };
    }
}

// ============================================
// DEFAULT CHANNEL HANDLERS
// ============================================

// In-App Notification Channel
const inAppChannel = {
    handler: async (data, notification) => {
        console.log(`📱 In-App notification: ${notification.type}`, data);
        return { delivered: true };
    }
};

// Email Channel
const emailChannel = {
    handler: async (data, notification) => {
        console.log(`📧 Email notification: ${notification.type}`, data);
        return { delivered: true };
    }
};

// Webhook Channel
const webhookChannel = {
    handler: async (data, notification) => {
        console.log(`🔗 Webhook notification: ${notification.type}`, data);
        return { delivered: true };
    }
};

// ============================================
// EXPORT
// ============================================

module.exports = {
    NotificationBroker,
    NOTIFICATION_TYPES,
    NOTIFICATION_PRIORITY,
    NOTIFICATION_STATUS,
    CHANNEL_TYPES,
    inAppChannel,
    emailChannel,
    webhookChannel,
    notificationBroker: new NotificationBroker()
};