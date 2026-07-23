// backend/services/agentLiabilityService.js

const crypto = require('crypto');
const db = require('../config/db').promise;

// ============================================
// LIABILITY CONFIGURATION
// ============================================

// ============================================
// AGENT LIABILITY SERVICE
// ============================================

const Joi = require('joi');
const winston = require('winston');
const Redis = require('ioredis');
const CircuitBreaker = require('opossum');
const prometheus = require('prom-client');
const cron = require('node-cron');

// ============================================
// LOGGER CONFIGURATION
// ============================================

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// ============================================
// REDIS CACHE
// ============================================

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => Math.min(times * 50, 2000)
});

const CACHE_TTL = {
    AGENT: 3600,
    INSURANCE: 1800,
    LIABILITY: 300,
};

// ============================================
// METRICS
// ============================================

const register = new prometheus.Registry();

const agentCounter = new prometheus.Counter({
    name: 'agent_liability_registrations_total',
    help: 'Total number of agent registrations',
});

const liabilityGauge = new prometheus.Gauge({
    name: 'agent_liability_amount',
    help: 'Current liability amount by tier',
    labelNames: ['tier']
});

const claimCounter = new prometheus.Counter({
    name: 'liability_claims_total',
    help: 'Total number of liability claims',
    labelNames: ['status']
});

const latencyHistogram = new prometheus.Histogram({
    name: 'liability_operation_duration_seconds',
    help: 'Duration of liability operations',
    labelNames: ['operation']
});

register.registerMetric(agentCounter);
register.registerMetric(liabilityGauge);
register.registerMetric(claimCounter);
register.registerMetric(latencyHistogram);

// ============================================
// VALIDATION SCHEMAS
// ============================================

const agentRegistrationSchema = Joi.object({
    name: Joi.string().required().min(2).max(100),
    ownerId: Joi.string().required(),
    ownerType: Joi.string().valid('merchant', 'customer', 'third-party').default('merchant'),
    liabilityTier: Joi.string().valid('FULL', 'PARTIAL', 'LIMITED', 'NONE').default('PARTIAL'),
    insuranceActive: Joi.boolean().default(false),
    maxTransactionLimit: Joi.number().positive().max(50000).default(50000),
    permissions: Joi.array().items(Joi.string()).default(['view', 'search']),
    publicKey: Joi.string().optional()
});

const claimSchema = Joi.object({
    agentId: Joi.string().required(),
    authorizationId: Joi.string().required(),
    amount: Joi.number().positive().required(),
    reason: Joi.string().required(),
    evidence: Joi.array().items(Joi.string()).default([])
});

const validateRegistration = (data) => {
    const { error, value } = agentRegistrationSchema.validate(data);
    if (error) {
        throw new Error(`Validation error: ${error.message}`);
    }
    return value;
};

const validateClaim = (data) => {
    const { error, value } = claimSchema.validate(data);
    if (error) {
        throw new Error(`Validation error: ${error.message}`);
    }
    return value;
};

// ============================================
// CONFIGURATION
// ============================================

const LIABILITY_CONFIG = {
    tiers: {
        FULL: { name: 'Full Liability', coverage: 100, premium: 0.05 },
        PARTIAL: { name: 'Partial Liability', coverage: 50, premium: 0.025 },
        LIMITED: { name: 'Limited Liability', coverage: 25, premium: 0.01 },
        NONE: { name: 'No Liability', coverage: 0, premium: 0 }
    },
    insuranceReserve: 100000,
    fraudCoverage: 0.9,
    chargebackProtection: true,
    signatureAlgorithm: 'sha256',
    mandateExpiry: 30,
    maxTransactionAmount: 50000,
    maxLiabilityPerAgent: 100000,
    maxLiabilityPerTransaction: 50000,
    maxLiabilityPerDay: 200000
};

// ============================================
// RETRY LOGIC
// ============================================

