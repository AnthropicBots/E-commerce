const db = require('../config/db').promise;
const crypto = require('crypto');
const { analyzeUserIntent, triggerAgentQuarantine } = require('./promptInjectionDetector');
const logger = require('../utils/logger');

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
        mandateViolation: 50,
        promptInjection: 60,
        contextPoisoning: 50,
        suspiciousEntities: 30
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
        'perplexity',
        'cohere',
        'meta'
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
        this.quarantinedAgents = new Map();
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
            promptAnalysis: null,
            quarantineTriggered: false,
            timestamp: new Date().toISOString()
        };

        try {
            // 1. Prompt Injection Analysis
            if (context.prompt) {
                const promptAnalysis = await analyzeUserIntent(
                    context.prompt,
                    agentData.agentId,
                    {
                        ...context,
                        isAgentic: true,
                        agentId: agentData.agentId,
                        agentType: agentData.type
                    }
                );
                evaluation.promptAnalysis = promptAnalysis;
                
                if (!promptAnalysis.safe || promptAnalysis.riskLevel === 'critical') {
                    evaluation.flags.push({
                        type: 'prompt_injection_detected',
                        severity: 'critical',
                        details: `Prompt injection detected: ${promptAnalysis.riskLevel}`,
                        patterns: promptAnalysis.detectedPatterns
                    });
                    evaluation.trustScore -= AGENTIC_FRAUD_CONFIG.riskSignals.promptInjection;
                    
                    if (promptAnalysis.quarantineTriggered) {
                        evaluation.quarantineTriggered = true;
                    }
                }
            }

            // 2. Agent Identity Validation
            const identityResult = await this.validateAgentIdentity(agentData);
            evaluation.flags.push(...identityResult.flags);
            evaluation.trustScore += identityResult.score;

            // 3. Agent Provenance Verification
            const provenanceResult = await this.verifyAgentProvenance(agentData);
            evaluation.flags.push(...provenanceResult.flags);
            evaluation.trustScore += provenanceResult.score;

            // 4. Interaction Pattern Analysis
            const patternResult = await this.analyzeInteractionPatterns(agentData, context);
            evaluation.flags.push(...patternResult.flags);
            evaluation.trustScore += patternResult.score;

            // 5. Mandate Scope Check
            const mandateResult = await this.checkMandateScope(agentData, context);
            evaluation.flags.push(...mandateResult.flags);
            evaluation.trustScore += mandateResult.score;

            // 6. Provider Verification
            const providerResult = await this.verifyProvider(agentData.provider);
            evaluation.flags.push(...providerResult.flags);
            evaluation.trustScore += providerResult.score;

            evaluation.trustScore = Math.max(0, Math.min(100, 100 + evaluation.trustScore));
            evaluation.riskLevel = this.calculateRiskLevel(evaluation.trustScore);
            evaluation.isFraudulent = evaluation.riskLevel === 'critical' || 
                                     evaluation.quarantineTriggered;

            evaluation.recommendations = this.generateRecommendations(evaluation);

            if (evaluation.isFraudulent || evaluation.quarantineTriggered) {
                await triggerAgentQuarantine(
                    agentData.agentId,
                    evaluation,
                    context
                );
                this.quarantinedAgents.set(agentData.agentId, {
                    evaluation,
                    context,
                    quarantinedAt: new Date().toISOString()
                });
            }

            await this.logEvaluation(agentData, evaluation, context);

        } catch (error) {
            logger.error('Agent evaluation error:', error);
            evaluation.flags.push({
                type: 'evaluation_error',
                severity: 'high',
                details: error.message
            });
            evaluation.trustScore = Math.max(0, evaluation.trustScore - 20);
        }

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

        // Check for agent version
        if (!agentData.version) {
            flags.push({
                type: 'missing_agent_version',
                severity: 'low',
                details: 'Agent version is missing'
            });
            score -= 5;
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

        if (!agentData.provenance) {
            flags.push({
                type: 'missing_provenance',
                severity: 'high',
                details: 'Agent provenance information is missing'
            });
            score -= 25;
            return { flags, score };
        }

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

        if (context.interactionSpeed) {
            if (context.interactionSpeed < 100) {
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

        if (context.navigationPattern) {
            const pattern = context.navigationPattern;
            
            if (pattern.includes('checkout') && !pattern.includes('product') && !pattern.includes('cart')) {
                flags.push({
                    type: 'unusual_navigation',
                    severity: 'high',
                    details: 'Direct checkout without product/cart navigation'
                });
                score -= AGENTIC_FRAUD_CONFIG.riskSignals.unusualPattern;
            }

            if (pattern.transitions && pattern.transitions > 10) {
                flags.push({
                    type: 'rapid_navigation',
                    severity: 'medium',
                    details: `Rapid navigation: ${pattern.transitions} transitions`
                });
                score -= 15;
            }
        }

        if (context.formCompletionTime && context.formCompletionTime < 1000) {
            flags.push({
                type: 'programmatic_form_completion',
                severity: 'high',
                details: `Form completed in ${context.formCompletionTime}ms (bot-like)`
            });
            score -= 25;
        }

        // Check for context poisoning indicators
        if (context.contextPoisoningIndicators && context.contextPoisoningIndicators.length > 0) {
            flags.push({
                type: 'context_poisoning_detected',
                severity: 'critical',
                details: `Context poisoning indicators: ${context.contextPoisoningIndicators.join(', ')}`
            });
            score -= AGENTIC_FRAUD_CONFIG.riskSignals.contextPoisoning;
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

        const { action, amount, merchant } = context;

        if (action && !context.mandate.allowedActions.includes(action)) {
            flags.push({
                type: 'mandate_violation_action',
                severity: 'critical',
                details: `Action "${action}" not in mandate scope`
            });
            score -= AGENTIC_FRAUD_CONFIG.riskSignals.mandateViolation;
        }

        if (amount && context.mandate.maxAmount && amount > context.mandate.maxAmount) {
            flags.push({
                type: 'mandate_violation_amount',
                severity: 'high',
                details: `Amount (${amount}) exceeds mandate limit (${context.mandate.maxAmount})`
            });
            score -= 35;
        }

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

        if (!AGENTIC_FRAUD_CONFIG.trustedProviders.includes(provider)) {
            flags.push({
                type: 'untrusted_provider',
                severity: 'medium',
                details: `Provider "${provider}" is not in trusted list`
            });
            score -= 20;
        }

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
            logger.error('Provider reputation error:', error);
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
            logger.error('Signature verification error:', error);
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
            recommendations.push('Quarantine agent session');
        }

        if (evaluation.riskLevel === 'high') {
            recommendations.push('Require additional verification');
            recommendations.push('Rate limit agent actions');
            recommendations.push('Monitor for unusual patterns');
            recommendations.push('Review prompt content');
        }

        if (evaluation.riskLevel === 'medium') {
            recommendations.push('Verify agent identity');
            recommendations.push('Check mandate scope');
            recommendations.push('Log all agent actions');
            recommendations.push('Enable enhanced monitoring');
        }

        for (const flag of evaluation.flags) {
            if (flag.type === 'prompt_injection_detected') {
                recommendations.push('Review prompt for injection attempts');
                recommendations.push('Update security rules');
            }
            if (flag.type === 'unsigned_agent') {
                recommendations.push('Require agent to be signed');
            }
            if (flag.type === 'mandate_violation_action') {
                recommendations.push('Update mandate scope');
            }
            if (flag.type === 'unknown_provider') {
                recommendations.push('Verify provider identity');
            }
            if (flag.type === 'context_poisoning_detected') {
                recommendations.push('Review context for poisoning attempts');
                recommendations.push('Implement additional context validation');
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
                  recommendations, prompt_analysis, quarantine_triggered, context, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    agentData.agentId,
                    evaluation.trustScore,
                    evaluation.riskLevel,
                    evaluation.isFraudulent ? 1 : 0,
                    JSON.stringify(evaluation.flags),
                    JSON.stringify(evaluation.recommendations),
                    JSON.stringify(evaluation.promptAnalysis),
                    evaluation.quarantineTriggered ? 1 : 0,
                    JSON.stringify(context)
                ]
            );

            this.fraudAlerts.push({
                agentId: agentData.agentId,
                ...evaluation
            });

            if (this.fraudAlerts.length > 1000) {
                this.fraudAlerts = this.fraudAlerts.slice(-1000);
            }
        } catch (error) {
            logger.error('Log evaluation error:', error);
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
                    SUM(CASE WHEN is_fraudulent = 1 THEN 1 ELSE 0 END) as fraud_count,
                    SUM(CASE WHEN quarantine_triggered = 1 THEN 1 ELSE 0 END) as quarantine_count
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
            const quarantineRate = (evaluations[0].quarantine_count / evaluations[0].total_evaluations) * 100;

            let reputation = 'trusted';
            if (quarantineRate > 20 || fraudRate > 30) reputation = 'malicious';
            else if (fraudRate > 10 || quarantineRate > 10) reputation = 'suspicious';
            else if (fraudRate > 5) reputation = 'neutral';

            return {
                reputation,
                score: Math.round(score),
                totalEvaluations: evaluations[0].total_evaluations,
                fraudRate: Math.round(fraudRate),
                quarantineRate: Math.round(quarantineRate),
                isQuarantined: this.quarantinedAgents.has(agentId)
            };
        } catch (error) {
            logger.error('Agent reputation error:', error);
            return { reputation: 'unknown', score: 50 };
        }
    }

    /**
     * Get quarantined agents
     */
    getQuarantinedAgents() {
        return Array.from(this.quarantinedAgents.entries()).map(([agentId, data]) => ({
            agentId,
            ...data
        }));
    }

    /**
     * Release agent from quarantine
     */
    async releaseFromQuarantine(agentId, adminId, reason) {
        try {
            if (!this.quarantinedAgents.has(agentId)) {
                throw new Error('Agent not found in quarantine');
            }

            await db.query(
                `UPDATE agent_quarantine 
                 SET status = 'released', 
                     released_at = NOW(),
                     released_by = ?,
                     release_reason = ?
                 WHERE agent_id = ? AND status = 'active'`,
                [adminId, reason, agentId]
            );

            this.quarantinedAgents.delete(agentId);
            logger.info(`Agent ${agentId} released from quarantine by ${adminId}`);
            return { success: true };
        } catch (error) {
            logger.error('Release from quarantine error:', error);
            throw error;
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
                    SUM(CASE WHEN is_fraudulent = 1 THEN 1 ELSE 0 END) as fraud_detected,
                    SUM(CASE WHEN quarantine_triggered = 1 THEN 1 ELSE 0 END) as quarantine_count
                 FROM agentic_fraud_evaluations
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                ...stats[0],
                fraudRate: stats[0].total_evaluations > 0 
                    ? ((stats[0].fraud_detected / stats[0].total_evaluations) * 100).toFixed(2) + '%'
                    : '0%',
                quarantineRate: stats[0].total_evaluations > 0
                    ? ((stats[0].quarantine_count / stats[0].total_evaluations) * 100).toFixed(2) + '%'
                    : '0%',
                activeQuarantines: this.quarantinedAgents.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Statistics error:', error);
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
            quarantinedAgents: this.quarantinedAgents.size,
            config: AGENTIC_FRAUD_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new AgenticFraudDetectionService();