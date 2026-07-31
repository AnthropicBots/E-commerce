// backend/services/factTrustService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const FACT_CONFIG = {
    // Trust levels
    trustLevels: {
        UNKNOWN: 0,
        BASIC: 25,
        VERIFIED: 50,
        TRUSTED: 75,
        CERTIFIED: 100
    },
    
    // Attestation types
    attestationTypes: {
        PROVISIONING: 'provisioning',
        TRANSACTION: 'transaction',
        COMPLIANCE: 'compliance',
        AUDIT: 'audit'
    },
    
    // Auditor agent config
    auditorConfig: {
        observationWindow: 300, // seconds
        minObservations: 5,
        verificationInterval: 60 // seconds
    },
    
    // Policy enforcement
    policyEnforcement: {
        strictMode: true,
        autoBlock: true,
        alertThreshold: 0.7
    }
};

// ============================================
// FACT TRUST FRAMEWORK CLASS
// ============================================

class FACTTrustService {
    constructor() {
        this.trustRecords = new Map();
        this.attestations = new Map();
        this.auditorAgents = new Map();
        this.verificationSessions = new Map();
        this.trustAlerts = [];
        this.auditTrails = [];
    }

    /**
     * Initialize FACT trust for an agent
     */
    async initializeTrust(agentId, initialData = {}) {
        const trustRecord = {
            agentId,
            trustLevel: FACT_CONFIG.trustLevels.BASIC,
            trustScore: 25,
            createdAt: new Date().toISOString(),
            lastVerified: new Date().toISOString(),
            attestations: [],
            policies: initialData.policies || [],
            constraints: initialData.constraints || {},
            auditorId: await this.assignAuditor(agentId),
            status: 'active'
        };

        // Create initial attestation
        const attestation = await this.createAttestation(
            agentId,
            FACT_CONFIG.attestationTypes.PROVISIONING,
            {
                trustLevel: trustRecord.trustLevel,
                policies: trustRecord.policies,
                constraints: trustRecord.constraints
            }
        );

        trustRecord.attestations.push(attestation);
        this.trustRecords.set(agentId, trustRecord);

        await this.storeTrustRecord(agentId, trustRecord);
        await this.storeAttestation(attestation);

        // Initialize auditor agent
        await this.initializeAuditorAgent(trustRecord.auditorId, agentId);

        console.log(`✅ FACT trust initialized for agent: ${agentId}`);
        return trustRecord;
    }

    /**
     * Verify an agent action in real-time
     */
    async verifyAction(agentId, action, context = {}) {
        const trustRecord = this.trustRecords.get(agentId);
        if (!trustRecord) {
            throw new Error(`No trust record found for agent: ${agentId}`);
        }

        const verification = {
            agentId,
            action,
            context,
            timestamp: new Date().toISOString(),
            verified: false,
            trustScore: 0,
            attestation: null,
            violations: [],
            auditorObservations: []
        };

        // 1. Check trust level
        if (trustRecord.trustLevel < FACT_CONFIG.trustLevels.VERIFIED) {
            verification.violations.push({
                type: 'insufficient_trust',
                details: `Trust level ${trustRecord.trustLevel} below required threshold`
            });
        }

        // 2. Check policies
        const policyCheck = await this.checkPolicies(trustRecord.policies, action, context);
        if (!policyCheck.compliant) {
            verification.violations.push(...policyCheck.violations);
        }

        // 3. Check constraints
        const constraintCheck = await this.checkConstraints(
            trustRecord.constraints,
            action,
            context
        );
        if (!constraintCheck.compliant) {
            verification.violations.push(...constraintCheck.violations);
        }

        // 4. Auditor agent observation
        const auditorObservation = await this.auditorAgentObservation(
            trustRecord.auditorId,
            agentId,
            action,
            context
        );
        verification.auditorObservations.push(auditorObservation);

        // 5. Calculate trust score
        verification.trustScore = await this.calculateTrustScore(
            trustRecord,
            verification,
            auditorObservation
        );

        // 6. Create attestation
        if (verification.trustScore >= 50) {
            verification.verified = true;
            verification.attestation = await this.createAttestation(
                agentId,
                FACT_CONFIG.attestationTypes.TRANSACTION,
                {
                    action,
                    context,
                    trustScore: verification.trustScore,
                    auditorObservation
                }
            );
        }

        // 7. Update trust record
        await this.updateTrustRecord(agentId, verification);

        // 8. Generate alert if needed
        if (verification.trustScore < FACT_CONFIG.policyEnforcement.alertThreshold * 100) {
            await this.generateTrustAlert(agentId, verification);
        }

        // 9. Store verification
        await this.storeVerification(agentId, verification);

        return verification;
    }