const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries) break;
            
            const delay = baseDelay * Math.pow(2, attempt - 1);
            logger.warn(`Retry ${attempt}/${maxRetries} after ${delay}ms`, { error: error.message });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
};

// ============================================
// CIRCUIT BREAKER
// ============================================

const circuitBreakerOptions = {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
};

const createCircuitBreaker = (fn, name) => {
    const breaker = new CircuitBreaker(fn, circuitBreakerOptions);
    
    breaker.on('open', () => {
        logger.warn(`Circuit breaker opened for ${name}`);
    });
    
    breaker.on('halfOpen', () => {
        logger.info(`Circuit breaker half-open for ${name}`);
    });
    
    breaker.on('close', () => {
        logger.info(`Circuit breaker closed for ${name}`);
    });
    
    breaker.on('fallback', () => {
        logger.warn(`Circuit breaker fallback triggered for ${name}`);
    });
    
    return breaker;
};

// ============================================
// CACHE HELPERS
// ============================================

const getCachedAgent = async (agentId) => {
    const key = `agent:${agentId}`;
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
    return null;
};

const setCachedAgent = async (agentId, agent) => {
    const key = `agent:${agentId}`;
    await redis.setex(key, CACHE_TTL.AGENT, JSON.stringify(agent));
};

const invalidateCache = async (agentId) => {
    await redis.del(`agent:${agentId}`);
    await redis.del(`insurance:${agentId}`);
    await redis.del(`liability:${agentId}`);
};

// ============================================
// LIABILITY FRAMEWORK CLASS

// ============================================

class AgentLiabilityService {
    constructor() {
        this.agentRegistrations = new Map();
        this.liabilityRecords = new Map();
        this.insuranceClaims = new Map();
        this.authorizationSessions = new Map();

    }

    /**
     * Register an AI agent
     */
    async registerAgent(agentData) {
        const registration = {
            agentId: this.generateAgentId(),
            name: agentData.name,
            ownerId: agentData.ownerId,
            ownerType: agentData.ownerType || 'merchant',
            registeredAt: new Date().toISOString(),
            liabilityTier: agentData.liabilityTier || 'PARTIAL',
            insuranceActive: agentData.insuranceActive || false,
            maxTransactionLimit: agentData.maxTransactionLimit || LIABILITY_CONFIG.maxTransactionAmount,
            permissions: agentData.permissions || ['view', 'search'],
            status: 'active',
            publicKey: agentData.publicKey || null
        };

        await this.storeRegistration(registration);

        if (registration.insuranceActive) {
            await this.createInsurancePolicy(registration.agentId);
        }

        this.agentRegistrations.set(registration.agentId, registration);
        console.log(`✅ Agent registered: ${registration.agentId}`);
        return registration;
    }

    /**
     * Authorize an agent action
     */
    async authorizeAction(agentId, action, data) {
        const agent = await this.getAgent(agentId);
        if (!agent || agent.status !== 'active') {
            return { authorized: false, reason: 'Agent not found or inactive' };
        }

        // Check permissions
        if (!this.hasPermission(agent, action)) {
            return { authorized: false, reason: `Agent lacks permission for action: ${action}` };
        }

        // Check transaction limits
        if (action === 'purchase' && data.amount > agent.maxTransactionLimit) {
            return { authorized: false, reason: `Amount exceeds agent limit` };
        }

        // Create authorization signature
        const signature = await this.createAuthorizationSignature(agentId, action, data);

        // Assign liability
        const liability = await this.assignLiability(agentId, action, data);

        const authorization = {
            id: this.generateAuthorizationId(),
            agentId,
            action,
            data,
            signature,
            liability,
            timestamp: new Date().toISOString(),
            status: 'authorized'
        };

        await this.storeAuthorization(authorization);
        await this.logLiabilityAssignment(agentId, liability, authorization);

        return {
            authorized: true,
            signature,
            liability,
            authorizationId: authorization.id
        };
    }

