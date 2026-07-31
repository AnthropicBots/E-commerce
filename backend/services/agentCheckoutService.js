// backend/services/agentCheckoutService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// AGENT CHECKOUT CONFIGURATION
// ============================================

const CHECKOUT_STATUS = {
    PENDING_REVIEW: 'pending_review',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
};

const REVIEW_TYPES = {
    HUMAN: 'human',
    AUTOMATED: 'automated',
    HYBRID: 'hybrid'
};

const AGENT_AUTHORIZATION = {
    REQUIRED: 'required',
    OPTIONAL: 'optional',
    DISABLED: 'disabled'
};

// ============================================
// AGENT CHECKOUT SERVICE
// ============================================

class AgentCheckoutService extends EventEmitter {
    constructor() {
        super();
        this.checkoutSessions = new Map();
        this.reviewQueue = [];
        this.approvals = new Map();
        this.rejections = new Map();
        this.auditLogs = [];
        this.isProcessing = false;
    }

    /**
     * Initialize checkout service
     */
    async initialize() {
        // Load pending reviews from database
        await this.loadPendingReviews();

        // Start processing queue
        this.startProcessing();

        console.log('✅ Agent Checkout Service initialized');
        return this;
    }

    /**
     * Initiate agent checkout with human review
     */
    async initiateCheckout(agentId, orderData, authData = {}) {
        // 1. Verify agent authorization
        const authorization = await this.verifyAgentAuthorization(agentId, authData);
        
        if (!authorization.verified) {
            return {
                success: false,
                error: 'Agent authorization failed',
                details: authorization.reason,
                status: CHECKOUT_STATUS.REJECTED
            };
        }

        // 2. Generate checkout session
        const sessionId = this.generateSessionId();
        const session = {
            id: sessionId,
            agentId,
            orderData,
            authData,
            authorization: authorization,
            status: CHECKOUT_STATUS.PENDING_REVIEW,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reviewType: REVIEW_TYPES.HUMAN,
            attempts: 0,
            maxAttempts: 3,
            auditTrail: []
        };

        // 3. Add to review queue
        this.checkoutSessions.set(sessionId, session);
        this.reviewQueue.push(sessionId);

        // 4. Store in database
        await this.storeCheckoutSession(session);

        // 5. Log audit
        await this.logAudit(sessionId, 'initiated', { agentId, orderData });

        console.log(`📦 Checkout session created: ${sessionId} (agent: ${agentId})`);
        this.emit('checkout.initiated', { sessionId, agentId });

        return {
            success: true,
            sessionId,
            status: CHECKOUT_STATUS.PENDING_REVIEW,
            message: 'Checkout requires human review',
            estimatedReviewTime: '5-10 minutes',
            session
        };
    }