    /**
     * Create attestation
     */
    async createAttestation(agentId, type, data) {
        const attestation = {
            id: this.generateAttestationId(),
            agentId,
            type,
            data,
            timestamp: new Date().toISOString(),
            hash: this.generateHash({ agentId, type, data, timestamp: new Date().toISOString() }),
            signature: await this.generateSignature({ agentId, type, data, timestamp: new Date().toISOString() }),
            status: 'active'
        };

        this.attestations.set(attestation.id, attestation);
        return attestation;
    }

    /**
     * Check policies compliance
     */
    async checkPolicies(policies, action, context) {
        const violations = [];
        let compliant = true;

        for (const policy of policies) {
            // Check action permissions
            if (policy.type === 'action_permission') {
                if (!policy.allowedActions.includes(action)) {
                    violations.push({
                        type: 'policy_violation',
                        policy: policy.name,
                        details: `Action "${action}" not allowed by policy "${policy.name}"`
                    });
                    compliant = false;
                }
            }

            // Check merchant permissions
            if (policy.type === 'merchant_permission' && context.merchantId) {
                if (!policy.allowedMerchants.includes(context.merchantId)) {
                    violations.push({
                        type: 'policy_violation',
                        policy: policy.name,
                        details: `Merchant "${context.merchantId}" not allowed by policy "${policy.name}"`
                    });
                    compliant = false;
                }
            }

            // Check amount limits
            if (policy.type === 'amount_limit' && context.amount) {
                if (context.amount > policy.maxAmount) {
                    violations.push({
                        type: 'policy_violation',
                        policy: policy.name,
                        details: `Amount ${context.amount} exceeds limit ${policy.maxAmount}`
                    });
                    compliant = false;
                }
            }
        }

        return { compliant, violations };
    }

    /**
     * Check constraints
     */
    async checkConstraints(constraints, action, context) {
        const violations = [];
        let compliant = true;

        if (constraints.maxAmount && context.amount && context.amount > constraints.maxAmount) {
            violations.push({
                type: 'constraint_violation',
                details: `Amount ${context.amount} exceeds max ${constraints.maxAmount}`
            });
            compliant = false;
        }

        if (constraints.allowedMerchants && context.merchantId) {
            if (!constraints.allowedMerchants.includes(context.merchantId)) {
                violations.push({
                    type: 'constraint_violation',
                    details: `Merchant ${context.merchantId} not in allowed list`
                });
                compliant = false;
            }
        }

        if (constraints.maxActions && context.actionCount && context.actionCount > constraints.maxActions) {
            violations.push({
                type: 'constraint_violation',
                details: `Action count ${context.actionCount} exceeds max ${constraints.maxActions}`
            });
            compliant = false;
        }

        return { compliant, violations };
    }

    /**
     * Auditor agent observation
     */
    async auditorAgentObservation(auditorId, agentId, action, context) {
        const observation = {
            auditorId,
            agentId,
            action,
            context,
            timestamp: new Date().toISOString(),
            verified: false,
            observations: [],
            trustScore: 0
        };

        // Simulate auditor agent verification
        // In production, this would use an actual AI agent

        // Check for suspicious patterns
        if (context.amount && context.amount > 10000) {
            observation.observations.push({
                type: 'large_amount',
                details: `Large transaction amount: ${context.amount}`
            });
        }

        if (context.merchantId && context.merchantId.startsWith('unknown_')) {
            observation.observations.push({
                type: 'unknown_merchant',
                details: `Unknown merchant: ${context.merchantId}`
            });
        }

        if (action === 'bulk_purchase' || action === 'rapid_checkout') {
            observation.observations.push({
                type: 'suspicious_action',
                details: `Suspicious action: ${action}`
            });
        }

        // Calculate auditor trust score
        observation.trustScore = Math.max(0, 100 - observation.observations.length * 20);
        observation.verified = observation.trustScore >= 50;

        // Store observation
        await this.storeAuditorObservation(auditorId, agentId, observation);

        return observation;
    }

    /**
     * Calculate trust score
     */
    async calculateTrustScore(trustRecord, verification, auditorObservation) {
        let score = trustRecord.trustScore || 0;

        // Deduct for violations
        score -= verification.violations.length * 10;

        // Auditor observation weight
        score += auditorObservation.trustScore * 0.3;

        // Time-based decay (trust decreases over time without verification)
        const hoursSinceLastVerify = (Date.now() - new Date(trustRecord.lastVerified).getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastVerify > 24) {
            score -= hoursSinceLastVerify * 0.5;
        }

        // Policy compliance bonus
        if (verification.violations.length === 0) {
            score += 5;
        }

        // Ensure score stays within bounds
        return Math.max(0, Math.min(100, score));
    }

