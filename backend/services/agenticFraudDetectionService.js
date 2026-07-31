// backend/services/agenticFraudDetectionService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const AGENTIC_FRAUD_CONFIG = {
    // Trust-based evaluation
    trustThresholds: {
        LOW: 0,
        MEDIUM: 30,
        HIGH: 60,
        VERY_HIGH: 80
    },
    
    // Agent identity validation
    identityValidation: {
        requireProvenance: true,
        requireSignature: true,
        providerVerification: true
    },
    
    // Risk signals
    riskSignals: {
        unknownProvider: 30,
        unsignedAgent: 40,
        tooFastInteraction: 20,
        tooSlowInteraction: 10,
        unusualPattern: 25,
        mandateViolation: 50
    },
    
    // Agent types
    agentTypes: {
        SHOPPING: 'shopping',
        NEGOTIATION: 'negotiation',
        CHECKOUT: 'checkout',
        SUPPORT: 'support',
        UNKNOWN: 'unknown'
    },
    
    // Provider verification
    trustedProviders: [
        'anthropic',
        'openai',
        'google',
        'microsoft',
        'perplexity'
    ]
};

// ============================================
// AGENTIC FRAUD DETECTION CLASS
// ============================================

class AgenticFraudDetectionService {
    constructor() {
        this.agentSessions = new Map();
        this.agentReputations = new Map();
        this.fraudAlerts = [];
        this.providerCache = new Map();
    }

    /**
     * Evaluate agent interaction for fraud
     */
    async evaluateAgentInteraction(agentData, context = {}) {
        const evaluation = {
            agentId: agentData.agentId,
            trustScore: 0,
            riskLevel: 'low',
            isFraudulent: false,
            flags: [],
            recommendations: [],
            timestamp: new Date().toISOString()
        };

        // 1. Agent Identity Validation
        const identityResult = await this.validateAgentIdentity(agentData);
        evaluation.flags.push(...identityResult.flags);
        evaluation.trustScore += identityResult.score;

        // 2. Agent Provenance Verification
        const provenanceResult = await this.verifyAgentProvenance(agentData);
        evaluation.flags.push(...provenanceResult.flags);
        evaluation.trustScore += provenanceResult.score;

        // 3. Interaction Pattern Analysis
        const patternResult = await this.analyzeInteractionPatterns(agentData, context);
        evaluation.flags.push(...patternResult.flags);
        evaluation.trustScore += patternResult.score;

        // 4. Mandate Scope Check
        const mandateResult = await this.checkMandateScope(agentData, context);
        evaluation.flags.push(...mandateResult.flags);
        evaluation.trustScore += mandateResult.score;

        // 5. Provider Verification
        const providerResult = await this.verifyProvider(agentData.provider);
        evaluation.flags.push(...providerResult.flags);
        evaluation.trustScore += providerResult.score;

        // Calculate final trust score (0-100)
        evaluation.trustScore = Math.max(0, Math.min(100, 100 + evaluation.trustScore));
        evaluation.riskLevel = this.calculateRiskLevel(evaluation.trustScore);
        evaluation.isFraudulent = evaluation.riskLevel === 'critical';

        // Generate recommendations
        evaluation.recommendations = this.generateRecommendations(evaluation);

        // Log evaluation
        await this.logEvaluation(agentData, evaluation, context);

        return evaluation;
    }

    /**
     * Validate agent identity
     */
    async validateAgentIdentity(agentData) {
        const flags = [];
        let score = 0;

        // Check for agent ID
        if (!agentData.agentId) {
            flags.push({
                type: 'missing_agent_id',
                severity: 'critical',
                details: 'Agent ID is missing'
            });
            score -= 30;
        }

        // Check for agent signature
        if (AGENTIC_FRAUD_CONFIG.identityValidation.requireSignature) {
            if (!agentData.signature) {
                flags.push({
                    type: 'unsigned_agent',
                    severity: 'high',
                    details: 'Agent is unsigned'
                });
                score -= AGENTIC_FRAUD_CONFIG.riskSignals.unsignedAgent;
            } else {
                // Verify signature
                const signatureValid = await this.verifyAgentSignature(agentData);
                if (!signatureValid) {
                    flags.push({
                        type: 'invalid_signature',
                        severity: 'critical',
                        details: 'Agent signature is invalid'
                    });
                    score -= 40;
                }
            }
        }

        // Check for agent type
        if (!agentData.type || !Object.values(AGENTIC_FRAUD_CONFIG.agentTypes).includes(agentData.type)) {
            flags.push({
                type: 'unknown_agent_type',
                severity: 'medium',
                details: `Unknown agent type: ${agentData.type}`
            });
            score -= 15;
        }

        return { flags, score };
    }

