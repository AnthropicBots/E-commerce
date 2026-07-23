// backend/services/jaggedFrontierService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// JAGGED FRONTIER CONFIGURATION
// ============================================

const CONFIDENCE_LEVELS = {
    HIGH: 0.8,
    MEDIUM: 0.6,
    LOW: 0.4,
    CRITICAL: 0.2
};

const AMBIGUITY_TYPES = {
    CONTEXTUAL: 'contextual',
    BEHAVIORAL: 'behavioral',
    FINANCIAL: 'financial',
    CUSTOMER: 'customer',
    COMPLIANCE: 'compliance',
    TECHNICAL: 'technical'
};

const DECISION_STATUS = {
    BLOCKED: 'blocked',
    REQUIRES_REVIEW: 'requires_review',
    APPROVED: 'approved',
    DEFERRED: 'deferred'
};

// ============================================
// JAGGED FRONTIER SERVICE
// ============================================

class JaggedFrontierService extends EventEmitter {
    constructor() {
        super();
        this.decisions = new Map();
        this.reviewQueue = [];
        this.confidenceScores = new Map();
        this.ambiguousPatterns = new Map();
        this.guardrails = new Map();
        this.decisionHistory = [];
        this.isInitialized = false;
    }

    /**
     * Initialize service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load guardrails
        await this.loadGuardrails();

        // Load ambiguous patterns
        await this.loadAmbiguousPatterns();

        this.isInitialized = true;
        console.log('✅ Jagged Frontier Service initialized');
        return this;
    }

    /**
     * Evaluate agent action with confidence scoring
     */
    async evaluateAction(agentId, action, context = {}) {
        const evaluation = {
            agentId,
            action,
            context,
            confidence: 0,
            ambiguityScore: 0,
            flags: [],
            status: DECISION_STATUS.APPROVED,
            requiresReview: false,
            recommendations: [],
            timestamp: new Date().toISOString()
        };

        // 1. Calculate confidence score
        evaluation.confidence = await this.calculateConfidence(agentId, action, context);
        evaluation.ambiguityScore = 1 - evaluation.confidence;

        // 2. Check for ambiguous patterns
        const ambiguityCheck = await this.checkAmbiguity(agentId, action, context);
        evaluation.flags.push(...ambiguityCheck.flags);
        evaluation.ambiguityScore += ambiguityCheck.score;

        // 3. Apply guardrails
        const guardrailCheck = await this.applyGuardrails(agentId, action, context);
        evaluation.flags.push(...guardrailCheck.flags);
        if (guardrailCheck.violated) {
            evaluation.status = DECISION_STATUS.BLOCKED;
            evaluation.recommendations.push('Action blocked by guardrails');
            this.emit('action.blocked', evaluation);
            return evaluation;
        }

        // 4. Check confidence threshold
        if (evaluation.confidence < CONFIDENCE_LEVELS.LOW) {
            evaluation.status = DECISION_STATUS.REQUIRES_REVIEW;
            evaluation.requiresReview = true;
            evaluation.recommendations.push('Low confidence - human review required');
            this.addToReviewQueue(evaluation);
            this.emit('action.requires_review', evaluation);
        } else if (evaluation.confidence < CONFIDENCE_LEVELS.MEDIUM) {
            evaluation.status = DECISION_STATUS.DEFERRED;
            evaluation.recommendations.push('Medium confidence - defer for review');
            this.addToReviewQueue(evaluation);
        }

        // 5. Check for contextual ambiguity
        if (evaluation.ambiguityScore > 0.5) {
            evaluation.flags.push({
                type: AMBIGUITY_TYPES.CONTEXTUAL,
                severity: 'high',
                details: 'High contextual ambiguity detected'
            });
            evaluation.requiresReview = true;
        }

        // 6. Log decision
        await this.logDecision(evaluation);

        // 7. Store for history
        this.decisionHistory.push(evaluation);

        this.emit('action.evaluated', evaluation);

        return evaluation;
    }