    /**
     * Update trust record
     */
    async updateTrustRecord(agentId, verification) {
        const trustRecord = this.trustRecords.get(agentId);
        if (!trustRecord) return;

        trustRecord.trustScore = verification.trustScore;
        trustRecord.trustLevel = this.getTrustLevel(verification.trustScore);
        trustRecord.lastVerified = new Date().toISOString();
        trustRecord.status = verification.trustScore >= 50 ? 'active' : 'suspended';

        if (verification.attestation) {
            trustRecord.attestations.push(verification.attestation);
        }

        this.trustRecords.set(agentId, trustRecord);
        await this.storeTrustRecord(agentId, trustRecord);
    }

    /**
     * Get trust level from score
     */
    getTrustLevel(score) {
        if (score >= 100) return FACT_CONFIG.trustLevels.CERTIFIED;
        if (score >= 75) return FACT_CONFIG.trustLevels.TRUSTED;
        if (score >= 50) return FACT_CONFIG.trustLevels.VERIFIED;
        if (score >= 25) return FACT_CONFIG.trustLevels.BASIC;
        return FACT_CONFIG.trustLevels.UNKNOWN;
    }

    /**
     * Assign auditor agent
     */
    async assignAuditor(agentId) {
        const auditorId = `AUDITOR_${crypto.randomBytes(8).toString('hex')}`;
        this.auditorAgents.set(auditorId, {
            id: auditorId,
            assignedAgent: agentId,
            status: 'active',
            observations: [],
            createdAt: new Date().toISOString()
        });
        return auditorId;
    }

    /**
     * Initialize auditor agent
     */
    async initializeAuditorAgent(auditorId, agentId) {
        const auditor = this.auditorAgents.get(auditorId);
        if (!auditor) return;

        auditor.status = 'active';
        auditor.initializedAt = new Date().toISOString();

        // Start continuous observation
        this.startContinuousObservation(auditorId, agentId);

        await this.storeAuditorAgent(auditor);
        console.log(`✅ Auditor agent ${auditorId} initialized for agent ${agentId}`);
    }

    /**
     * Start continuous observation
     */
    startContinuousObservation(auditorId, agentId) {
        // Start periodic verification
        const interval = setInterval(async () => {
            try {
                const trustRecord = this.trustRecords.get(agentId);
                if (!trustRecord) {
                    clearInterval(interval);
                    return;
                }

                // Perform continuous verification
                const verification = await this.verifyAction(agentId, 'continuous_check', {
                    timestamp: new Date().toISOString()
                });

                if (verification.trustScore < 30) {
                    await this.generateTrustAlert(agentId, {
                        type: 'continuous_verification_failed',
                        trustScore: verification.trustScore,
                        violations: verification.violations
                    });
                }

                // Update auditor state
                const auditor = this.auditorAgents.get(auditorId);
                if (auditor) {
                    auditor.lastVerification = new Date().toISOString();
                    auditor.verificationCount = (auditor.verificationCount || 0) + 1;
                }
            } catch (error) {
                console.error('Continuous observation error:', error);
            }
        }, FACT_CONFIG.auditorConfig.verificationInterval * 1000);

        // Store interval for cleanup
        if (!this.auditIntervals) {
            this.auditIntervals = new Map();
        }
        this.auditIntervals.set(auditorId, interval);
    }

