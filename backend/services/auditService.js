// backend/services/auditService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// AUDIT CONFIGURATION
// ============================================

const AUDIT_ACTIONS = {
    // Product actions
    PRODUCT_CREATED: 'product.created',
    PRODUCT_UPDATED: 'product.updated',
    PRODUCT_DELETED: 'product.deleted',
    PRODUCT_RESTORED: 'product.restored',
    PRODUCT_PRICE_CHANGED: 'product.price.changed',
    PRODUCT_STOCK_CHANGED: 'product.stock.changed',
    
    // Order actions
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_STATUS_CHANGED: 'order.status.changed',
    ORDER_REFUNDED: 'order.refunded',
    
    // User actions
    USER_CREATED: 'user.created',
    USER_UPDATED: 'user.updated',
    USER_DELETED: 'user.deleted',
    USER_ROLE_CHANGED: 'user.role.changed',
    USER_LOGGED_IN: 'user.logged.in',
    USER_LOGGED_OUT: 'user.logged.out',
    
    // Admin actions
    ADMIN_ACTION: 'admin.action',
    ADMIN_LOGIN: 'admin.login',
    ADMIN_LOGOUT: 'admin.logout',
    
    // Coupon actions
    COUPON_CREATED: 'coupon.created',
    COUPON_UPDATED: 'coupon.updated',
    COUPON_DELETED: 'coupon.deleted',
    COUPON_APPLIED: 'coupon.applied',
    
    // Inventory actions
    INVENTORY_UPDATED: 'inventory.updated',
    INVENTORY_SYNC: 'inventory.sync',
    INVENTORY_ADJUSTED: 'inventory.adjusted',
    
    // Payment actions
    PAYMENT_CREATED: 'payment.created',
    PAYMENT_COMPLETED: 'payment.completed',
    PAYMENT_FAILED: 'payment.failed',
    PAYMENT_REFUNDED: 'payment.refunded',
    
    // Settings actions
    SETTINGS_UPDATED: 'settings.updated',
    SETTINGS_RESET: 'settings.reset',
    
    // Security actions
    SECURITY_ALERT: 'security.alert',
    SECURITY_BLOCKED: 'security.blocked',
    SECURITY_VERIFIED: 'security.verified'
};

const AUDIT_RESOURCES = {
    PRODUCT: 'product',
    ORDER: 'order',
    USER: 'user',
    ADMIN: 'admin',
    COUPON: 'coupon',
    INVENTORY: 'inventory',
    PAYMENT: 'payment',
    SETTINGS: 'settings',
    SECURITY: 'security'
};

// ============================================
// AUDIT SERVICE
// ============================================

class AuditService {
    constructor() {
        this.auditQueue = [];
        this.isProcessing = false;
        this.initialized = false;
        this.bufferSize = 100;
        this.flushInterval = 5000; // 5 seconds
        this.auditLogs = [];
    }

    /**
     * Initialize audit service
     */
    async initialize() {
        if (this.initialized) return;

        // Start periodic flush
        setInterval(() => this.flushQueue(), this.flushInterval);

        this.initialized = true;
        console.log('✅ Audit Service initialized');
        return this;
    }

    /**
     * Log an audit entry
     */
    async log(entry) {
        const auditEntry = {
            id: this.generateAuditId(),
            actor: entry.actor || 'system',
            actorId: entry.actorId || null,
            actorIp: entry.actorIp || null,
            actorUserAgent: entry.actorUserAgent || null,
            action: entry.action,
            resource: entry.resource,
            resourceId: entry.resourceId || null,
            previousState: entry.previousState || null,
            updatedState: entry.updatedState || null,
            changes: entry.changes || null,
            metadata: entry.metadata || {},
            timestamp: new Date().toISOString(),
            hash: null
        };

        // Generate hash for integrity
        auditEntry.hash = this.generateHash(auditEntry);

        // Add to queue for batch processing
        this.auditQueue.push(auditEntry);
        this.auditLogs.push(auditEntry);

        // If queue is large enough, flush immediately
        if (this.auditQueue.length >= this.bufferSize) {
            await this.flushQueue();
        }

        // Emit event for real-time monitoring
        this.emitAuditEvent(auditEntry);

        return auditEntry;
    }

