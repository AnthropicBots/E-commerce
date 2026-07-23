// backend/services/aiAuditTrailService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const Joi = require('joi');
const redis = require('../config/redis');
const { promisify } = require('util');
const CircuitBreaker = require('opossum');
const { RateLimiterRedis } = require('rate-limiter-flexible');
const logger = require('../config/logger');
const metrics = require('../config/metrics');
const webhookService = require('./webhookService');
const auditConfig = require('../config/auditConfig');

// ============================================
// VALIDATION SCHEMAS
// ============================================

const sessionSchema = Joi.object({
    agentId: Joi.string().required().min(1).max(100),
    userId: Joi.string().required().min(1).max(100),
    context: Joi.object().optional()
});

const negotiationStepSchema = Joi.object({
    step: Joi.string().required().min(1).max(100),
    data: Joi.object().required(),
    metadata: Joi.object().optional()
});

const decisionSchema = Joi.object({
    decision: Joi.string().required().min(1).max(500),
    rationale: Joi.string().required().min(1).max(2000),
    options: Joi.array().items(Joi.string()).required()
});

const changeSchema = Joi.object({
    field: Joi.string().required().min(1).max(100),
    oldValue: Joi.any().required(),
    newValue: Joi.any().required(),
    reason: Joi.string().required().min(1).max(500)
});

const certificateSchema = Joi.object({
    action: Joi.string().required().min(1).max(200),
    details: Joi.object().required()
});

// ============================================
// AUDIT TRAIL CLASS WITH ENHANCEMENTS
// ============================================

class AIAuditTrail {
    constructor() {
        this.auditLogs = [];
        this.certificates = [];
        this.sessionId = null;
        this.isCircuitOpen = false;
        this.retryCount = 0;
        
        // Initialize Circuit Breaker
        this.circuitBreaker = new CircuitBreaker(
            this.executeDatabaseOperation.bind(this),
            {
                timeout: 5000,
                errorThresholdPercentage: 50,
                resetTimeout: 30000,
                rollingCountTimeout: 10000,
                rollingCountBuckets: 10,
                name: 'aiAuditTrailDB'
            }
        );

        // Setup circuit breaker events
        this.setupCircuitBreakerEvents();

        // Initialize Rate Limiter
        this.rateLimiter = new RateLimiterRedis({
            storeClient: redis,
            keyPrefix: 'audit_rate_limit',
            points: auditConfig.rateLimits.maxRequests,
            duration: auditConfig.rateLimits.timeWindow,
            blockDuration: auditConfig.rateLimits.blockDuration
        });

        // Validate config on startup
        this.validateConfig();
    }

    /**
     * Setup Circuit Breaker Event Handlers
     */
    setupCircuitBreakerEvents() {
        this.circuitBreaker.on('open', () => {
            this.isCircuitOpen = true;
            logger.error('Circuit breaker opened for AI Audit Trail Service');
            metrics.increment('circuit_breaker.open');
            webhookService.sendAlert({
                type: 'circuit_breaker_opened',
                service: 'ai_audit_trail',
                timestamp: new Date().toISOString()
            });
        });

        this.circuitBreaker.on('halfOpen', () => {
            logger.info('Circuit breaker half-open for AI Audit Trail Service');
            metrics.increment('circuit_breaker.half_open');
        });

        this.circuitBreaker.on('close', () => {
            this.isCircuitOpen = false;
            logger.info('Circuit breaker closed for AI Audit Trail Service');
            metrics.increment('circuit_breaker.closed');
        });

        this.circuitBreaker.on('fail', (error) => {
            metrics.increment('circuit_breaker.failures');
            logger.error('Circuit breaker failure:', error);
        });
    }