    /**
     * Assign liability for an action
     */
    async assignLiability(agentId, action, data) {
        const agent = await this.getAgent(agentId);
        const tier = LIABILITY_CONFIG.liabilityTiers[agent.liabilityTier] || LIABILITY_CONFIG.liabilityTiers.PARTIAL;

        let liability = {
            agentId,
            action,
            tier: agent.liabilityTier,
            coverage: tier.coverage,
            amount: 0,
            liabilityAmount: 0,
            assignedTo: agent.ownerId,
            timestamp: new Date().toISOString()
        };

        // Calculate liability amount
        if (action === 'purchase' && data.amount) {
            liability.amount = data.amount;
            liability.liabilityAmount = (data.amount * tier.coverage) / 100;
        }

        // Apply insurance if active
        if (agent.insuranceActive) {
            const insurance = await this.getInsurancePolicy(agentId);
            if (insurance && insurance.active && insurance.remainingBalance >= liability.liabilityAmount) {
                liability.insuranceCoverage = liability.liabilityAmount * LIABILITY_CONFIG.fraudCoverage;
                liability.liabilityAmount -= liability.insuranceCoverage;
            }
        }

        return liability;
    }

    /**
     * Setup cleanup jobs
     */
    setupCleanupJobs() {
        // Clean expired sessions daily
        cron.schedule('0 0 * * *', async () => {
            logger.info('Running cleanup job');
            try {
                await db.query(
                    'DELETE FROM agent_authorizations WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)'
                );
                
                await db.query(
                    'INSERT INTO liability_claims_archive SELECT * FROM liability_claims WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)'
                );
                
                await db.query(
                    'DELETE FROM liability_claims WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)'
                );
                
                logger.info('Cleanup completed successfully');
            } catch (error) {
                logger.error('Cleanup failed', { error: error.message });
            }
        });
    }

    /**
     * Register an AI agent with liability framework
     */
    async registerAgent(agentData) {
        const operation = 'registerAgent';
        const end = latencyHistogram.startTimer({ operation });
        
        try {
            // Validate input
            const validated = validateRegistration(agentData);
            
            const registration = {
                agentId: this.generateAgentId(),
                name: validated.name,
                ownerId: validated.ownerId,
                ownerType: validated.ownerType,
                registeredAt: new Date().toISOString(),
                liabilityTier: validated.liabilityTier,
                insuranceActive: validated.insuranceActive,
                maxTransactionLimit: validated.maxTransactionLimit,
                permissions: validated.permissions,
                status: 'active',
                publicKey: validated.publicKey || null
            };

            // Use transaction for atomicity
            const transaction = await db.getConnection();
            await transaction.beginTransaction();

            try {
                await this.storeRegistration(registration, transaction);

                if (registration.insuranceActive) {
                    await this.createInsurancePolicy(registration.agentId, transaction);
                }

                await transaction.commit();
            } catch (error) {
                await transaction.rollback();
                throw error;
            } finally {
                transaction.release();
            }

            // Cache the registration
            await setCachedAgent(registration.agentId, registration);
            this.agentRegistrations.set(registration.agentId, registration);

            // Update metrics
            agentCounter.inc();
            liabilityGauge.set({ tier: registration.liabilityTier }, 0);

            logger.info('Agent registered successfully', {
                agentId: registration.agentId,
                tier: registration.liabilityTier
            });

            // Send webhook notification
            await this.sendWebhook('agent.registered', {
                agentId: registration.agentId,
                name: registration.name,
                tier: registration.liabilityTier
            });

            end();
            return registration;

        } catch (error) {
            logger.error('Registration failed', { error: error.message, data: agentData });
            throw error;
        }
    }