    /**
     * Log a product action
     */
    async logProductAction(action, productId, actor, changes = {}) {
        return this.log({
            actor: actor.name || actor.email || 'system',
            actorId: actor.id,
            actorIp: actor.ip,
            actorUserAgent: actor.userAgent,
            action,
            resource: AUDIT_RESOURCES.PRODUCT,
            resourceId: productId,
            previousState: changes.previous,
            updatedState: changes.updated,
            changes: this.detectChanges(changes.previous, changes.updated),
            metadata: {
                productName: changes.productName,
                category: changes.category
            }
        });
    }

    /**
     * Log an order action
     */
    async logOrderAction(action, orderId, actor, changes = {}) {
        return this.log({
            actor: actor.name || actor.email || 'system',
            actorId: actor.id,
            actorIp: actor.ip,
            actorUserAgent: actor.userAgent,
            action,
            resource: AUDIT_RESOURCES.ORDER,
            resourceId: orderId,
            previousState: changes.previous,
            updatedState: changes.updated,
            changes: this.detectChanges(changes.previous, changes.updated),
            metadata: {
                orderTotal: changes.total,
                orderStatus: changes.status
            }
        });
    }

    /**
     * Log a user action
     */
    async logUserAction(action, userId, actor, changes = {}) {
        return this.log({
            actor: actor.name || actor.email || 'system',
            actorId: actor.id,
            actorIp: actor.ip,
            actorUserAgent: actor.userAgent,
            action,
            resource: AUDIT_RESOURCES.USER,
            resourceId: userId,
            previousState: changes.previous,
            updatedState: changes.updated,
            changes: this.detectChanges(changes.previous, changes.updated),
            metadata: {
                userEmail: changes.email,
                userRole: changes.role
            }
        });
    }

    /**
     * Log an admin action
     */
    async logAdminAction(action, actor, details = {}) {
        return this.log({
            actor: actor.name || actor.email || 'system',
            actorId: actor.id,
            actorIp: actor.ip,
            actorUserAgent: actor.userAgent,
            action: AUDIT_ACTIONS.ADMIN_ACTION,
            resource: AUDIT_RESOURCES.ADMIN,
            resourceId: actor.id,
            metadata: {
                actionType: action,
                details
            }
        });
    }

    /**
     * Log a coupon action
     */
    async logCouponAction(action, couponId, actor, changes = {}) {
        return this.log({
            actor: actor.name || actor.email || 'system',
            actorId: actor.id,
            actorIp: actor.ip,
            actorUserAgent: actor.userAgent,
            action,
            resource: AUDIT_RESOURCES.COUPON,
            resourceId: couponId,
            previousState: changes.previous,
            updatedState: changes.updated,
            changes: this.detectChanges(changes.previous, changes.updated),
            metadata: {
                couponCode: changes.code,
                couponDiscount: changes.discount
            }
        });
    }

    /**
     * Log an inventory action
     */
    async logInventoryAction(action, productId, actor, changes = {}) {
        return this.log({
            actor: actor.name || actor.email || 'system',
            actorId: actor.id,
            actorIp: actor.ip,
            actorUserAgent: actor.userAgent,
            action,
            resource: AUDIT_RESOURCES.INVENTORY,
            resourceId: productId,
            previousState: changes.previous,
            updatedState: changes.updated,
            changes: this.detectChanges(changes.previous, changes.updated),
            metadata: {
                productName: changes.productName,
                quantityChanged: changes.quantityChanged
            }
        });
    }

    /**
     * Log a settings action
     */
    async logSettingsAction(action, actor, changes = {}) {
        return this.log({
            actor: actor.name || actor.email || 'system',
            actorId: actor.id,
            actorIp: actor.ip,
            actorUserAgent: actor.userAgent,
            action,
            resource: AUDIT_RESOURCES.SETTINGS,
            previousState: changes.previous,
            updatedState: changes.updated,
            changes: this.detectChanges(changes.previous, changes.updated),
            metadata: {
                settingCategory: changes.category
            }
        });
    }

    /**
     * Log a security event
     */
    async logSecurityEvent(action, details, actor = null) {
        return this.log({
            actor: actor ? (actor.name || actor.email || 'system') : 'system',
            actorId: actor ? actor.id : null,
            actorIp: actor ? actor.ip : null,
            actorUserAgent: actor ? actor.userAgent : null,
            action: AUDIT_ACTIONS.SECURITY_ALERT,
            resource: AUDIT_RESOURCES.SECURITY,
            metadata: {
                eventType: action,
                details
            }
        });
    }