    /**
     * Verify agent provenance
     */
    async verifyAgentProvenance(agentData) {
        const flags = [];
        let score = 0;

        if (!AGENTIC_FRAUD_CONFIG.identityValidation.requireProvenance) {
            return { flags, score };
        }

        // Check for provenance data
        if (!agentData.provenance) {
            flags.push({
                type: 'missing_provenance',
                severity: 'high',
                details: 'Agent provenance information is missing'
            });
            score -= 25;
            return { flags, score };
        }

        // Check provenance fields
        const requiredFields = ['provider', 'version', 'createdAt'];
        const missingFields = requiredFields.filter(f => !agentData.provenance[f]);

        if (missingFields.length > 0) {
            flags.push({
                type: 'incomplete_provenance',
                severity: 'medium',
                details: `Missing provenance fields: ${missingFields.join(', ')}`
            });
            score -= 15;
        }

        // Check provenance age
        if (agentData.provenance.createdAt) {
            const age = Date.now() - new Date(agentData.provenance.createdAt).getTime();
            const ageDays = age / (1000 * 60 * 60 * 24);
            
            if (ageDays > 365) {
                flags.push({
                    type: 'old_provenance',
                    severity: 'low',
                    details: `Provenance is ${Math.round(ageDays)} days old`
                });
                score -= 5;
            }
        }

        return { flags, score };
    }

    /**
     * Analyze interaction patterns
     */
    async analyzeInteractionPatterns(agentData, context) {
        const flags = [];
        let score = 0;

        // Check interaction speed
        if (context.interactionSpeed) {
            if (context.interactionSpeed < 100) { // milliseconds
                flags.push({
                    type: 'too_fast_interaction',
                    severity: 'medium',
                    details: `Interaction speed: ${context.interactionSpeed}ms (too fast)`
                });
                score -= AGENTIC_FRAUD_CONFIG.riskSignals.tooFastInteraction;
            } else if (context.interactionSpeed > 10000) {
                flags.push({
                    type: 'too_slow_interaction',
                    severity: 'low',
                    details: `Interaction speed: ${context.interactionSpeed}ms (too slow)`
                });
                score -= AGENTIC_FRAUD_CONFIG.riskSignals.tooSlowInteraction;
            }
        }

        // Check navigation pattern
        if (context.navigationPattern) {
            const pattern = context.navigationPattern;
            
            // Check for unnatural patterns
            if (pattern.includes('checkout') && !pattern.includes('product') && !pattern.includes('cart')) {
                flags.push({
                    type: 'unusual_navigation',
                    severity: 'high',
                    details: 'Direct checkout without product/cart navigation'
                });
                score -= AGENTIC_FRAUD_CONFIG.riskSignals.unusualPattern;
            }

            // Check for rapid page transitions
            if (pattern.transitions && pattern.transitions > 10) {
                flags.push({
                    type: 'rapid_navigation',
                    severity: 'medium',
                    details: `Rapid navigation: ${pattern.transitions} transitions`
                });
                score -= 15;
            }
        }

        // Check for programmatic form completion
        if (context.formCompletionTime) {
            if (context.formCompletionTime < 1000) {
                flags.push({
                    type: 'programmatic_form_completion',
                    severity: 'high',
                    details: `Form completed in ${context.formCompletionTime}ms (bot-like)`
                });
                score -= 25;
            }
        }

        return { flags, score };
    }