    /**
     * Authorize an agent action with circuit breaker
     */
    async authorizeAction(agentId, action, data) {
        const operation = 'authorizeAction';
        const end = latencyHistogram.startTimer({ operation });

        try {
            const breaker = createCircuitBreaker(
                async () => {
                    // 1. Get agent with caching
                    let agent = await getCachedAgent(agentId);
                    if (!agent) {
                        agent = await this.getAgent(agentId);
                        if (agent) {
                            await setCachedAgent(agentId, agent);
                        }
                    }

                    if (!agent || agent.status !== 'active') {
                        return {
                            authorized: false,
                            reason: 'Agent not found or inactive',
                            liability: null
                        };
                    }

                    // 2. Check permissions
                    if (!this.hasPermission(agent, action)) {
                        return {
                            authorized: false,
                            reason: `Agent lacks permission for action: ${action}`,
                            liability: null
                        };
                    }

                    // 3. Check transaction limits
                    if (action === 'purchase' && data.amount) {
                        if (data.amount > agent.maxTransactionLimit) {
                            return {
                                authorized: false,
                                reason: `Transaction amount exceeds agent limit`,
                                liability: null
                            };
                        }
                    }

                    // 4. Create authorization signature
                    const signature = await this.createAuthorizationSignature(agentId, action, data);

                    // 5. Assign liability
                    const liability = await this.assignLiability(agentId, action, data);

                    // 6. Create authorization record
                    const authorization = {
                        id: this.generateAuthorizationId(),
                        agentId,
                        action,
                        data,
                        signature,
                        liability,
                        timestamp: new Date().toISOString(),
                        status: 'authorized'
                    };

                    await this.storeAuthorization(authorization);

                    return {
                        authorized: true,
                        signature,
                        liability,
                        authorizationId: authorization.id,
                        message: 'Action authorized with liability assignment'
                    };
                },
                'authorizeAction'
            );

            const result = await breaker.fire();
            end();
            return result;

        } catch (error) {
            logger.error('Authorization failed', { agentId, action, error: error.message });
            end();
            return {
                authorized: false,
                reason: `Authorization failed: ${error.message}`,
                liability: null
            };
        }

    }

    /**
     * Handle a liability claim
     */
    async handleLiabilityClaim(claimData) {
        const operation = 'handleClaim';
        const end = latencyHistogram.startTimer({ operation });

        try {
            const validated = validateClaim(claimData);

            const claim = {
                id: this.generateClaimId(),
                agentId: validated.agentId,
                authorizationId: validated.authorizationId,
                amount: validated.amount,
                reason: validated.reason,
                evidence: validated.evidence,
                status: 'pending',
                createdAt: new Date().toISOString(),
                resolvedAt: null,
                resolution: null
            };

            const transaction = await db.getConnection();
            await transaction.beginTransaction();

            try {
                const auth = await this.getAuthorization(validated.authorizationId, transaction);
                if (!auth) {
                    claim.status = 'rejected';
                    claim.resolution = 'Authorization not found';
                    await this.storeClaim(claim, transaction);
                    await transaction.commit();
                    end();
                    return claim;
                }

                const liability = auth.liability;
                if (claim.amount > liability.liabilityAmount) {
                    claim.status = 'rejected';
                    claim.resolution = 'Claim amount exceeds liability coverage';
                    await this.storeClaim(claim, transaction);
                    await transaction.commit();
                    end();
                    return claim;
                }

                const agent = await this.getAgent(validated.agentId, transaction);

                if (agent.insuranceActive) {
                    const insurance = await this.getInsurancePolicy(agent.agentId, transaction);
                    if (insurance && insurance.active && insurance.remainingBalance >= claim.amount) {
                        claim.insuranceUsed = claim.amount;
                        await this.deductInsurance(agent.agentId, claim.amount, transaction);
                        claim.status = 'resolved';
                        claim.resolution = 'Paid by insurance';
                        claim.resolvedAt = new Date().toISOString();
                    }
                }

                await this.storeClaim(claim, transaction);
                await transaction.commit();

                claimCounter.inc({ status: claim.status });

                // Send notification
                await this.sendWebhook('claim.created', {
                    claimId: claim.id,
                    agentId: claim.agentId,
                    amount: claim.amount,
                    status: claim.status
                });

                end();
                return claim;

            } catch (error) {
                await transaction.rollback();
                throw error;
            } finally {
                transaction.release();
            }

        } catch (error) {
            logger.error('Claim handling failed', { error: error.message, data: claimData });
            end();
            throw error;
        }
    }