    /**
     * Verify agent authorization
     */
    async verifyAgentAuthorization(agentId, authData) {
        try {
            // Check if agent exists
            const [agent] = await db.query(
                'SELECT * FROM agent_identities WHERE agent_id = ? AND status = "active"',
                [agentId]
            );

            if (!agent || agent.length === 0) {
                return {
                    verified: false,
                    reason: 'Agent not found or inactive'
                };
            }

            // Check if agent has checkout permissions
            const permissions = JSON.parse(agent[0].permissions || '[]');
            if (!permissions.includes('checkout')) {
                return {
                    verified: false,
                    reason: 'Agent lacks checkout permissions'
                };
            }

            // Verify cryptographic signature
            if (authData.signature) {
                const isValid = this.verifySignature(agentId, authData);
                if (!isValid) {
                    return {
                        verified: false,
                        reason: 'Invalid signature'
                    };
                }
            }

            // Check transaction limits
            if (authData.amount && authData.amount > agent[0].max_transaction_limit) {
                return {
                    verified: false,
                    reason: `Amount (${authData.amount}) exceeds agent limit (${agent[0].max_transaction_limit})`
                };
            }

            return {
                verified: true,
                agent: agent[0],
                permissions,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Agent authorization error:', error);
            return {
                verified: false,
                reason: 'Authorization verification failed'
            };
        }
    }

    /**
     * Review a checkout session (Human Review)
     */
    async reviewCheckout(sessionId, reviewerId, decision, notes = '') {
        const session = this.checkoutSessions.get(sessionId);
        if (!session) {
            throw new Error('Checkout session not found');
        }

        if (session.status !== CHECKOUT_STATUS.PENDING_REVIEW) {
            throw new Error(`Session already ${session.status}`);
        }

        // Validate decision
        if (![CHECKOUT_STATUS.APPROVED, CHECKOUT_STATUS.REJECTED].includes(decision)) {
            throw new Error('Invalid decision. Must be "approved" or "rejected"');
        }

        // Update session
        session.status = decision;
        session.reviewedBy = reviewerId;
        session.reviewedAt = new Date().toISOString();
        session.reviewNotes = notes;
        session.updatedAt = new Date().toISOString();

        // Remove from queue
        const queueIndex = this.reviewQueue.indexOf(sessionId);
        if (queueIndex > -1) {
            this.reviewQueue.splice(queueIndex, 1);
        }

        // Store review
        await this.storeReview(sessionId, reviewerId, decision, notes);

        // Log audit
        await this.logAudit(sessionId, `review_${decision}`, { reviewerId, notes });

        // Execute approved checkout
        if (decision === CHECKOUT_STATUS.APPROVED) {
            await this.executeCheckout(sessionId);
        }

        this.emit('checkout.reviewed', { sessionId, decision, reviewerId });

        console.log(`✅ Checkout ${decision}: ${sessionId} by ${reviewerId}`);
        
        return {
            success: true,
            sessionId,
            status: decision,
            message: `Checkout ${decision}`,
            reviewedBy: reviewerId,
            reviewedAt: session.reviewedAt,
            notes
        };
    }

    /**
     * Execute approved checkout
     */
    async executeCheckout(sessionId) {
        const session = this.checkoutSessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        if (session.status !== CHECKOUT_STATUS.APPROVED) {
            throw new Error(`Cannot execute: status is ${session.status}`);
        }

        try {
            // Process order
            const orderResult = await this.processOrder(session);

            // Update session
            session.status = CHECKOUT_STATUS.COMPLETED;
            session.orderResult = orderResult;
            session.completedAt = new Date().toISOString();
            session.updatedAt = new Date().toISOString();

            // Store result
            await this.storeCheckoutResult(session);

            // Log audit
            await this.logAudit(sessionId, 'completed', { orderResult });

            this.emit('checkout.completed', { sessionId, orderResult });

            console.log(`✅ Checkout completed: ${sessionId}`);
            
            return {
                success: true,
                sessionId,
                orderResult,
                status: CHECKOUT_STATUS.COMPLETED
            };

        } catch (error) {
            console.error('Checkout execution error:', error);
            
            session.status = CHECKOUT_STATUS.FAILED;
            session.error = error.message;
            session.attempts++;
            session.updatedAt = new Date().toISOString();

            // Store error
            await this.storeCheckoutResult(session);

            // Retry if attempts remaining
            if (session.attempts < session.maxAttempts) {
                session.status = CHECKOUT_STATUS.PENDING_REVIEW;
                this.reviewQueue.push(sessionId);
                this.emit('checkout.retry', { sessionId, attempt: session.attempts });
                
                return {
                    success: false,
                    error: 'Checkout failed, retrying',
                    attempt: session.attempts,
                    maxAttempts: session.maxAttempts
                };
            }

            throw error;
        }
    }

    /**
     * Process order (placeholder for actual order processing)
     */
    async processOrder(session) {
        // In production, this would integrate with your order service
        const order = {
            id: `ORD_${Date.now()}`,
            agentId: session.agentId,
            items: session.orderData.items,
            total: session.orderData.total,
            status: 'confirmed',
            createdAt: new Date().toISOString(),
            confirmedBy: session.reviewedBy || 'system'
        };

        // Store order
        await db.query(
            `INSERT INTO orders 
             (order_id, agent_id, items, total, status, confirmed_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                order.id,
                order.agentId,
                JSON.stringify(order.items),
                order.total,
                order.status,
                order.confirmedBy,
                order.createdAt
            ]
        );

        return order;
    }

    /**
     * Get checkout session status
     */
    getCheckoutStatus(sessionId) {
        const session = this.checkoutSessions.get(sessionId);
        if (!session) return null;

        return {
            id: session.id,
            status: session.status,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            reviewedBy: session.reviewedBy || null,
            reviewedAt: session.reviewedAt || null,
            orderResult: session.orderResult || null
        };
    }

    /**
     * Get pending reviews
     */
    getPendingReviews(limit = 20) {
        const pending = this.reviewQueue.slice(0, limit);
        return pending.map(id => this.checkoutSessions.get(id)).filter(Boolean);
    }

    /**
     * Get audit logs for a session
     */
    getAuditLogs(sessionId, limit = 50) {
        return this.auditLogs
            .filter(log => log.sessionId === sessionId)
            .slice(-limit);
    }

    /**
     * Cancel a checkout
     */
    async cancelCheckout(sessionId, reason) {
        const session = this.checkoutSessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        if (session.status === CHECKOUT_STATUS.COMPLETED) {
            throw new Error('Cannot cancel completed checkout');
        }

        session.status = CHECKOUT_STATUS.CANCELLED;
        session.cancelledAt = new Date().toISOString();
        session.cancelReason = reason;
        session.updatedAt = new Date().toISOString();

        // Remove from queue
        const queueIndex = this.reviewQueue.indexOf(sessionId);
        if (queueIndex > -1) {
            this.reviewQueue.splice(queueIndex, 1);
        }

        await this.storeCheckoutSession(session);
        await this.logAudit(sessionId, 'cancelled', { reason });

        this.emit('checkout.cancelled', { sessionId, reason });

        return {
            success: true,
            sessionId,
            status: CHECKOUT_STATUS.CANCELLED,
            message: `Checkout cancelled: ${reason}`
        };
    }

    /**
     * Verify signature
     */
    verifySignature(agentId, authData) {
        const secret = process.env.AGENT_AUTH_SECRET || 'default_secret';
        const payload = `${agentId}:${authData.amount}:${authData.timestamp}`;
        const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(authData.signature), Buffer.from(expected));
    }

    /**
     * Start processing queue
     */
    startProcessing() {
        if (this.isProcessing) return;

        this.isProcessing = true;
        setInterval(() => this.processQueue(), 30000); // Check every 30 seconds
    }

    /**
     * Process review queue
     */
    async processQueue() {
        if (this.reviewQueue.length === 0) return;

        // Check for expired reviews (auto-reject after 24 hours)
        const now = new Date();
        const pending = this.reviewQueue.map(id => this.checkoutSessions.get(id)).filter(Boolean);

        for (const session of pending) {
            const created = new Date(session.createdAt);
            const diff = now - created;
            if (diff > 24 * 60 * 60 * 1000) { // 24 hours
                await this.reviewCheckout(
                    session.id,
                    'system',
                    CHECKOUT_STATUS.REJECTED,
                    'Auto-rejected: Review timeout (24 hours)'
                );
            }
        }
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadPendingReviews() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM agent_checkout_sessions 
                 WHERE status = ? 
                 ORDER BY created_at ASC`,
                [CHECKOUT_STATUS.PENDING_REVIEW]
            );

            for (const row of rows) {
                const session = {
                    id: row.session_id,
                    agentId: row.agent_id,
                    orderData: JSON.parse(row.order_data),
                    authData: JSON.parse(row.auth_data || '{}'),
                    authorization: JSON.parse(row.authorization || '{}'),
                    status: row.status,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                    reviewedBy: row.reviewed_by,
                    reviewedAt: row.reviewed_at,
                    reviewNotes: row.review_notes,
                    attempts: row.attempts,
                    maxAttempts: row.max_attempts,
                    auditTrail: []
                };

                this.checkoutSessions.set(session.id, session);
                this.reviewQueue.push(session.id);
            }

            console.log(`📦 Loaded ${rows.length} pending review sessions`);
        } catch (error) {
            console.error('Load pending reviews error:', error);
        }
    }