    /**
     * Execute Database Operation with Retry Logic
     */
    async executeDatabaseOperation(operation, ...args) {
        let lastError = null;
        let attempt = 0;

        while (attempt < auditConfig.retry.maxAttempts) {
            try {
                const startTime = Date.now();
                const result = await operation(...args);
                const duration = Date.now() - startTime;
                
                // Track metrics
                metrics.histogram('db_operation_duration', duration);
                metrics.increment('db_operation.success');
                
                // Cache successful result if applicable
                if (operation.name === 'getAuditTrail' || operation.name === 'getStatistics') {
                    await this.cacheResult(operation.name, args, result);
                }
                
                return result;
            } catch (error) {
                lastError = error;
                attempt++;
                
                // Check if error is retryable
                if (!this.isRetryableError(error)) {
                    throw error;
                }

                if (attempt < auditConfig.retry.maxAttempts) {
                    const delay = this.calculateBackoff(attempt);
                    logger.warn(`Retry ${attempt}/${auditConfig.retry.maxAttempts} after ${delay}ms`, {
                        error: error.message,
                        operation: operation.name
                    });
                    await this.sleep(delay);
                    metrics.increment('db_operation.retry');
                }
            }
        }

        // All retries failed
        metrics.increment('db_operation.failure');
        logger.error('All retry attempts failed:', lastError);
        throw lastError;
    }

    /**
     * Calculate Exponential Backoff Delay
     */
    calculateBackoff(attempt) {
        const baseDelay = auditConfig.retry.baseDelay;
        const maxDelay = auditConfig.retry.maxDelay;
        const delay = baseDelay * Math.pow(2, attempt - 1);
        return Math.min(delay, maxDelay);
    }

    /**
     * Check if Error is Retryable
     */
    isRetryableError(error) {
        const retryableErrors = [
            'ETIMEDOUT',
            'ECONNRESET',
            'ECONNREFUSED',
            'ER_LOCK_DEADLOCK',
            'ER_DEADLOCK',
            'ER_QUERY_INTERRUPTED'
        ];
        return retryableErrors.some(e => error.code === e || error.message.includes(e));
    }

    /**
     * Sleep Helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cache Database Results
     */
    async cacheResult(key, args, result) {
        try {
            const cacheKey = `audit:${key}:${JSON.stringify(args)}`;
            await redis.setex(cacheKey, auditConfig.cache.ttl, JSON.stringify(result));
            metrics.increment('cache.set');
        } catch (error) {
            logger.error('Cache set error:', error);
        }
    }