    /**
     * Get agent details with caching
     */
    async getAgent(agentId, transaction = null) {
        try {
            const cached = await getCachedAgent(agentId);
            if (cached) return cached;

            const query = transaction || db;
            const [rows] = await query.query(
                'SELECT * FROM agent_liability_registrations WHERE agent_id = ?',
                [agentId]
            );

            if (rows.length > 0) {
                const agent = rows[0];
                agent.permissions = JSON.parse(agent.permissions);
                await setCachedAgent(agentId, agent);
                this.agentRegistrations.set(agentId, agent);
                return agent;
            }
            return null;
        } catch (error) {
            logger.error('Get agent error', { agentId, error: error.message });
            throw error;
        }
    }

    /**
     * Send webhook notification
     */
    async sendWebhook(event, data) {
        const webhookUrl = process.env.LIABILITY_WEBHOOK_URL;
        if (!webhookUrl) return;

        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event,
                    data,
                    timestamp: new Date().toISOString()
                })
            });

            if (!response.ok) {
                logger.warn('Webhook failed', { event, status: response.status });
            }
        } catch (error) {
            logger.error('Webhook error', { event, error: error.message });
        }

    }

    /**
     * Create insurance policy
     */
    async createInsurancePolicy(agentId, transaction = null) {
        const policy = {
            id: this.generatePolicyId(),
            agentId,
            createdAt: new Date().toISOString(),
            active: true,
            balance: LIABILITY_CONFIG.insuranceReserve,
            remainingBalance: LIABILITY_CONFIG.insuranceReserve,
            premium: LIABILITY_CONFIG.tiers.PARTIAL.premium,
            claims: 0,
            totalPaid: 0
        };

        await this.storeInsurancePolicy(policy, transaction);
        return policy;
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    /**
     * Get insurance policy with caching
     */
    async getInsurancePolicy(agentId, transaction = null) {
        const key = `insurance:${agentId}`;
        const cached = await redis.get(key);
        if (cached) return JSON.parse(cached);

        const query = transaction || db;
        const [rows] = await query.query(
            'SELECT * FROM agent_insurance_policies WHERE agent_id = ? AND active = 1',
            [agentId]
        );

        if (rows.length > 0) {
            await redis.setex(key, CACHE_TTL.INSURANCE, JSON.stringify(rows[0]));
            return rows[0];

        }
        return null;
    }

    hasPermission(agent, action) {
        const requiredPermissions = {
            'view': ['view'],
            'search': ['view', 'search'],
            'purchase': ['purchase', 'view', 'search'],
            'refund': ['refund', 'purchase', 'view', 'search'],
            'discount': ['discount', 'purchase', 'view', 'search']
        };
        const required = requiredPermissions[action] || ['view'];
        return required.some(perm => agent.permissions.includes(perm));
    }

    async createAuthorizationSignature(agentId, action, data) {
        const secret = process.env.AGENT_AUTH_SECRET || 'default_secret';
        const payload = `${agentId}:${action}:${JSON.stringify(data)}:${Date.now()}`;
        return crypto.createHmac('sha256', secret).update(payload).digest('hex');
    }

    generateAgentId() {
        return `AGT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateAuthorizationId() {
        return `AUTH_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateClaimId() {
        return `CLM_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generatePolicyId() {
        return `POL_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================


    /**
     * Deduct from insurance
     */
    async deductInsurance(agentId, amount, transaction = null) {
        const policy = await this.getInsurancePolicy(agentId, transaction);
        if (policy) {
            policy.remainingBalance -= amount;
            policy.claims += 1;
            policy.totalPaid += amount;
            await this.updateInsurancePolicy(policy, transaction);
            await redis.del(`insurance:${agentId}`);
        }
    }

    /**
     * Update insurance policy
     */
    async updateInsurancePolicy(policy, transaction = null) {
        const query = transaction || db;
        await query.query(
            `UPDATE agent_insurance_policies 
             SET remaining_balance = ?, claims = ?, total_paid = ? 
             WHERE id = ?`,
            [policy.remainingBalance, policy.claims, policy.totalPaid, policy.id]
        );
    }

    /**
     * Store registration
     */
    async storeRegistration(registration, transaction = null) {
        const query = transaction || db;
        await query.query(
            `INSERT INTO agent_liability_registrations 
             (agent_id, name, owner_id, owner_type, liability_tier, 
              insurance_active, max_transaction_limit, permissions, status, 
              public_key, registered_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                registration.agentId,
                registration.name,
                registration.ownerId,
                registration.ownerType,
                registration.liabilityTier,
                registration.insuranceActive ? 1 : 0,
                registration.maxTransactionLimit,
                JSON.stringify(registration.permissions),
                registration.status,
                registration.publicKey,
                registration.registeredAt
            ]
        );
    }


    /**
     * Store authorization
     */
    async storeAuthorization(authorization, transaction = null) {
        const query = transaction || db;
        await query.query(
            `INSERT INTO agent_authorizations 
             (id, agent_id, action, data, signature, liability, status, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                authorization.id,
                authorization.agentId,
                authorization.action,
                JSON.stringify(authorization.data),
                authorization.signature,
                JSON.stringify(authorization.liability),
                authorization.status,
                authorization.timestamp
            ]
        );
    }

    async getAuthorization(authId) {
        try {
            const [rows] = await db.query(
                'SELECT * FROM agent_authorizations WHERE id = ?',
                [authId]
            );
            if (rows.length > 0) {
                return {
                    ...rows[0],
                    data: JSON.parse(rows[0].data),
                    liability: JSON.parse(rows[0].liability)
                };
            }
        } catch (error) {
            console.error('Get authorization error:', error);
        }
        return null;
    }

    async logLiabilityAssignment(agentId, liability, authorization) {
        await db.query(
            `INSERT INTO liability_assignments 
             (agent_id, authorization_id, action, amount, liability_amount, 
              tier, coverage, assigned_to, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                agentId,
                authorization.id,
                authorization.action,
                liability.amount || 0,
                liability.liabilityAmount || 0,
                liability.tier,
                liability.coverage,
                liability.assignedTo
            ]
        );
    }

    async getInsurancePolicy(agentId) {
        try {
            const [rows] = await db.query(
                'SELECT * FROM agent_insurance_policies WHERE agent_id = ? AND active = 1',
                [agentId]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Get insurance error:', error);
            return null;
        }
    }

    async storeInsurancePolicy(policy) {
        await db.query(
            `INSERT INTO agent_insurance_policies 
             (id, agent_id, created_at, active, balance, remaining_balance, 
              premium, claims, total_paid)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                policy.id,
                policy.agentId,
                policy.createdAt,
                policy.active ? 1 : 0,
                policy.balance,
                policy.remainingBalance,
                policy.premium,
                policy.claims,
                policy.totalPaid
            ]
        );
    }

    async deductInsurance(agentId, amount) {
        const policy = await this.getInsurancePolicy(agentId);
        if (policy) {
            policy.remainingBalance -= amount;
            policy.claims += 1;
            policy.totalPaid += amount;
            await db.query(
                `UPDATE agent_insurance_policies 
                 SET remaining_balance = ?, claims = ?, total_paid = ? 
                 WHERE id = ?`,
                [policy.remainingBalance, policy.claims, policy.totalPaid, policy.id]
            );
        }
    }


    /**
     * Get authorization
     */
    async getAuthorization(authId, transaction = null) {
        const query = transaction || db;
        const [rows] = await query.query(
            'SELECT * FROM agent_authorizations WHERE id = ?',
            [authId]
        );
        if (rows.length > 0) {
            return {
                ...rows[0],
                data: JSON.parse(rows[0].data),
                liability: JSON.parse(rows[0].liability)
            };
        }
        return null;
    }

    /**
     * Store claim
     */
    async storeClaim(claim, transaction = null) {
        const query = transaction || db;
        await query.query(

            `INSERT INTO liability_claims 
             (id, agent_id, authorization_id, amount, reason, evidence, 
              status, created_at, resolved_at, resolution, insurance_used, 
              liability_amount, liable_party)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                claim.id,
                claim.agentId,
                claim.authorizationId,
                claim.amount,
                claim.reason,
                JSON.stringify(claim.evidence),
                claim.status,
                claim.createdAt,
                claim.resolvedAt || null,
                claim.resolution || null,

                claim.resolvedAt,
                claim.resolution,
                claim.insuranceUsed || 0,
                claim.liabilityAmount || 0,
                claim.liableParty || null
            ]
        );
    }

    // ============================================
    // STATISTICS
    // ============================================


    /**
     * Assign liability
     */
    async assignLiability(agentId, action, data) {
        const agent = await this.getAgent(agentId);
        const tier = LIABILITY_CONFIG.tiers[agent.liabilityTier] || LIABILITY_CONFIG.tiers.PARTIAL;

        let liability = {
            agentId,
            action,
            tier: agent.liabilityTier,
            coverage: tier.coverage,
            amount: 0,
            liabilityAmount: 0,
            assignedTo: agent.ownerId,
            timestamp: new Date().toISOString()
        };

        if (action === 'purchase' && data.amount) {
            liability.amount = data.amount;
            liability.liabilityAmount = (data.amount * tier.coverage) / 100;
        } else if (action === 'refund' && data.amount) {
            liability.amount = data.amount;
            liability.liabilityAmount = (data.amount * tier.coverage) / 100;
        }

        if (agent.insuranceActive) {
            const insurance = await this.getInsurancePolicy(agentId);
            if (insurance && insurance.active) {
                liability.insuranceCoverage = Math.min(
                    liability.liabilityAmount * LIABILITY_CONFIG.fraudCoverage,
                    insurance.remainingBalance
                );
                liability.liabilityAmount -= liability.insuranceCoverage;
            }
        }

        const dailyLiability = await this.getDailyLiability(agentId);
        const remainingDailyLimit = LIABILITY_CONFIG.maxLiabilityPerDay - dailyLiability;
        
        if (liability.liabilityAmount > remainingDailyLimit) {
            liability.liabilityAmount = remainingDailyLimit;
            liability.liabilityReduced = true;
            liability.reductionReason = 'Daily limit exceeded';
        }

        const totalLiability = await this.getTotalLiability(agentId);
        if (totalLiability + liability.liabilityAmount > LIABILITY_CONFIG.maxLiabilityPerAgent) {
            liability.liabilityAmount = Math.max(0, LIABILITY_CONFIG.maxLiabilityPerAgent - totalLiability);
            liability.liabilityReduced = true;
            liability.reductionReason = 'Agent liability limit exceeded';
        }

        liabilityGauge.set({ tier: liability.tier }, liability.liabilityAmount);

        return liability;
    }

    /**
     * Get daily liability
     */
    async getDailyLiability(agentId) {
        try {
            const [rows] = await db.query(
                `SELECT SUM(liability_amount) as total 
                 FROM liability_assignments 
                 WHERE agent_id = ? 
                 AND DATE(timestamp) = CURDATE()`,
                [agentId]
            );
            return parseFloat(rows[0]?.total) || 0;
        } catch (error) {
            logger.error('Daily liability error', { agentId, error: error.message });
            return 0;
        }
    }

    /**
     * Get total liability
     */
    async getTotalLiability(agentId) {
        try {
            const [rows] = await db.query(
                `SELECT SUM(liability_amount) as total 
                 FROM liability_assignments 
                 WHERE agent_id = ? 
                 AND status = 'pending'`,
                [agentId]
            );
            return parseFloat(rows[0]?.total) || 0;
        } catch (error) {
            logger.error('Total liability error', { agentId, error: error.message });
            return 0;
        }
    }

    /**
     * Check if agent has permission
     */
    hasPermission(agent, action) {
        const requiredPermissions = {
            'view': ['view'],
            'search': ['view', 'search'],
            'purchase': ['purchase', 'view', 'search'],
            'refund': ['refund', 'purchase', 'view', 'search'],
            'discount': ['discount', 'purchase', 'view', 'search'],
            'modify': ['modify', 'purchase', 'view', 'search']
        };

        const required = requiredPermissions[action] || ['view'];
        return required.some(perm => agent.permissions.includes(perm));
    }

    /**
     * Create authorization signature
     */
    async createAuthorizationSignature(agentId, action, data) {
        const secret = process.env.AGENT_AUTH_SECRET || 'default_secret';
        const payload = `${agentId}:${action}:${JSON.stringify(data)}:${Date.now()}`;
        return crypto
            .createHmac(LIABILITY_CONFIG.signatureAlgorithm, secret)
            .update(payload)
            .digest('hex');
    }

    /**
     * Generate IDs
     */
    generateAgentId() {
        return `AGT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateAuthorizationId() {
        return `AUTH_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateClaimId() {
        return `CLM_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generatePolicyId() {
        return `POL_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    /**
     * Get statistics
     */

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_agents,
                    SUM(CASE WHEN insurance_active = 1 THEN 1 ELSE 0 END) as insured_agents,
                    COUNT(DISTINCT owner_id) as unique_owners,

                    SUM(max_transaction_limit) as total_credit,

                    AVG(max_transaction_limit) as avg_credit
                 FROM agent_liability_registrations
                 WHERE status = 'active'`
            );

            const [claims] = await db.query(
                `SELECT 
                    COUNT(*) as total_claims,
                    SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_claims,
                    SUM(amount) as total_claimed,
                    SUM(liability_amount) as total_liability
                 FROM liability_claims
                 WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
            );

            return {
                agents: stats[0],
                claims: claims[0],
                config: LIABILITY_CONFIG,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Statistics error', { error: error.message });
            throw error;
        }
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            registrations: this.agentRegistrations.size,
            liabilityRecords: this.liabilityRecords.size,
            insuranceClaims: this.insuranceClaims.size,
            authorizationSessions: this.authorizationSessions.size,
            config: LIABILITY_CONFIG,
            cacheStats: {
                agent: CACHE_TTL.AGENT,
                insurance: CACHE_TTL.INSURANCE,
                liability: CACHE_TTL.LIABILITY
            }
        };
    }

    /**
     * Clear cache
     */
    async clearCache(agentId = null) {
        if (agentId) {
            await invalidateCache(agentId);
        } else {
            await redis.flushall();
        }
        logger.info('Cache cleared', { agentId: agentId || 'all' });
    }

    /**
     * Shutdown
     */
    async shutdown() {
        logger.info('Shutting down Agent Liability Service...');
        await redis.quit();
        logger.info('Agent Liability Service shutdown complete');
    }
}

// ============================================
// EXPORT
// ============================================

const service = new AgentLiabilityService();

process.on('SIGTERM', async () => {
    await service.shutdown();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await service.shutdown();
    process.exit(0);
});

module.exports = service;