    async storeCheckoutSession(session) {
        await db.query(
            `INSERT INTO agent_checkout_sessions 
             (session_id, agent_id, order_data, auth_data, authorization, 
              status, created_at, updated_at, reviewed_by, reviewed_at, 
              review_notes, attempts, max_attempts)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
             status = VALUES(status), updated_at = VALUES(updated_at),
             reviewed_by = VALUES(reviewed_by), reviewed_at = VALUES(reviewed_at),
             review_notes = VALUES(review_notes), attempts = VALUES(attempts)`,
            [
                session.id,
                session.agentId,
                JSON.stringify(session.orderData),
                JSON.stringify(session.authData || {}),
                JSON.stringify(session.authorization || {}),
                session.status,
                session.createdAt,
                session.updatedAt,
                session.reviewedBy || null,
                session.reviewedAt || null,
                session.reviewNotes || null,
                session.attempts || 0,
                session.maxAttempts || 3
            ]
        );
    }

    async storeReview(sessionId, reviewerId, decision, notes) {
        await db.query(
            `INSERT INTO agent_checkout_reviews 
             (session_id, reviewer_id, decision, notes, reviewed_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [sessionId, reviewerId, decision, notes]
        );
    }

    async storeCheckoutResult(session) {
        await db.query(
            `UPDATE agent_checkout_sessions 
             SET status = ?, 
                 order_result = ?,
                 completed_at = ?,
                 error = ?
             WHERE session_id = ?`,
            [
                session.status,
                JSON.stringify(session.orderResult || {}),
                session.completedAt || null,
                session.error || null,
                session.id
            ]
        );
    }

    async logAudit(sessionId, action, data) {
        const log = {
            sessionId,
            action,
            data,
            timestamp: new Date().toISOString()
        };

        this.auditLogs.push(log);

        await db.query(
            `INSERT INTO agent_checkout_audit 
             (session_id, action, data, timestamp)
             VALUES (?, ?, ?, NOW())`,
            [sessionId, action, JSON.stringify(data)]
        );
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateSessionId() {
        return `CHK_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const sessions = Array.from(this.checkoutSessions.values());

        return {
            totalSessions: sessions.length,
            pendingReviews: this.reviewQueue.length,
            byStatus: sessions.reduce((acc, s) => {
                acc[s.status] = (acc[s.status] || 0) + 1;
                return acc;
            }, {}),
            queueSize: this.reviewQueue.length,
            auditLogs: this.auditLogs.length,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            sessions: this.checkoutSessions.size,
            pendingReviews: this.reviewQueue.length,
            isProcessing: this.isProcessing,
            auditLogs: this.auditLogs.length
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    AgentCheckoutService,
    CHECKOUT_STATUS,
    REVIEW_TYPES,
    agentCheckoutService: new AgentCheckoutService()
};