    /**
     * Check mandate scope
     */
    async checkMandateScope(agentData, context) {
        const flags = [];
        let score = 0;

        if (!context.mandate) {
            flags.push({
                type: 'no_mandate',
                severity: 'critical',
                details: 'No mandate scope defined for agent'
            });
            score -= 50;
            return { flags, score };
        }

        // Check mandate scope
        const { action, amount, merchant } = context;

        // Check action permissions
        if (action && !context.mandate.allowedActions.includes(action)) {
            flags.push({
                type: 'mandate_violation_action',
                severity: 'critical',
                details: `Action "${action}" not in mandate scope`
            });
            score -= AGENTIC_FRAUD_CONFIG.riskSignals.mandateViolation;
        }

        // Check amount limits
        if (amount && context.mandate.maxAmount && amount > context.mandate.maxAmount) {
            flags.push({
                type: 'mandate_violation_amount',
                severity: 'high',
                details: `Amount (${amount}) exceeds mandate limit (${context.mandate.maxAmount})`
            });
            score -= 35;
        }

        // Check merchant restrictions
        if (merchant && context.mandate.allowedMerchants && 
            !context.mandate.allowedMerchants.includes(merchant)) {
            flags.push({
                type: 'mandate_violation_merchant',
                severity: 'high',
                details: `Merchant "${merchant}" not in mandate scope`
            });
            score -= 30;
        }

        return { flags, score };
    }

    /**
     * Verify provider
     */
    async verifyProvider(provider) {
        const flags = [];
        let score = 0;

        if (!provider) {
            flags.push({
                type: 'unknown_provider',
                severity: 'high',
                details: 'Agent provider is unknown'
            });
            score -= AGENTIC_FRAUD_CONFIG.riskSignals.unknownProvider;
            return { flags, score };
        }

        // Check if provider is trusted
        if (!AGENTIC_FRAUD_CONFIG.trustedProviders.includes(provider)) {
            flags.push({
                type: 'untrusted_provider',
                severity: 'medium',
                details: `Provider "${provider}" is not in trusted list`
            });
            score -= 20;
        }

        // Check provider reputation
        const reputation = await this.getProviderReputation(provider);
        if (reputation && reputation.score < 50) {
            flags.push({
                type: 'poor_provider_reputation',
                severity: 'high',
                details: `Provider reputation score: ${reputation.score}`
            });
            score -= 25;
        }

        return { flags, score };
    }

    /**
     * Get provider reputation
     */
    async getProviderReputation(provider) {
        if (this.providerCache.has(provider)) {
            return this.providerCache.get(provider);
        }

        try {
            const [reputation] = await db.query(
                `SELECT * FROM provider_reputation WHERE provider = ?`,
                [provider]
            );

            if (reputation.length > 0) {
                this.providerCache.set(provider, reputation[0]);
                return reputation[0];
            }
        } catch (error) {
            console.error('Provider reputation error:', error);
        }

        return null;
    }

    /**
     * Verify agent signature
     */
    async verifyAgentSignature(agentData) {
        try {
            const secret = process.env.AGENT_SIGNATURE_SECRET || 'default_secret';
            const payload = `${agentData.agentId}:${agentData.type}:${agentData.provenance?.createdAt || ''}`;
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(payload)
                .digest('hex');
            
            return crypto.timingSafeEqual(
                Buffer.from(agentData.signature),
                Buffer.from(expectedSignature)
            );
        } catch (error) {
            console.error('Signature verification error:', error);
            return false;
        }
    }

    /**
     * Calculate risk level
     */
    calculateRiskLevel(trustScore) {
        if (trustScore >= AGENTIC_FRAUD_CONFIG.trustThresholds.VERY_HIGH) return 'low';
        if (trustScore >= AGENTIC_FRAUD_CONFIG.trustThresholds.HIGH) return 'medium';
        if (trustScore >= AGENTIC_FRAUD_CONFIG.trustThresholds.MEDIUM) return 'high';
        return 'critical';
    }