    /**
     * Get Cached Result
     */
    async getCachedResult(key, args) {
        try {
            const cacheKey = `audit:${key}:${JSON.stringify(args)}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
                metrics.increment('cache.hit');
                return JSON.parse(cached);
            }
            metrics.increment('cache.miss');
            return null;
        } catch (error) {
            logger.error('Cache get error:', error);
            return null;
        }
    }

    /**
     * Invalidate Cache
     */
    async invalidateCache(pattern) {
        try {
            const keys = await redis.keys(`audit:${pattern}*`);
            if (keys.length > 0) {
                await redis.del(keys);
                metrics.increment('cache.invalidate', keys.length);
                logger.info(`Cache invalidated: ${keys.length} keys`);
            }
        } catch (error) {
            logger.error('Cache invalidation error:', error);
        }
    }

    /**
     * Validate Configuration
     */
    validateConfig() {
        try {
            // Validate LIABILITY_CONFIG
            if (auditConfig.liabilityConfig) {
                const configSchema = Joi.object({
                    maxLiability: Joi.number().positive().required(),
                    defaultLiability: Joi.number().positive().required(),
                    liabilityTiers: Joi.array().items(Joi.object({
                        tier: Joi.string().required(),
                        amount: Joi.number().positive().required(),
                        conditions: Joi.array().items(Joi.string())
                    })).required()
                });

                const { error } = configSchema.validate(auditConfig.liabilityConfig);
                if (error) {
                    throw new Error(`Invalid liability config: ${error.message}`);
                }
            }

            // Validate other configs
            if (auditConfig.retry) {
                const retrySchema = Joi.object({
                    maxAttempts: Joi.number().min(1).max(10).required(),
                    baseDelay: Joi.number().min(100).max(5000).required(),
                    maxDelay: Joi.number().min(1000).max(30000).required()
                });

                const { error } = retrySchema.validate(auditConfig.retry);
                if (error) {
                    throw new Error(`Invalid retry config: ${error.message}`);
                }
            }

            logger.info('Configuration validation successful');
            return true;
        } catch (error) {
            logger.error('Configuration validation failed:', error);
            // Use fallback defaults
            this.applyFallbackConfig();
            return false;
        }
    }

    /**
     * Apply Fallback Configuration
     */
    applyFallbackConfig() {
        logger.warn('Applying fallback configuration');
        auditConfig.retry = auditConfig.retry || {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 10000
        };
        auditConfig.cache = auditConfig.cache || {
            ttl: 300,
            enabled: true
        };
        auditConfig.rateLimits = auditConfig.rateLimits || {
            maxRequests: 100,
            timeWindow: 60,
            blockDuration: 300
        };
    }

    /**
     * Rate Limiting Check
     */
    async checkRateLimit(userId, ipAddress) {
        try {
            const key = userId || ipAddress || 'anonymous';
            await this.rateLimiter.consume(key);
            metrics.increment('rate_limit.pass');
            return true;
        } catch (error) {
            metrics.increment('rate_limit.block');
            logger.warn('Rate limit exceeded', { userId, ipAddress });
            throw new Error('Rate limit exceeded. Please try again later.');
        }
    }

    /**
     * Start a new audit session
     */
    async startSession(agentId, userId, context = {}) {
        const startTime = Date.now();
        try {
            // Validate inputs
            const { error } = sessionSchema.validate({ agentId, userId, context });
            if (error) {
                throw new Error(`Validation error: ${error.message}`);
            }

            // Check rate limit
            await this.checkRateLimit(userId, context.ipAddress);

            // Sanitize inputs
            const sanitizedAgentId = this.sanitizeInput(agentId);
            const sanitizedUserId = this.sanitizeInput(userId);

            this.sessionId = this.generateSessionId();
            this.auditLogs = [];
            
            const session = {
                sessionId: this.sessionId,
                agentId: sanitizedAgentId,
                userId: sanitizedUserId,
                context: this.sanitizeObject(context),
                startTime: new Date().toISOString(),
                status: 'active'
            };

            const logEntry = {
                type: 'session_start',
                data: session,
                level: 'info'
            };

            await this.log(logEntry);
            
            // Send webhook notification
            webhookService.sendWebhook({
                event: 'session_started',
                data: session
            });

            // Track metrics
            metrics.increment('audit.session_started');
            metrics.histogram('audit.session_start_duration', Date.now() - startTime);

            // Invalidate cache
            await this.invalidateCache('session');

            return this.sessionId;
        } catch (error) {
            metrics.increment('audit.session_start_error');
            logger.error('Start session error:', error);
            throw error;
        }
    }

    /**
     * Sanitize Input
     */
    sanitizeInput(input) {
        if (typeof input === 'string') {
            // Remove potential SQL injection patterns
            return input.replace(/['"\\;]/g, '').trim();
        }
        return input;
    }

    /**
     * Sanitize Object
     */
    sanitizeObject(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                sanitized[key] = this.sanitizeInput(value);
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitizeObject(value);
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    /**
     * Log a negotiation step
     */
    async logNegotiationStep(step, data, metadata = {}) {
        const startTime = Date.now();
        try {
            // Validate inputs
            const { error } = negotiationStepSchema.validate({ step, data, metadata });
            if (error) {
                throw new Error(`Validation error: ${error.message}`);
            }

            // Check rate limit
            await this.checkRateLimit(metadata.userId, metadata.ipAddress);

            const logEntry = {
                sessionId: this.sessionId,
                step: this.sanitizeInput(step),
                data: this.sanitizeObject(data),
                metadata: this.sanitizeObject(metadata),
                timestamp: new Date().toISOString(),
                hash: this.generateHash({ step, data, metadata, timestamp: new Date().toISOString() })
            };

            this.auditLogs.push(logEntry);

            await this.log({
                type: 'negotiation_step',
                data: logEntry,
                level: 'info'
            });

            // Track metrics
            metrics.increment('audit.negotiation_step');
            metrics.histogram('audit.step_duration', Date.now() - startTime);

            return logEntry;
        } catch (error) {
            metrics.increment('audit.negotiation_step_error');
            logger.error('Log negotiation step error:', error);
            throw error;
        }
    }

    /**
     * Log decision point
     */
    async logDecision(decision, rationale, options) {
        const startTime = Date.now();
        try {
            // Validate inputs
            const { error } = decisionSchema.validate({ decision, rationale, options });
            if (error) {
                throw new Error(`Validation error: ${error.message}`);
            }

            const decisionEntry = {
                sessionId: this.sessionId,
                decision: this.sanitizeInput(decision),
                rationale: this.sanitizeInput(rationale),
                options: options.map(o => this.sanitizeInput(o)),
                timestamp: new Date().toISOString(),
                hash: this.generateHash({ decision, rationale, options, timestamp: new Date().toISOString() })
            };

            this.auditLogs.push(decisionEntry);

            await this.log({
                type: 'decision_point',
                data: decisionEntry,
                level: 'info'
            });

            metrics.increment('audit.decision_logged');
            metrics.histogram('audit.decision_duration', Date.now() - startTime);

            return decisionEntry;
        } catch (error) {
            metrics.increment('audit.decision_error');
            logger.error('Log decision error:', error);
            throw error;
        }
    }

    /**
     * Log change tracking
     */
    async logChange(field, oldValue, newValue, reason) {
        try {
            // Validate inputs
            const { error } = changeSchema.validate({ field, oldValue, newValue, reason });
            if (error) {
                throw new Error(`Validation error: ${error.message}`);
            }

            const changeEntry = {
                sessionId: this.sessionId,
                field: this.sanitizeInput(field),
                oldValue: this.sanitizeObject(oldValue),
                newValue: this.sanitizeObject(newValue),
                reason: this.sanitizeInput(reason),
                timestamp: new Date().toISOString(),
                hash: this.generateHash({ field, oldValue, newValue, reason, timestamp: new Date().toISOString() })
            };

            this.auditLogs.push(changeEntry);

            await this.log({
                type: 'change_tracking',
                data: changeEntry,
                level: 'info'
            });

            metrics.increment('audit.change_logged');
            return changeEntry;
        } catch (error) {
            metrics.increment('audit.change_error');
            logger.error('Log change error:', error);
            throw error;
        }
    }

    /**
     * Create Certificate of Action
     */
    async createCertificate(action, details) {
        const startTime = Date.now();
        try {
            // Validate inputs
            const { error } = certificateSchema.validate({ action, details });
            if (error) {
                throw new Error(`Validation error: ${error.message}`);
            }

            const certificate = {
                id: this.generateCertificateId(),
                sessionId: this.sessionId,
                action: this.sanitizeInput(action),
                details: this.sanitizeObject(details),
                timestamp: new Date().toISOString(),
                hash: this.generateHash({ action, details, timestamp: new Date().toISOString() }),
                signature: await this.generateSignature({ action, details, timestamp: new Date().toISOString() }),
                status: 'active',
                version: auditConfig.version || '1.0.0'
            };

            this.certificates.push(certificate);

            // Store in database with retry logic
            const result = await this.circuitBreaker.fire(
                this.storeCertificate.bind(this),
                certificate
            );

            await this.log({
                type: 'certificate_created',
                data: certificate,
                level: 'info'
            });

            // Send webhook notification for critical event
            webhookService.sendWebhook({
                event: 'certificate_created',
                data: certificate,
                priority: 'high'
            });

            metrics.increment('audit.certificate_created');
            metrics.histogram('audit.certificate_duration', Date.now() - startTime);

            // Invalidate cache
            await this.invalidateCache('certificate');

            return certificate;
        } catch (error) {
            metrics.increment('audit.certificate_error');
            logger.error('Create certificate error:', error);
            
            // Send failure alert
            webhookService.sendAlert({
                type: 'certificate_creation_failed',
                error: error.message,
                action,
                timestamp: new Date().toISOString()
            });
            
            throw error;
        }
    }

    /**
     * Generate Certificate ID
     */
    generateCertificateId() {
        return `CERT_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Generate Session ID
     */
    generateSessionId() {
        return `SESS_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Generate Hash
     */
    generateHash(data) {
        return crypto
            .createHash(auditConfig.algorithm || 'sha256')
            .update(JSON.stringify(data))
            .digest(auditConfig.encoding || 'hex');
    }

    /**
     * Generate Signature
     */
    async generateSignature(data) {
        const privateKey = process.env.AI_PRIVATE_KEY || 'default_private_key';
        const signature = crypto
            .createHmac(auditConfig.algorithm || 'sha256', privateKey)
            .update(JSON.stringify(data))
            .digest(auditConfig.encoding || 'hex');
        return signature;
    }

    /**
     * Verify Certificate
     */
    async verifyCertificate(certificate) {
        const startTime = Date.now();
        try {
            const { action, details, timestamp, signature } = certificate;
            const expectedSignature = await this.generateSignature({ action, details, timestamp });
            
            if (signature !== expectedSignature) {
                metrics.increment('audit.verification_failed');
                return { valid: false, reason: 'Invalid signature' };
            }

            // Check cache first
            const cachedResult = await this.getCachedResult('verifyCertificate', [certificate.id]);
            if (cachedResult) {
                return cachedResult;
            }

            // Check if certificate exists in database with retry
            const existing = await this.circuitBreaker.fire(
                async () => {
                    const [rows] = await db.query(
                        'SELECT * FROM ai_certificates WHERE id = ?',
                        [certificate.id]
                    );
                    return rows;
                }
            );

            if (existing.length === 0) {
                return { valid: false, reason: 'Certificate not found in database' };
            }

            if (existing[0].status === 'revoked') {
                return { valid: false, reason: 'Certificate has been revoked' };
            }

            const result = { valid: true };
            
            // Cache the result
            await this.cacheResult('verifyCertificate', [certificate.id], result);

            metrics.increment('audit.verification_success');
            metrics.histogram('audit.verification_duration', Date.now() - startTime);

            return result;
        } catch (error) {
            metrics.increment('audit.verification_error');
            logger.error('Certificate verification error:', error);
            return { valid: false, reason: error.message };
        }
    }

    /**
     * Store Certificate in Database
     */
    async storeCertificate(certificate) {
        try {
            await db.query(
                `INSERT INTO ai_certificates 
                 (id, session_id, action, details, timestamp, hash, signature, status, version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    certificate.id,
                    certificate.sessionId,
                    certificate.action,
                    JSON.stringify(certificate.details),
                    certificate.timestamp,
                    certificate.hash,
                    certificate.signature,
                    certificate.status,
                    certificate.version
                ]
            );
            
            logger.info(`✅ Certificate stored: ${certificate.id}`);
            return certificate;
        } catch (error) {
            logger.error('Error storing certificate:', error);
            throw error;
        }
    }