    /**
     * Get audit logs with filters
     */
    async getLogs(filters = {}) {
        let query = 'SELECT * FROM audit_logs WHERE 1=1';
        const params = [];

        if (filters.action) {
            query += ' AND action = ?';
            params.push(filters.action);
        }

        if (filters.resource) {
            query += ' AND resource = ?';
            params.push(filters.resource);
        }

        if (filters.resourceId) {
            query += ' AND resource_id = ?';
            params.push(filters.resourceId);
        }

        if (filters.actorId) {
            query += ' AND actor_id = ?';
            params.push(filters.actorId);
        }

        if (filters.fromDate) {
            query += ' AND timestamp >= ?';
            params.push(filters.fromDate);
        }

        if (filters.toDate) {
            query += ' AND timestamp <= ?';
            params.push(filters.toDate);
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(filters.limit || 100);
        params.push(filters.offset || 0);

        try {
            const [logs] = await db.query(query, params);
            return logs;
        } catch (error) {
            console.error('Get logs error:', error);
            return [];
        }
    }

    /**
     * Get audit statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(`
                SELECT 
                    COUNT(*) as total_logs,
                    COUNT(DISTINCT action) as unique_actions,
                    COUNT(DISTINCT resource) as resources,
                    COUNT(DISTINCT actor_id) as unique_actors,
                    MIN(timestamp) as first_log,
                    MAX(timestamp) as last_log
                FROM audit_logs
            `);

            const [actionStats] = await db.query(`
                SELECT 
                    action,
                    COUNT(*) as count
                FROM audit_logs
                GROUP BY action
                ORDER BY count DESC
                LIMIT 10
            `);

            return {
                ...stats[0],
                topActions: actionStats,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Get statistics error:', error);
            return null;
        }
    }

    /**
     * Flush queue to database
     */
    async flushQueue() {
        if (this.auditQueue.length === 0 || this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        const batch = [...this.auditQueue];
        this.auditQueue = [];

        try {
            for (const entry of batch) {
                await db.query(
                    `INSERT INTO audit_logs 
                     (audit_id, actor, actor_id, actor_ip, actor_user_agent,
                      action, resource, resource_id, previous_state, updated_state,
                      changes, metadata, hash, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        entry.id,
                        entry.actor,
                        entry.actorId,
                        entry.actorIp,
                        entry.actorUserAgent,
                        entry.action,
                        entry.resource,
                        entry.resourceId,
                        JSON.stringify(entry.previousState),
                        JSON.stringify(entry.updatedState),
                        JSON.stringify(entry.changes),
                        JSON.stringify(entry.metadata),
                        entry.hash,
                        entry.timestamp
                    ]
                );
            }

            console.log(`📝 Flushed ${batch.length} audit entries`);
        } catch (error) {
            console.error('Flush queue error:', error);
            // Re-queue failed entries
            this.auditQueue = [...batch, ...this.auditQueue];
        } finally {
            this.isProcessing = false;
        }
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateAuditId() {
        return `AUDIT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateHash(entry) {
        const data = {
            actor: entry.actor,
            action: entry.action,
            resource: entry.resource,
            resourceId: entry.resourceId,
            timestamp: entry.timestamp
        };
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    detectChanges(previous, updated) {
        if (!previous || !updated) return null;

        const changes = {};
        const allKeys = new Set([...Object.keys(previous), ...Object.keys(updated)]);

        for (const key of allKeys) {
            const prevValue = previous[key];
            const newValue = updated[key];

            if (JSON.stringify(prevValue) !== JSON.stringify(newValue)) {
                changes[key] = {
                    from: prevValue,
                    to: newValue
                };
            }
        }

        return Object.keys(changes).length > 0 ? changes : null;
    }

    emitAuditEvent(entry) {
        // Emit for real-time monitoring (could use WebSocket or SSE)
        if (global.auditEventEmitter) {
            global.auditEventEmitter.emit('audit', entry);
        }
    }

    // ============================================
    // SHUTDOWN
    // ============================================

    async shutdown() {
        await this.flushQueue();
        console.log('Audit Service shutting down...');
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    AuditService,
    AUDIT_ACTIONS,
    AUDIT_RESOURCES,
    auditService: new AuditService()
};