    /**
     * Generate recommendations
     */
    generateRecommendations(evaluation) {
        const recommendations = [];

        if (evaluation.riskLevel === 'critical') {
            recommendations.push('Block agent access immediately');
            recommendations.push('Alert security team');
            recommendations.push('Require human verification');
        }

        if (evaluation.riskLevel === 'high') {
            recommendations.push('Require additional verification');
            recommendations.push('Rate limit agent actions');
            recommendations.push('Monitor for unusual patterns');
        }

        if (evaluation.riskLevel === 'medium') {
            recommendations.push('Verify agent identity');
            recommendations.push('Check mandate scope');
            recommendations.push('Log all agent actions');
        }

        // Specific recommendations based on flags
        for (const flag of evaluation.flags) {
            if (flag.type === 'unsigned_agent') {
                recommendations.push('Require agent to be signed');
            }
            if (flag.type === 'mandate_violation_action') {
                recommendations.push('Update mandate scope');
            }
            if (flag.type === 'unknown_provider') {
                recommendations.push('Verify provider identity');
            }
        }

        return recommendations;
    }

    /**
     * Log evaluation
     */
    async logEvaluation(agentData, evaluation, context) {
        try {
            await db.query(
                `INSERT INTO agentic_fraud_evaluations 
                 (agent_id, trust_score, risk_level, is_fraudulent, flags,
                  recommendations, context, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    agentData.agentId,
                    evaluation.trustScore,
                    evaluation.riskLevel,
                    evaluation.isFraudulent ? 1 : 0,
                    JSON.stringify(evaluation.flags),
                    JSON.stringify(evaluation.recommendations),
                    JSON.stringify(context)
                ]
            );

            // Store in memory
            this.fraudAlerts.push({
                agentId: agentData.agentId,
                ...evaluation
            });

            // Keep last 1000 alerts
            if (this.fraudAlerts.length > 1000) {
                this.fraudAlerts = this.fraudAlerts.slice(-1000);
            }
        } catch (error) {
            console.error('Log evaluation error:', error);
        }
    }

    /**
     * Get agent reputation
     */
    async getAgentReputation(agentId) {
        try {
            const [evaluations] = await db.query(
                `SELECT 
                    AVG(trust_score) as avg_trust,
                    COUNT(*) as total_evaluations,
                    SUM(CASE WHEN is_fraudulent = 1 THEN 1 ELSE 0 END) as fraud_count
                 FROM agentic_fraud_evaluations 
                 WHERE agent_id = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
                [agentId]
            );

            if (evaluations.length === 0 || !evaluations[0].total_evaluations) {
                return { reputation: 'unknown', score: 50 };
            }

            const score = evaluations[0].avg_trust || 50;
            const fraudRate = (evaluations[0].fraud_count / evaluations[0].total_evaluations) * 100;

            return {
                reputation: fraudRate > 20 ? 'suspicious' : 
                           fraudRate > 5 ? 'neutral' : 'trusted',
                score: Math.round(score),
                totalEvaluations: evaluations[0].total_evaluations,
                fraudRate: Math.round(fraudRate)
            };
        } catch (error) {
            console.error('Agent reputation error:', error);
            return { reputation: 'unknown', score: 50 };
        }
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_evaluations,
                    COUNT(DISTINCT agent_id) as unique_agents,
                    AVG(trust_score) as avg_trust,
                    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_alerts,
                    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_alerts,
                    SUM(CASE WHEN is_fraudulent = 1 THEN 1 ELSE 0 END) as fraud_detected
                 FROM agentic_fraud_evaluations
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                ...stats[0],
                fraudRate: stats[0].total_evaluations > 0 
                    ? ((stats[0].fraud_detected / stats[0].total_evaluations) * 100).toFixed(2) + '%'
                    : '0%',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            agentSessions: this.agentSessions.size,
            agentReputations: this.agentReputations.size,
            fraudAlerts: this.fraudAlerts.length,
            providerCache: this.providerCache.size,
            config: AGENTIC_FRAUD_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new AgenticFraudDetectionService();