    /**
     * Calculate confidence score for an action
     */
    async calculateConfidence(agentId, action, context) {
        let confidence = 0.7; // Base confidence
        const factors = [];

        // 1. Historical performance
        const historical = await this.getHistoricalPerformance(agentId, action);
        if (historical) {
            confidence += historical * 0.2;
            factors.push({ factor: 'historical', weight: 0.2, value: historical });
        }

        // 2. Context similarity
        const contextSimilarity = await this.calculateContextSimilarity(action, context);
        confidence += contextSimilarity * 0.15;
        factors.push({ factor: 'context_similarity', weight: 0.15, value: contextSimilarity });

        // 3. Action complexity
        const complexity = this.calculateActionComplexity(action);
        confidence -= complexity * 0.1;
        factors.push({ factor: 'complexity', weight: 0.1, value: complexity });

        // 4. Previous success rate
        const successRate = await this.getSuccessRate(agentId, action);
        confidence += successRate * 0.15;
        factors.push({ factor: 'success_rate', weight: 0.15, value: successRate });

        // 5. User feedback
        const feedbackScore = await this.getFeedbackScore(agentId);
        confidence += feedbackScore * 0.1;
        factors.push({ factor: 'feedback', weight: 0.1, value: feedbackScore });

        // 6. System health
        const systemHealth = await this.getSystemHealth();
        confidence += systemHealth * 0.1;
        factors.push({ factor: 'system_health', weight: 0.1, value: systemHealth });

        // Apply guardrail penalty
        const guardrailPenalty = await this.calculateGuardrailPenalty(agentId, action);
        confidence -= guardrailPenalty * 0.1;

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Check for ambiguous patterns
     */
    async checkAmbiguity(agentId, action, context) {
        const result = {
            flags: [],
            score: 0
        };

        // Check for contextual ambiguity
        if (context.customerIntent && context.customerIntent.includes('uncertain')) {
            result.flags.push({
                type: AMBIGUITY_TYPES.BEHAVIORAL,
                severity: 'medium',
                details: 'Uncertain customer intent detected'
            });
            result.score += 0.3;
        }

        // Check for financial ambiguity
        if (action.type === 'purchase' && action.amount > 10000) {
            const priceHistory = await this.getPriceHistory(action.productId);
            const deviation = this.calculatePriceDeviation(action.amount, priceHistory);
            if (deviation > 0.3) {
                result.flags.push({
                    type: AMBIGUITY_TYPES.FINANCIAL,
                    severity: 'high',
                    details: `Price deviation: ${(deviation * 100).toFixed(0)}% from typical`
                });
                result.score += 0.4;
            }
        }

        // Check for customer ambiguity
        if (context.customerHistory && context.customerHistory.includes('new')) {
            result.flags.push({
                type: AMBIGUITY_TYPES.CUSTOMER,
                severity: 'medium',
                details: 'New customer with limited history'
            });
            result.score += 0.2;
        }

        // Check for compliance ambiguity
        if (action.type === 'refund' && action.amount > 5000) {
            result.flags.push({
                type: AMBIGUITY_TYPES.COMPLIANCE,
                severity: 'high',
                details: 'Large refund requires compliance review'
            });
            result.score += 0.3;
        }

        return result;
    }

    /**
     * Apply guardrails
     */
    async applyGuardrails(agentId, action, context) {
        const result = {
            violated: false,
            flags: []
        };

        // Check transaction limits
        if (action.type === 'purchase' && action.amount > 100000) {
            result.violated = true;
            result.flags.push({
                type: 'limit_exceeded',
                severity: 'critical',
                details: 'Transaction exceeds maximum limit of ₹100,000'
            });
        }

        // Check discount limits
        if (action.type === 'discount' && action.percentage > 70) {
            result.violated = true;
            result.flags.push({
                type: 'discount_limit_exceeded',
                severity: 'critical',
                details: 'Discount exceeds maximum of 70%'
            });
        }

        // Check for fraud patterns
        const fraudDetection = await this.checkFraudPatterns(action, context);
        if (fraudDetection.isSuspicious) {
            result.violated = true;
            result.flags.push({
                type: 'fraud_pattern_detected',
                severity: 'critical',
                details: fraudDetection.reason
            });
        }

        return result;
    }

    /**
     * Review an ambiguous decision
     */
    async reviewDecision(decisionId, reviewerId, decision, notes = '') {
        const evaluation = this.decisions.get(decisionId);
        if (!evaluation) {
            throw new Error('Decision not found');
        }

        // Update decision
        evaluation.status = decision;
        evaluation.reviewedBy = reviewerId;
        evaluation.reviewedAt = new Date().toISOString();
        evaluation.reviewNotes = notes;

        // Store review
        await this.storeReview(decisionId, reviewerId, decision, notes);

        // Execute if approved
        if (decision === DECISION_STATUS.APPROVED) {
            this.emit('decision.approved', evaluation);
        } else if (decision === DECISION_STATUS.BLOCKED) {
            this.emit('decision.blocked', evaluation);
        }

        // Remove from queue
        const queueIndex = this.reviewQueue.findIndex(q => q.id === decisionId);
        if (queueIndex > -1) {
            this.reviewQueue.splice(queueIndex, 1);
        }

        return evaluation;
    }

    /**
     * Get pending reviews
     */
    getPendingReviews(limit = 20) {
        return this.reviewQueue.slice(0, limit);
    }

    /**
     * Get decision history
     */
    getDecisionHistory(limit = 50) {
        return this.decisionHistory.slice(-limit);
    }

    /**
     * Get confidence score for agent
     */
    getConfidenceScore(agentId) {
        return this.confidenceScores.get(agentId) || 0.5;
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    async getHistoricalPerformance(agentId, action) {
        try {
            const [result] = await db.query(
                `SELECT AVG(confidence) as avg_confidence 
                 FROM jagged_frontier_decisions 
                 WHERE agent_id = ? AND action_type = ? AND status = 'approved'`,
                [agentId, action.type]
            );
            return result[0]?.avg_confidence || 0.7;
        } catch (error) {
            return 0.7;
        }
    }

    async calculateContextSimilarity(action, context) {
        // In production, use embedding similarity
        return 0.8;
    }

    calculateActionComplexity(action) {
        const factors = {
            'purchase': 0.3,
            'refund': 0.4,
            'discount': 0.2,
            'negotiate': 0.5,
            'delete': 0.3
        };
        return factors[action.type] || 0.3;
    }

    async getSuccessRate(agentId, action) {
        try {
            const [result] = await db.query(
                `SELECT 
                    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as successes,
                    COUNT(*) as total
                 FROM jagged_frontier_decisions 
                 WHERE agent_id = ? AND action_type = ?`,
                [agentId, action.type]
            );
            const successRate = result[0]?.total > 0 ? 
                result[0].successes / result[0].total : 0.7;
            return Math.min(1, successRate);
        } catch (error) {
            return 0.7;
        }
    }

    async getFeedbackScore(agentId) {
        try {
            const [result] = await db.query(
                `SELECT AVG(rating) as avg_feedback 
                 FROM agent_feedback 
                 WHERE agent_id = ?`,
                [agentId]
            );
            return (result[0]?.avg_feedback || 4) / 5;
        } catch (error) {
            return 0.8;
        }
    }

    async getSystemHealth() {
        // Check system health metrics
        return 0.9;
    }

    async calculateGuardrailPenalty(agentId, action) {
        // Check if agent has violated guardrails before
        try {
            const [result] = await db.query(
                `SELECT COUNT(*) as violations 
                 FROM jagged_frontier_decisions 
                 WHERE agent_id = ? AND status = 'blocked' 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`,
                [agentId]
            );
            return Math.min(0.5, result[0].violations * 0.1);
        } catch (error) {
            return 0;
        }
    }

    async getPriceHistory(productId) {
        try {
            const [result] = await db.query(
                `SELECT AVG(price) as avg_price 
                 FROM products 
                 WHERE id = ?`,
                [productId]
            );
            return result[0]?.avg_price || 0;
        } catch (error) {
            return 0;
        }
    }

    calculatePriceDeviation(price, history) {
        if (!history || history === 0) return 0;
        return Math.abs(price - history) / history;
    }

    async checkFraudPatterns(action, context) {
        // In production, use fraud detection system
        return { isSuspicious: false, reason: '' };
    }

    addToReviewQueue(evaluation) {
        const reviewItem = {
            id: evaluation.id || crypto.randomUUID(),
            ...evaluation,
            queuedAt: new Date().toISOString()
        };
        this.reviewQueue.push(reviewItem);
        this.decisions.set(reviewItem.id, reviewItem);
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadGuardrails() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM jagged_frontier_guardrails WHERE active = 1'
            );
            for (const row of rows) {
                this.guardrails.set(row.name, {
                    type: row.type,
                    threshold: row.threshold,
                    action: row.action,
                    severity: row.severity
                });
            }
            console.log(`🛡️ Loaded ${this.guardrails.size} guardrails`);
        } catch (error) {
            console.error('Load guardrails error:', error);
        }
    }