    /**
     * Generate trust alert
     */
    async generateTrustAlert(agentId, verification) {
        const alert = {
            id: `ALERT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            agentId,
            type: 'trust_alert',
            severity: verification.trustScore < 30 ? 'critical' : 'high',
            verification,
            timestamp: new Date().toISOString(),
            resolved: false
        };

        this.trustAlerts.push(alert);
        await this.storeTrustAlert(alert);

        if (alert.severity === 'critical') {
            console.error(`🚨 CRITICAL: Trust alert for agent ${agentId}`);
            console.error(`Trust Score: ${verification.trustScore}`);
            console.error(`Violations:`, verification.violations);
        }

        return alert;
    }

    // ============================================
    // GENERATE IDS & HASHES
    // ============================================

    generateAttestationId() {
        return `ATTEST_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    generateHash(data) {
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    async generateSignature(data) {
        const secret = process.env.FACT_SECRET || 'default_fact_secret';
        return crypto.createHmac('sha256', secret).update(JSON.stringify(data)).digest('hex');
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeTrustRecord(agentId, trustRecord) {
        try {
            await db.query(
                `INSERT INTO fact_trust_records 
                 (agent_id, trust_level, trust_score, created_at, last_verified,
                  attestations, policies, constraints, auditor_id, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 trust_level = VALUES(trust_level),
                 trust_score = VALUES(trust_score),
                 last_verified = VALUES(last_verified),
                 attestations = VALUES(attestations),
                 policies = VALUES(policies),
                 constraints = VALUES(constraints),
                 status = VALUES(status)`,
                [
                    agentId,
                    trustRecord.trustLevel,
                    trustRecord.trustScore,
                    trustRecord.createdAt,
                    trustRecord.lastVerified,
                    JSON.stringify(trustRecord.attestations),
                    JSON.stringify(trustRecord.policies),
                    JSON.stringify(trustRecord.constraints),
                    trustRecord.auditorId,
                    trustRecord.status
                ]
            );
        } catch (error) {
            console.error('Store trust record error:', error);
        }
    }

    async storeAttestation(attestation) {
        try {
            await db.query(
                `INSERT INTO fact_attestations 
                 (id, agent_id, type, data, timestamp, hash, signature, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    attestation.id,
                    attestation.agentId,
                    attestation.type,
                    JSON.stringify(attestation.data),
                    attestation.timestamp,
                    attestation.hash,
                    attestation.signature,
                    attestation.status
                ]
            );
        } catch (error) {
            console.error('Store attestation error:', error);
        }
    }

    async storeVerification(agentId, verification) {
        try {
            await db.query(
                `INSERT INTO fact_verifications 
                 (agent_id, action, context, verified, trust_score,
                  attestation_id, violations, auditor_observations, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    agentId,
                    verification.action,
                    JSON.stringify(verification.context),
                    verification.verified ? 1 : 0,
                    verification.trustScore,
                    verification.attestation?.id || null,
                    JSON.stringify(verification.violations),
                    JSON.stringify(verification.auditorObservations),
                    verification.timestamp
                ]
            );
        } catch (error) {
            console.error('Store verification error:', error);
        }
    }

    async storeAuditorObservation(auditorId, agentId, observation) {
        try {
            await db.query(
                `INSERT INTO fact_auditor_observations 
                 (auditor_id, agent_id, action, context, verified,
                  observations, trust_score, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    auditorId,
                    agentId,
                    observation.action,
                    JSON.stringify(observation.context),
                    observation.verified ? 1 : 0,
                    JSON.stringify(observation.observations),
                    observation.trustScore,
                    observation.timestamp
                ]
            );
        } catch (error) {
            console.error('Store auditor observation error:', error);
        }
    }

    async storeAuditorAgent(auditor) {
        try {
            await db.query(
                `INSERT INTO fact_auditor_agents 
                 (auditor_id, assigned_agent, status, initialized_at, last_verification)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 status = VALUES(status),
                 last_verification = VALUES(last_verification)`,
                [
                    auditor.id,
                    auditor.assignedAgent,
                    auditor.status,
                    auditor.initializedAt,
                    auditor.lastVerification
                ]
            );
        } catch (error) {
            console.error('Store auditor error:', error);
        }
    }

    async storeTrustAlert(alert) {
        try {
            await db.query(
                `INSERT INTO fact_trust_alerts 
                 (id, agent_id, type, severity, verification, timestamp, resolved)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    alert.id,
                    alert.agentId,
                    alert.type,
                    alert.severity,
                    JSON.stringify(alert.verification),
                    alert.timestamp,
                    alert.resolved ? 1 : 0
                ]
            );
        } catch (error) {
            console.error('Store alert error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_agents,
                    AVG(trust_score) as avg_trust,
                    SUM(CASE WHEN trust_level >= 75 THEN 1 ELSE 0 END) as trusted_agents,
                    SUM(CASE WHEN trust_level < 50 THEN 1 ELSE 0 END) as untrusted_agents,
                    COUNT(DISTINCT auditor_id) as active_auditors
                 FROM fact_trust_records
                 WHERE status = 'active'`
            );

            const [alertStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_alerts,
                    SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_alerts,
                    SUM(CASE WHEN resolved = FALSE THEN 1 ELSE 0 END) as pending_alerts
                 FROM fact_trust_alerts
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            return {
                agents: stats[0],
                alerts: alertStats[0],
                config: FACT_CONFIG,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            trustRecords: this.trustRecords.size,
            attestations: this.attestations.size,
            auditorAgents: this.auditorAgents.size,
            trustAlerts: this.trustAlerts.length,
            config: FACT_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new FACTTrustService();