    /**
     * Get Audit Trail with Caching
     */
    async getAuditTrail() {
        try {
            // Check cache first
            const cached = await this.getCachedResult('getAuditTrail', [this.sessionId]);
            if (cached) {
                return cached;
            }

            const result = {
                sessionId: this.sessionId,
                logs: this.auditLogs,
                certificates: this.certificates,
                count: this.auditLogs.length
            };

            // Cache the result
            await this.cacheResult('getAuditTrail', [this.sessionId], result);

            return result;
        } catch (error) {
            logger.error('Get audit trail error:', error);
            throw error;
        }
    }

    /**
     * Get Certificate with Caching
     */
    async getCertificate(certificateId) {
        try {
            // Check cache first
            const cached = await this.getCachedResult('getCertificate', [certificateId]);
            if (cached) {
                return cached;
            }

            const certificate = this.certificates.find(c => c.id === certificateId) || null;
            
            if (certificate) {
                await this.cacheResult('getCertificate', [certificateId], certificate);
            }

            return certificate;
        } catch (error) {
            logger.error('Get certificate error:', error);
            throw error;
        }
    }

    /**
     * Revoke Certificate
     */
    async revokeCertificate(certificateId, reason) {
        try {
            const certificate = await this.getCertificate(certificateId);
            if (!certificate) {
                throw new Error('Certificate not found');
            }

            certificate.status = 'revoked';
            certificate.revokedAt = new Date().toISOString();
            certificate.revocationReason = this.sanitizeInput(reason);

            await db.query(
                `UPDATE ai_certificates 
                 SET status = ?, revoked_at = ?, revocation_reason = ? 
                 WHERE id = ?`,
                ['revoked', certificate.revokedAt, reason, certificateId]
            );

            await this.log({
                type: 'certificate_revoked',
                data: certificate,
                level: 'error'
            });

            // Send webhook notification
            webhookService.sendAlert({
                type: 'certificate_revoked',
                certificateId,
                reason,
                timestamp: new Date().toISOString()
            });

            metrics.increment('audit.certificate_revoked');
            await this.invalidateCache('certificate');

            return certificate;
        } catch (error) {
            logger.error('Revoke certificate error:', error);
            throw error;
        }
    }