    async loadAmbiguousPatterns() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM jagged_frontier_patterns WHERE active = 1'
            );
            for (const row of rows) {
                this.ambiguousPatterns.set(row.name, {
                    type: row.type,
                    pattern: JSON.parse(row.pattern),
                    severity: row.severity,
                    confidence: row.confidence
                });
            }
            console.log(`🔍 Loaded ${this.ambiguousPatterns.size} ambiguous patterns`);
        } catch (error) {
            console.error('Load ambiguous patterns error:', error);
        }
    }

    async logDecision(evaluation) {
        try {
            await db.query(
                `INSERT INTO jagged_frontier_decisions 
                 (agent_id, action_type, confidence, ambiguity_score, 
                  status, flags, context, requires_review, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    evaluation.agentId,
                    evaluation.action.type,
                    evaluation.confidence,
                    evaluation.ambiguityScore,
                    evaluation.status,
                    JSON.stringify(evaluation.flags),
                    JSON.stringify(evaluation.context),
                    evaluation.requiresReview ? 1 : 0
                ]
            );
        } catch (error) {
            console.error('Log decision error:', error);
        }
    }

    async storeReview(decisionId, reviewerId, decision, notes) {
        try {
            await db.query(
                `INSERT INTO jagged_frontier_reviews 
                 (decision_id, reviewer_id, decision, notes, reviewed_at)
                 VALUES (?, ?, ?, ?, NOW())`,
                [decisionId, reviewerId, decision, notes]
            );
        } catch (error) {
            console.error('Store review error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            totalDecisions: this.decisionHistory.length,
            pendingReviews: this.reviewQueue.length,
            blockedDecisions: this.decisionHistory.filter(d => d.status === 'blocked').length,
            requiresReview: this.decisionHistory.filter(d => d.requiresReview).length,
            avgConfidence: this.decisionHistory.length > 0 ?
                this.decisionHistory.reduce((sum, d) => sum + d.confidence, 0) / this.decisionHistory.length :
                0,
            guardrails: this.guardrails.size,
            patterns: this.ambiguousPatterns.size,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            guardrails: this.guardrails.size,
            patterns: this.ambiguousPatterns.size,
            decisions: this.decisionHistory.length,
            pendingReviews: this.reviewQueue.length
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    JaggedFrontierService,
    CONFIDENCE_LEVELS,
    AMBIGUITY_TYPES,
    DECISION_STATUS,
    jaggedFrontierService: new JaggedFrontierService()
};