    /**
     * Log to database with retry
     */
    async log(entry) {
        try {
            await this.circuitBreaker.fire(
                async () => {
                    await db.query(
                        `INSERT INTO ai_audit_logs 
                         (session_id, type, data, level, timestamp)
                         VALUES (?, ?, ?, ?, NOW())`,
                        [
                            this.sessionId || entry.sessionId || 'unknown',
                            entry.type,
                            JSON.stringify(entry.data),
                            entry.level || 'info'
                        ]
                    );
                }
            );

            // Track metrics
            metrics.increment(`audit.log.${entry.level}`);
            
            // Send alert for critical levels
            if (entry.level === 'error' || entry.level === 'critical') {
                webhookService.sendAlert({
                    type: 'audit_critical_log',
                    entry: entry,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            metrics.increment('audit.log_error');
            logger.error('Error logging audit entry:', error);
            
            // Try to log to file as fallback
            await this.logToFile(entry);
        }
    }

    /**
     * Fallback file logging
     */
    async logToFile(entry) {
        try {
            const fs = require('fs').promises;
            const logLine = JSON.stringify({
                ...entry,
                fallbackLogged: new Date().toISOString()
            }) + '\n';
            await fs.appendFile('logs/audit_fallback.log', logLine);
        } catch (error) {
            logger.error('Fallback logging failed:', error);
        }
    }

    /**
     * Export Audit Report
     */
    async exportReport(startDate, endDate) {
        try {
            const [logs] = await db.query(
                `SELECT * FROM ai_audit_logs 
                 WHERE timestamp BETWEEN ? AND ? 
                 ORDER BY timestamp ASC`,
                [startDate, endDate]
            );

            const [certificates] = await db.query(
                `SELECT * FROM ai_certificates 
                 WHERE timestamp BETWEEN ? AND ?`,
                [startDate, endDate]
            );

            const report = {
                period: { startDate, endDate },
                logs: logs,
                certificates: certificates,
                summary: {
                    totalLogs: logs.length,
                    totalCertificates: certificates.length,
                    exportedAt: new Date().toISOString(),
                    exportVersion: auditConfig.version || '1.0.0'
                }
            };

            metrics.increment('audit.export');

            return report;
        } catch (error) {
            logger.error('Export error:', error);
            throw error;
        }
    }

    /**
     * Check Regulatory Compliance
     */
    async checkCompliance(sessionId) {
        try {
            const [logs] = await db.query(
                `SELECT * FROM ai_audit_logs 
                 WHERE session_id = ? 
                 ORDER BY timestamp ASC`,
                [sessionId]
            );

            const complianceChecks = {
                hasStart: false,
                hasDecision: false,
                hasCertificate: false,
                hasValidSignature: false,
                isComplete: false,
                hasAgentId: false,
                hasUserId: false,
                hasTimestamp: false
            };

            // Check for required steps
            complianceChecks.hasStart = logs.some(l => l.type === 'session_start');
            complianceChecks.hasDecision = logs.some(l => l.type === 'decision_point');
            
            const [certificates] = await db.query(
                `SELECT * FROM ai_certificates 
                 WHERE session_id = ?`,
                [sessionId]
            );
            complianceChecks.hasCertificate = certificates.length > 0;

            if (certificates.length > 0) {
                const verified = await this.verifyCertificate(certificates[0]);
                complianceChecks.hasValidSignature = verified.valid;
            }

            // Check if all steps are complete
            const requiredSteps = ['session_start', 'negotiation_step', 'decision_point', 'certificate_created'];
            const presentSteps = new Set(logs.map(l => l.type));
            complianceChecks.isComplete = requiredSteps.every(s => presentSteps.has(s));

            // Additional checks
            complianceChecks.hasAgentId = logs.some(l => l.data && l.data.agentId);
            complianceChecks.hasUserId = logs.some(l => l.data && l.data.userId);
            complianceChecks.hasTimestamp = logs.every(l => l.timestamp);

            // Calculate compliance score
            const complianceScore = Object.values(complianceChecks).filter(v => v === true).length;
            const totalChecks = Object.values(complianceChecks).length;
            const score = (complianceScore / totalChecks) * 100;

            const result = {
                sessionId,
                complianceChecks,
                score: Math.round(score),
                isCompliant: score >= auditConfig.complianceThreshold || 80,
                recommendations: this.generateRecommendations(complianceChecks)
            };

            // Send webhook if non-compliant
            if (!result.isCompliant) {
                webhookService.sendAlert({
                    type: 'compliance_violation',
                    sessionId,
                    score: result.score,
                    timestamp: new Date().toISOString()
                });
            }

            metrics.increment('audit.compliance_check');
            metrics.gauge('audit.compliance_score', score);

            return result;
        } catch (error) {
            logger.error('Compliance check error:', error);
            throw error;
        }
    }

    /**
     * Generate Compliance Recommendations
     */
    generateRecommendations(checks) {
        const recommendations = [];

        if (!checks.hasStart) {
            recommendations.push('Start an audit session before any negotiation');
        }
        if (!checks.hasDecision) {
            recommendations.push('Log all decision points during negotiation');
        }
        if (!checks.hasCertificate) {
            recommendations.push('Create a Certificate of Action after completion');
        }
        if (!checks.hasValidSignature) {
            recommendations.push('Ensure certificates are properly signed and verified');
        }
        if (!checks.isComplete) {
            recommendations.push('Complete all required audit steps');
        }
        if (!checks.hasAgentId) {
            recommendations.push('Include agent ID in audit logs');
        }
        if (!checks.hasUserId) {
            recommendations.push('Include user ID in audit logs');
        }
        if (!checks.hasTimestamp) {
            recommendations.push('Ensure all logs have timestamps');
        }

        return recommendations;
    }

    /**
     * Get Audit Statistics with Caching
     */
    async getStatistics() {
        try {
            // Check cache first
            const cached = await this.getCachedResult('getStatistics', []);
            if (cached) {
                return cached;
            }

            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_logs,
                    COUNT(DISTINCT session_id) as total_sessions,
                    COUNT(DISTINCT CASE WHEN type = 'certificate_created' THEN session_id END) as certified_sessions,
                    SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) as errors,
                    SUM(CASE WHEN level = 'warning' THEN 1 ELSE 0 END) as warnings,
                    SUM(CASE WHEN level = 'critical' THEN 1 ELSE 0 END) as critical,
                    DATE(MIN(timestamp)) as first_log,
                    DATE(MAX(timestamp)) as last_log
                 FROM ai_audit_logs
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)`
            );

            const result = {
                ...stats[0],
                auditRetention: auditConfig.retentionDays || 2555,
                version: auditConfig.version || '1.0.0',
                circuitBreakerStatus: this.isCircuitOpen ? 'open' : 'closed',
                cacheStats: {
                    hits: metrics.getCounter('cache.hit') || 0,
                    misses: metrics.getCounter('cache.miss') || 0,
                    sets: metrics.getCounter('cache.set') || 0,
                    invalidations: metrics.getCounter('cache.invalidate') || 0
                },
                rateLimitStats: {
                    passes: metrics.getCounter('rate_limit.pass') || 0,
                    blocks: metrics.getCounter('rate_limit.block') || 0
                }
            };

            // Cache the result
            await this.cacheResult('getStatistics', [], result);

            return result;
        } catch (error) {
            logger.error('Stats error:', error);
            throw error;
        }
    }

    /**
     * Health Check
     */
    async healthCheck() {
        try {
            // Check database connection
            await db.query('SELECT 1');
            
            // Check Redis connection
            await redis.ping();
            
            // Check circuit breaker status
            const cbStatus = this.circuitBreaker.status;
            
            return {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                database: 'connected',
                redis: 'connected',
                circuitBreaker: {
                    status: this.isCircuitOpen ? 'open' : 'closed',
                    stats: cbStatus ? cbStatus.stats : null
                },
                version: auditConfig.version || '1.0.0'
            };
        } catch (error) {
            logger.error('Health check failed:', error);
            return {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message,
                database: error.code?.includes('ER_') ? 'error' : 'unknown',
                redis: error.code?.includes('ECONN') ? 'error' : 'unknown'
            };
        }
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new AIAuditTrail();