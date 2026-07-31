// backend/services/hallucinationDetectionService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const EventEmitter = require('events');
const Joi = require('joi');

// ============================================
// HALLUCINATION DETECTION CONFIGURATION
// ============================================

const HALLUCINATION_CONFIG = {
    validationThreshold: 0.7,
    confidenceThreshold: 0.6,
    maxUnverifiedFields: 2,
    priceDeviationThreshold: 0.3,
    stockDeviationThreshold: 0.5,
    maxRetryIterations: 2, // ← HARD BOUNDARY: Maximum retry iterations
    suspiciousPatterns: [
        /free/i,
        /unlimited/i,
        /infinite/i,
        /unbelievable/i,
        /too good to be true/i,
        /best ever/i,
        /perfect/i,
        /100%/i,
        /guaranteed/i,
        /magic/i
    ]
};

const DATA_SOURCES = {
    VERIFIED: 'verified',
    AI_GENERATED: 'ai_generated',
    USER_SUBMITTED: 'user_submitted',
    PARTNER: 'partner',
    SCRAPED: 'scraped'
};

// ============================================
// GROUND TRUTH VERIFICATION SCHEMAS
// ============================================

const GroundTruthSchema = Joi.object({
    id: Joi.string().required(),
    name: Joi.string().required().min(1).max(200),
    price: Joi.number().positive().required(),
    stock: Joi.number().integer().min(0).required(),
    category: Joi.string().required(),
    description: Joi.string().min(10).max(5000).required(),
    specifications: Joi.array().items(
        Joi.object({
            name: Joi.string().required(),
            value: Joi.string().required()
        })
    ),
    verified: Joi.boolean().default(false),
    createdAt: Joi.date().iso(),
    updatedAt: Joi.date().iso()
});

const RefundEligibilitySchema = Joi.object({
    orderId: Joi.string().required(),
    customerId: Joi.string().required(),
    amount: Joi.number().positive().required(),
    reason: Joi.string().required(),
    eligibility: Joi.boolean().required(),
    policyReference: Joi.string().required(),
    verifiedBy: Joi.string().required(),
    verificationTimestamp: Joi.date().iso().required()
});

// ============================================
// HALLUCINATION DETECTION SERVICE
// ============================================

class HallucinationDetectionService extends EventEmitter {
    constructor() {
        super();
        this.validatedData = new Map();
        this.detectionLogs = [];
        this.productProfiles = new Map();
        this.marketData = new Map();
        this.hallucinationAlerts = [];
        this.isInitialized = false;
        this.retryCounter = new Map(); // ← TRACK RETRY ATTEMPTS PER REQUEST
        this.escalationQueue = []; // ← HUMAN ESCALATION QUEUE
        this.dbTruthCache = new Map(); // ← DATABASE TRUTH CACHE
        this.processingLocks = new Map(); // ← PREVENT RACE CONDITIONS
    }

    /**
     * Initialize hallucination detection service
     */
    async initialize() {
        if (this.isInitialized) return;

        try {
            await this.loadVerifiedData();
            await this.loadMarketData();
            await this.loadPolicyTruthData();
            
            this.isInitialized = true;
            console.log('✅ Hallucination Detection Service initialized');
            console.log(`📊 Loaded ${this.productProfiles.size} verified products`);
            console.log(`📊 Loaded ${this.marketData.size} market categories`);
            console.log(`📊 Loaded ${this.dbTruthCache.size} policy truth records`);
        } catch (error) {
            console.error('❌ Hallucination Detection Service initialization failed:', error);
            throw error;
        }
        
        return this;
    }

    /**
     * Load policy truth data from database
     */
    async loadPolicyTruthData() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM refund_policies WHERE is_active = 1 AND verified = 1`
            );

            for (const row of rows) {
                this.dbTruthCache.set(row.policy_key, {
                    id: row.id,
                    policyKey: row.policy_key,
                    eligibilityRules: JSON.parse(row.eligibility_rules || '{}'),
                    maxRefundAmount: row.max_refund_amount,
                    minOrderAmount: row.min_order_amount,
                    refundWindowDays: row.refund_window_days,
                    requiresApproval: row.requires_approval === 1,
                    approvedCategories: JSON.parse(row.approved_categories || '[]'),
                    excludedItems: JSON.parse(row.excluded_items || '[]'),
                    verificationRequired: row.verification_required === 1,
                    updatedAt: row.updated_at
                });
            }

            console.log(`📊 Loaded ${rows.length} policy truth records`);
        } catch (error) {
            console.error('Load policy truth data error:', error);
        }
    }

    /**
     * VALIDATE AGAINST GROUND TRUTH - Main entry point with retry boundary
     */
    async validateAgainstGroundTruth(inputData, context = {}) {
        const requestId = context.requestId || crypto.randomBytes(8).toString('hex');
        const startTime = Date.now();

        // Initialize retry counter for this request
        if (!this.retryCounter.has(requestId)) {
            this.retryCounter.set(requestId, 0);
        }

        try {
            // Step 1: Extract database truth for verification
            const dbTruth = await this.fetchDatabaseTruth(inputData, context);
            
            // Step 2: Validate against strict JSON Schema
            const schemaValidation = await this.validateAgainstSchema(inputData, context);
            
            if (!schemaValidation.isValid) {
                // Schema validation failed - immediate escalation
                return await this.handleValidationFailure(
                    inputData,
                    schemaValidation,
                    requestId,
                    context
                );
            }

            // Step 3: Verify against database truth records
            const truthVerification = await this.verifyAgainstDatabaseTruth(
                inputData,
                dbTruth,
                context
            );

            if (!truthVerification.isValid) {
                // Truth verification failed - check retry count
                const retryCount = this.retryCounter.get(requestId) || 0;
                
                if (retryCount < HALLUCINATION_CONFIG.maxRetryIterations) {
                    // Retry with correction
                    this.retryCounter.set(requestId, retryCount + 1);
                    this.emit('verification.retry', {
                        requestId,
                        attempt: retryCount + 1,
                        maxAttempts: HALLUCINATION_CONFIG.maxRetryIterations,
                        errors: truthVerification.errors
                    });
                    
                    // Apply corrections and retry
                    const correctedData = await this.applyCorrections(inputData, truthVerification.corrections);
                    return await this.validateAgainstGroundTruth(correctedData, {
                        ...context,
                        requestId,
                        isRetry: true,
                        retryCount: retryCount + 1
                    });
                } else {
                    // Max retries exceeded - escalate to human
                    return await this.escalateToHuman(
                        inputData,
                        truthVerification,
                        requestId,
                        context
                    );
                }
            }

            // Step 4: Check for hallucination patterns
            const hallucinationCheck = await this.detectHallucinations(inputData, context);

            // Step 5: Build final verification result
            const result = {
                isValid: schemaValidation.isValid && truthVerification.isValid && !hallucinationCheck.hasHallucinations,
                requestId,
                timestamp: new Date().toISOString(),
                schemaValidation,
                truthVerification,
                hallucinationCheck,
                confidence: this.calculateConfidence(schemaValidation, truthVerification, hallucinationCheck),
                retryCount: this.retryCounter.get(requestId) || 0,
                maxRetriesReached: (this.retryCounter.get(requestId) || 0) >= HALLUCINATION_CONFIG.maxRetryIterations,
                processingTime: Date.now() - startTime,
                escalated: false
            };

            // Clear retry counter on success
            this.retryCounter.delete(requestId);

            // Log verification result
            await this.logVerificationResult(inputData, result, context);

            // Emit event for monitoring
            this.emit('verification.complete', result);

            return result;

        } catch (error) {
            console.error('❌ Ground truth validation error:', error);
            
            // Emergency escalation on critical error
            return await this.escalateToHuman(
                inputData,
                { error: error.message, isValid: false },
                requestId,
                context
            );
        }
    }

    /**
     * Fetch database truth for verification
     */
    async fetchDatabaseTruth(inputData, context) {
        try {
            let dbTruth = {};

            // If it's a refund claim, fetch policy truth
            if (inputData.refundClaim || inputData.orderId) {
                const orderId = inputData.orderId || inputData.refundClaim?.orderId;
                if (orderId) {
                    const [orderRows] = await db.query(
                        `SELECT o.*, p.policy_key, p.eligibility_rules, p.max_refund_amount,
                                p.refund_window_days, p.requires_approval
                         FROM orders o
                         LEFT JOIN refund_policies p ON o.policy_id = p.id
                         WHERE o.id = ?`,
                        [orderId]
                    );

                    if (orderRows.length > 0) {
                        const order = orderRows[0];
                        dbTruth.order = {
                            id: order.id,
                            customerId: order.customer_id,
                            totalAmount: order.total_amount,
                            orderDate: order.created_at,
                            status: order.status,
                            policyKey: order.policy_key,
                            eligibilityRules: JSON.parse(order.eligibility_rules || '{}'),
                            maxRefundAmount: order.max_refund_amount,
                            refundWindowDays: order.refund_window_days,
                            requiresApproval: order.requires_approval === 1
                        };
                    }
                }
            }

            // Fetch product truth if product ID is provided
            if (inputData.productId) {
                const [productRows] = await db.query(
                    `SELECT * FROM products WHERE id = ? AND verified = 1`,
                    [inputData.productId]
                );

                if (productRows.length > 0) {
                    dbTruth.product = productRows[0];
                }
            }

            // Fetch customer truth if customer ID is provided
            if (inputData.customerId) {
                const [customerRows] = await db.query(
                    `SELECT * FROM customers WHERE id = ?`,
                    [inputData.customerId]
                );

                if (customerRows.length > 0) {
                    dbTruth.customer = customerRows[0];
                }
            }

            return dbTruth;

        } catch (error) {
            console.error('Fetch database truth error:', error);
            return { error: error.message };
        }
    }

    /**
     * Validate against strict JSON Schema
     */
    async validateAgainstSchema(inputData, context) {
        try {
            let schemaToUse;

            // Determine which schema to use based on input type
            if (inputData.refundClaim || inputData.orderId) {
                schemaToUse = RefundEligibilitySchema;
            } else {
                schemaToUse = GroundTruthSchema;
            }

            const { error, value } = schemaToUse.validate(inputData, {
                abortEarly: false,
                stripUnknown: true,
                presence: 'required'
            });

            if (error) {
                const errors = error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    type: detail.type
                }));

                return {
                    isValid: false,
                    errors,
                    warnings: [],
                    validatedData: null
                };
            }

            return {
                isValid: true,
                errors: [],
                warnings: [],
                validatedData: value
            };

        } catch (error) {
            console.error('Schema validation error:', error);
            return {
                isValid: false,
                errors: [{ field: 'schema', message: error.message, type: 'schema_error' }],
                warnings: [],
                validatedData: null
            };
        }
    }

    /**
     * Verify against database truth records
     */
    async verifyAgainstDatabaseTruth(inputData, dbTruth, context) {
        const errors = [];
        const corrections = [];
        let isValid = true;

        try {
            // Verify order data if available
            if (dbTruth.order && inputData.orderId) {
                // Verify refund amount
                if (inputData.refundAmount) {
                    const maxRefund = dbTruth.order.maxRefundAmount || dbTruth.order.totalAmount;
                    if (inputData.refundAmount > maxRefund) {
                        errors.push({
                            field: 'refundAmount',
                            message: `Refund amount ${inputData.refundAmount} exceeds maximum allowed ${maxRefund}`,
                            severity: 'critical',
                            dbValue: maxRefund,
                            providedValue: inputData.refundAmount
                        });
                        corrections.push({
                            field: 'refundAmount',
                            suggestedValue: maxRefund,
                            reason: 'Maximum refund amount from policy'
                        });
                        isValid = false;
                    }
                }

                // Verify refund window
                if (inputData.refundRequestDate && dbTruth.order.orderDate) {
                    const daysSinceOrder = (Date.now() - new Date(dbTruth.order.orderDate).getTime()) / (1000 * 60 * 60 * 24);
                    const refundWindow = dbTruth.order.refundWindowDays || 30;
                    
                    if (daysSinceOrder > refundWindow) {
                        errors.push({
                            field: 'refundRequestDate',
                            message: `Refund request is ${Math.floor(daysSinceOrder)} days after order, exceeds ${refundWindow} day window`,
                            severity: 'critical',
                            dbValue: refundWindow,
                            providedValue: daysSinceOrder
                        });
                        isValid = false;
                    }
                }

                // Verify order status allows refund
                const allowedStatuses = ['delivered', 'completed', 'shipped'];
                if (!allowedStatuses.includes(dbTruth.order.status)) {
                    errors.push({
                        field: 'orderStatus',
                        message: `Order status "${dbTruth.order.status}" does not allow refunds`,
                        severity: 'critical',
                        dbValue: dbTruth.order.status,
                        providedValue: inputData.orderStatus || dbTruth.order.status
                    });
                    isValid = false;
                }

                // Verify against eligibility rules
                if (dbTruth.order.eligibilityRules) {
                    const rules = dbTruth.order.eligibilityRules;
                    
                    // Check if reason is eligible
                    if (inputData.reason && rules.allowedReasons) {
                        const reason = inputData.reason.toLowerCase();
                        const allowed = rules.allowedReasons.some(r => 
                            reason.includes(r.toLowerCase())
                        );
                        
                        if (!allowed && rules.allowedReasons.length > 0) {
                            errors.push({
                                field: 'reason',
                                message: `Refund reason "${inputData.reason}" is not in allowed reasons list`,
                                severity: 'high',
                                dbValue: rules.allowedReasons,
                                providedValue: inputData.reason
                            });
                            corrections.push({
                                field: 'reason',
                                suggestedValue: rules.allowedReasons[0],
                                reason: 'First allowed reason from policy'
                            });
                            isValid = false;
                        }
                    }
                }
            }

            // Verify product data if available
            if (dbTruth.product && inputData.productId) {
                // Verify price
                if (inputData.price && dbTruth.product.price) {
                    const deviation = Math.abs(inputData.price - dbTruth.product.price) / dbTruth.product.price;
                    if (deviation > HALLUCINATION_CONFIG.priceDeviationThreshold) {
                        errors.push({
                            field: 'price',
                            message: `Price ${inputData.price} deviates ${(deviation * 100).toFixed(1)}% from verified price ${dbTruth.product.price}`,
                            severity: 'high',
                            dbValue: dbTruth.product.price,
                            providedValue: inputData.price
                        });
                        corrections.push({
                            field: 'price',
                            suggestedValue: dbTruth.product.price,
                            reason: 'Verified price from database'
                        });
                        isValid = false;
                    }
                }

                // Verify stock
                if (inputData.stock !== undefined && dbTruth.product.stock !== undefined) {
                    const stockDiff = Math.abs(inputData.stock - dbTruth.product.stock);
                    if (stockDiff > HALLUCINATION_CONFIG.stockDeviationThreshold * dbTruth.product.stock) {
                        errors.push({
                            field: 'stock',
                            message: `Stock ${inputData.stock} deviates significantly from verified stock ${dbTruth.product.stock}`,
                            severity: 'high',
                            dbValue: dbTruth.product.stock,
                            providedValue: inputData.stock
                        });
                        corrections.push({
                            field: 'stock',
                            suggestedValue: dbTruth.product.stock,
                            reason: 'Verified stock from database'
                        });
                        isValid = false;
                    }
                }
            }

            // Verify customer data if available
            if (dbTruth.customer && inputData.customerId) {
                // Check for fraud indicators
                if (dbTruth.customer.fraud_score && dbTruth.customer.fraud_score > 0.7) {
                    errors.push({
                        field: 'customerFraudScore',
                        message: `Customer has high fraud score: ${dbTruth.customer.fraud_score}`,
                        severity: 'critical',
                        dbValue: dbTruth.customer.fraud_score,
                        providedValue: inputData.fraudScore || 'unknown'
                    });
                    isValid = false;
                }

                // Check customer refund history
                if (dbTruth.customer.total_refunds && dbTruth.customer.total_refunds > 5) {
                    errors.push({
                        field: 'refundHistory',
                        message: `Customer has ${dbTruth.customer.total_refunds} refunds, exceeds limit`,
                        severity: 'high',
                        dbValue: dbTruth.customer.total_refunds,
                        providedValue: inputData.totalRefunds || 'unknown'
                    });
                    isValid = false;
                }
            }

        } catch (error) {
            console.error('Database truth verification error:', error);
            errors.push({
                field: 'database',
                message: error.message,
                severity: 'critical'
            });
            isValid = false;
        }

        return {
            isValid,
            errors,
            corrections,
            dbTruthUsed: dbTruth
        };
    }

    /**
     * Detect hallucinations in AI output
     */
    async detectHallucinations(inputData, context) {
        const flags = [];
        let hasHallucinations = false;
        const textToCheck = JSON.stringify(inputData).toLowerCase();

        // Check for suspicious patterns
        for (const pattern of HALLUCINATION_CONFIG.suspiciousPatterns) {
            if (pattern.test(textToCheck)) {
                flags.push({
                    pattern: pattern.source,
                    severity: 'medium',
                    message: `Suspicious pattern "${pattern.source}" detected in AI output`,
                    recommendation: 'Review and verify this claim'
                });
                hasHallucinations = true;
            }
        }

        // Check for unrealistic claims
        if (inputData.price) {
            const price = parseFloat(inputData.price);
            if (price > 1000000) {
                flags.push({
                    field: 'price',
                    severity: 'high',
                    message: `Price ${price} is unrealistically high`,
                    recommendation: 'Verify price with market data'
                });
                hasHallucinations = true;
            }
            if (price < 0.01 && price > 0) {
                flags.push({
                    field: 'price',
                    severity: 'medium',
                    message: `Price ${price} seems unrealistically low`,
                    recommendation: 'Verify price with market data'
                });
                hasHallucinations = true;
            }
        }

        // Check for impossible stock values
        if (inputData.stock) {
            const stock = parseInt(inputData.stock);
            if (stock > 999999) {
                flags.push({
                    field: 'stock',
                    severity: 'high',
                    message: `Stock ${stock} is unrealistically high`,
                    recommendation: 'Verify stock quantity with inventory system'
                });
                hasHallucinations = true;
            }
        }

        // Check for hallucinated product features
        const hallucinationKeywords = [
            'unlimited', 'infinite', 'never expiring', 'lifetime',
            'guaranteed 100%', 'free forever', 'unlimited access'
        ];
        for (const keyword of hallucinationKeywords) {
            if (textToCheck.includes(keyword)) {
                flags.push({
                    field: 'description',
                    severity: 'medium',
                    message: `Hallucination indicator "${keyword}" found in description`,
                    recommendation: 'Verify this claim against product specifications'
                });
                hasHallucinations = true;
            }
        }

        // Check for consistency between fields
        if (inputData.price && inputData.originalPrice) {
            const price = parseFloat(inputData.price);
            const originalPrice = parseFloat(inputData.originalPrice);
            if (price > originalPrice) {
                flags.push({
                    field: 'discount',
                    severity: 'high',
                    message: `Sale price ${price} is higher than original price ${originalPrice}`,
                    recommendation: 'Verify pricing logic'
                });
                hasHallucinations = true;
            }
            const discount = 1 - (price / originalPrice);
            if (discount > 0.9) {
                flags.push({
                    field: 'discount',
                    severity: 'high',
                    message: `Discount ${(discount * 100).toFixed(1)}% is unrealistic`,
                    recommendation: 'Verify discount with pricing strategy'
                });
                hasHallucinations = true;
            }
        }

        return {
            hasHallucinations,
            flags,
            confidence: hasHallucinations ? 0.3 : 0.9,
            recommendation: hasHallucinations ? 'Human review required' : 'Proceed with verification'
        };
    }

    /**
     * Calculate overall confidence
     */
    calculateConfidence(schemaValidation, truthVerification, hallucinationCheck) {
        let score = 0;
        let total = 0;

        // Schema validation weight
        if (schemaValidation.isValid) {
            score += 0.3;
        }
        total += 0.3;

        // Truth verification weight
        const truthScore = truthVerification.isValid ? 1 : 
            Math.max(0, 1 - (truthVerification.errors.length / 10));
        score += truthScore * 0.5;
        total += 0.5;

        // Hallucination check weight
        const hallucinationScore = hallucinationCheck.hasHallucinations ? 
            Math.max(0, 1 - (hallucinationCheck.flags.length / 5)) : 1;
        score += hallucinationScore * 0.2;
        total += 0.2;

        return Math.min(1, score / total);
    }

    /**
     * Apply corrections to data
     */
    async applyCorrections(inputData, corrections) {
        const correctedData = { ...inputData };

        for (const correction of corrections) {
            const { field, suggestedValue } = correction;
            correctedData[field] = suggestedValue;
            correctedData[`${field}_corrected`] = true;
        }

        return correctedData;
    }

    /**
     * Handle validation failure with escalation
     */
    async handleValidationFailure(inputData, validationResult, requestId, context) {
        const retryCount = this.retryCounter.get(requestId) || 0;
        
        if (retryCount < HALLUCINATION_CONFIG.maxRetryIterations) {
            this.retryCounter.set(requestId, retryCount + 1);
            
            // Try to fix common issues
            const correctedData = await this.autoCorrectData(inputData, validationResult);
            
            this.emit('verification.auto_correct', {
                requestId,
                attempt: retryCount + 1,
                corrections: validationResult.errors
            });

            return await this.validateAgainstGroundTruth(correctedData, {
                ...context,
                requestId,
                isRetry: true,
                retryCount: retryCount + 1
            });
        }

        // Max retries exceeded - escalate
        return await this.escalateToHuman(
            inputData,
            validationResult,
            requestId,
            context
        );
    }

    /**
     * Auto-correct common data issues
     */
    async autoCorrectData(inputData, validationResult) {
        const corrected = { ...inputData };

        for (const error of validationResult.errors) {
            switch (error.field) {
                case 'price':
                    if (error.message.includes('positive')) {
                        corrected.price = Math.abs(inputData.price) || 0.01;
                    }
                    break;
                case 'stock':
                    if (error.message.includes('negative')) {
                        corrected.stock = Math.abs(inputData.stock) || 0;
                    }
                    break;
                case 'description':
                    if (error.message.includes('short')) {
                        corrected.description = inputData.description + ' (Auto-extended)';
                    }
                    break;
                default:
                    // No auto-correction available
                    break;
            }
        }

        return corrected;
    }

    /**
     * ESCALATE TO HUMAN - With automatic routing
     */
    async escalateToHuman(inputData, validationResult, requestId, context) {
        const escalation = {
            requestId,
            timestamp: new Date().toISOString(),
            inputData,
            validationResult,
            context,
            retryCount: this.retryCounter.get(requestId) || 0,
            priority: this.calculatePriority(validationResult),
            status: 'pending',
            assignedTo: null,
            createdAt: new Date().toISOString()
        };

        // Add to escalation queue
        this.escalationQueue.push(escalation);

        // Determine routing based on priority
        const route = this.determineRouting(escalation);
        
        // Log escalation
        await this.logEscalation(escalation, route);

        // Emit escalation event
        this.emit('verification.escalated', {
            ...escalation,
            route
        });

        // Clear retry counter
        this.retryCounter.delete(requestId);

        return {
            isValid: false,
            requestId,
            escalated: true,
            escalationId: escalation.requestId,
            priority: escalation.priority,
            route,
            message: 'Automated verification failed. Escalated to human support.',
            timestamp: new Date().toISOString(),
            retryCount: escalation.retryCount,
            maxRetriesReached: true
        };
    }

    /**
     * Calculate escalation priority
     */
    calculatePriority(validationResult) {
        if (!validationResult.isValid) {
            const criticalErrors = validationResult.errors?.filter(e => e.severity === 'critical') || [];
            const highErrors = validationResult.errors?.filter(e => e.severity === 'high') || [];

            if (criticalErrors.length > 0) return 1; // Highest priority
            if (highErrors.length > 2) return 2;
            if (highErrors.length > 0) return 3;
            return 4;
        }
        return 5; // Lowest priority
    }

    /**
     * Determine routing for escalation
     */
    determineRouting(escalation) {
        const priority = escalation.priority;
        const type = escalation.inputData.type || 'general';

        // Priority-based routing
        if (priority <= 1) {
            return {
                team: 'senior_support',
                responseTime: 5, // minutes
                urgency: 'critical',
                requiresManagerApproval: true
            };
        }

        if (priority <= 2) {
            return {
                team: 'support_specialist',
                responseTime: 15,
                urgency: 'high',
                requiresManagerApproval: false
            };
        }

        if (priority <= 3) {
            return {
                team: 'support_agent',
                responseTime: 30,
                urgency: 'medium',
                requiresManagerApproval: false
            };
        }

        // Type-based routing
        if (type === 'refund') {
            return {
                team: 'refund_specialist',
                responseTime: 60,
                urgency: 'low',
                requiresManagerApproval: false
            };
        }

        return {
            team: 'general_support',
            responseTime: 120,
            urgency: 'low',
            requiresManagerApproval: false
        };
    }

    /**
     * Log verification result
     */
    async logVerificationResult(inputData, result, context) {
        try {
            const logEntry = {
                requestId: result.requestId,
                inputHash: crypto.createHash('sha256').update(JSON.stringify(inputData)).digest('hex'),
                isValid: result.isValid,
                confidence: result.confidence,
                retryCount: result.retryCount,
                escalated: result.escalated || false,
                processingTime: result.processingTime,
                validationErrors: result.schemaValidation?.errors || [],
                truthErrors: result.truthVerification?.errors || [],
                hallucinationFlags: result.hallucinationCheck?.flags || [],
                timestamp: new Date().toISOString()
            };

            this.detectionLogs.push(logEntry);

            await db.query(
                `INSERT INTO hallucination_detection_logs 
                 (request_id, input_hash, is_valid, confidence, retry_count, 
                  escalated, processing_time, validation_errors, truth_errors, 
                  hallucination_flags, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    logEntry.requestId,
                    logEntry.inputHash,
                    logEntry.isValid ? 1 : 0,
                    logEntry.confidence,
                    logEntry.retryCount,
                    logEntry.escalated ? 1 : 0,
                    logEntry.processingTime,
                    JSON.stringify(logEntry.validationErrors),
                    JSON.stringify(logEntry.truthErrors),
                    JSON.stringify(logEntry.hallucinationFlags)
                ]
            );

        } catch (error) {
            console.error('Log verification result error:', error);
        }
    }

    /**
     * Log escalation
     */
    async logEscalation(escalation, route) {
        try {
            await db.query(
                `INSERT INTO escalation_queue 
                 (request_id, input_data, validation_result, priority, route, 
                  status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    escalation.requestId,
                    JSON.stringify(escalation.inputData),
                    JSON.stringify(escalation.validationResult),
                    escalation.priority,
                    JSON.stringify(route),
                    escalation.status
                ]
            );

            console.log(`🚨 Escalation logged: ${escalation.requestId} - Priority ${escalation.priority}`);
            console.log(`📋 Assigned to: ${route.team} - Response within ${route.responseTime} minutes`);

        } catch (error) {
            console.error('Log escalation error:', error);
        }
    }

    /**
     * Get pending escalations
     */
    async getPendingEscalations() {
        return this.escalationQueue.filter(e => e.status === 'pending');
    }

    /**
     * Resolve escalation
     */
    async resolveEscalation(requestId, resolution) {
        const escalation = this.escalationQueue.find(e => e.requestId === requestId);
        if (!escalation) {
            throw new Error('Escalation not found');
        }

        escalation.status = 'resolved';
        escalation.resolvedAt = new Date().toISOString();
        escalation.resolution = resolution;

        await db.query(
            `UPDATE escalation_queue 
             SET status = ?, resolved_at = NOW(), resolution = ?
             WHERE request_id = ?`,
            ['resolved', JSON.stringify(resolution), requestId]
        );

        this.emit('escalation.resolved', escalation);
        return escalation;
    }

    /**
     * Validate product data (legacy compatibility)
     */
    async validateProductData(productData, source = DATA_SOURCES.AI_GENERATED) {
        const validation = {
            isValid: true,
            confidence: 0,
            flags: [],
            warnings: [],
            suggestedCorrections: [],
            timestamp: new Date().toISOString(),
            source,
            productId: productData.id || productData.name
        };

        // Use new ground truth validation
        const result = await this.validateAgainstGroundTruth(productData, {
            source,
            type: 'product'
        });

        validation.isValid = result.isValid;
        validation.confidence = result.confidence;
        validation.flags = result.hallucinationCheck?.flags || 
                           result.schemaValidation?.errors || 
                           result.truthVerification?.errors || [];
        validation.suggestedCorrections = result.truthVerification?.corrections || [];
        
        if (result.escalated) {
            validation.warnings.push('Escalated to human support');
        }

        // Log validation
        await this.logValidation(productData, validation);

        // Generate alert if hallucination detected
        if (!validation.isValid || validation.confidence < 0.5) {
            await this.createHallucinationAlert(productData, validation);
        }

        return validation;
    }

    /**
     * Validate price against market data
     */
    async validatePrice(productData) {
        const flags = [];
        let confidence = 0;
        const corrections = [];

        if (!productData.price) {
            flags.push({
                field: 'price',
                severity: 'critical',
                message: 'Price is missing',
                suggestion: 'Price is required'
            });
            confidence += 0.2;
            return { flags, confidence, corrections };
        }

        const price = parseFloat(productData.price);
        
        if (price <= 0) {
            flags.push({
                field: 'price',
                severity: 'critical',
                message: `Price (${price}) is invalid - must be positive`,
                suggestion: 'Enter a valid positive price'
            });
            confidence += 0.2;
        }

        const category = productData.category || 'general';
        const market = await this.getMarketData(category);
        
        if (market) {
            const deviation = Math.abs(price - market.averagePrice) / market.averagePrice;
            
            if (deviation > HALLUCINATION_CONFIG.priceDeviationThreshold) {
                flags.push({
                    field: 'price',
                    severity: 'high',
                    message: `Price (${price}) deviates ${(deviation * 100).toFixed(0)}% from market average (${market.averagePrice})`,
                    suggestion: `Consider pricing around ${market.averagePrice}`
                });
                corrections.push({
                    field: 'price',
                    suggestedValue: market.averagePrice,
                    reason: 'Market average'
                });
                confidence += 0.4;
            } else {
                confidence += 0.8;
            }
        }

        if (productData.originalPrice) {
            const discount = 1 - (price / parseFloat(productData.originalPrice));
            if (discount > 0.9) {
                flags.push({
                    field: 'discount',
                    severity: 'critical',
                    message: `Discount (${(discount * 100).toFixed(0)}%) is unrealistically high`,
                    suggestion: 'Discount should not exceed 90%'
                });
                confidence += 0.2;
            }
        }

        return { flags, confidence: Math.min(1, confidence), corrections };
    }

    /**
     * Validate stock information
     */
    async validateStock(productData) {
        const flags = [];
        let confidence = 0;

        if (!productData.stock && productData.stock !== 0) {
            flags.push({
                field: 'stock',
                severity: 'medium',
                message: 'Stock information is missing',
                suggestion: 'Provide stock quantity'
            });
            confidence += 0.3;
            return { flags, confidence };
        }

        const stock = parseInt(productData.stock);

        if (stock > 10000) {
            flags.push({
                field: 'stock',
                severity: 'high',
                message: `Stock (${stock}) seems unrealistically high`,
                suggestion: 'Verify stock quantity'
            });
            confidence += 0.4;
        } else if (stock < 0) {
            flags.push({
                field: 'stock',
                severity: 'critical',
                message: `Stock (${stock}) cannot be negative`,
                suggestion: 'Enter a valid positive stock quantity'
            });
            confidence += 0.2;
        } else {
            confidence += 0.8;
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Validate product description
     */
    validateDescription(productData) {
        const flags = [];
        let confidence = 0;

        if (!productData.description) {
            flags.push({
                field: 'description',
                severity: 'medium',
                message: 'Description is missing',
                suggestion: 'Provide a product description'
            });
            confidence += 0.3;
            return { flags, confidence };
        }

        const desc = productData.description;

        if (desc.length < 10) {
            flags.push({
                field: 'description',
                severity: 'high',
                message: 'Description is too short',
                suggestion: 'Provide more detailed description'
            });
            confidence += 0.4;
        } else if (desc.length > 5000) {
            flags.push({
                field: 'description',
                severity: 'medium',
                message: 'Description is unusually long',
                suggestion: 'Keep description concise'
            });
            confidence += 0.5;
        } else {
            confidence += 0.8;
        }

        const suspiciousKeywords = ['best', 'perfect', 'amazing', 'unbelievable', 'incredible'];
        let suspiciousCount = 0;
        for (const keyword of suspiciousKeywords) {
            if (desc.toLowerCase().includes(keyword)) {
                suspiciousCount++;
            }
        }

        if (suspiciousCount > 5) {
            flags.push({
                field: 'description',
                severity: 'medium',
                message: 'Description contains excessive promotional language',
                suggestion: 'Use more factual and specific language'
            });
            confidence += 0.5;
        }

        const hallucinationIndicators = ['guaranteed', '100%', 'free', 'unlimited', 'best ever'];
        let indicatorCount = 0;
        for (const indicator of hallucinationIndicators) {
            if (desc.toLowerCase().includes(indicator)) {
                indicatorCount++;
            }
        }

        if (indicatorCount > 3) {
            flags.push({
                field: 'description',
                severity: 'high',
                message: 'Description contains multiple claims that may be hallucinations',
                suggestion: 'Verify and substantiate all claims'
            });
            confidence += 0.3;
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Validate category consistency
     */
    async validateCategory(productData) {
        const flags = [];
        let confidence = 0;

        if (!productData.category) {
            flags.push({
                field: 'category',
                severity: 'medium',
                message: 'Category is missing',
                suggestion: 'Select a valid category'
            });
            confidence += 0.3;
            return { flags, confidence };
        }

        const validCategories = await this.getValidCategories();
        if (!validCategories.includes(productData.category)) {
            flags.push({
                field: 'category',
                severity: 'high',
                message: `Category "${productData.category}" is not recognized`,
                suggestion: `Select from: ${validCategories.join(', ')}`
            });
            confidence += 0.4;
        } else {
            confidence += 0.8;
        }

        const categoryPriceRange = await this.getCategoryPriceRange(productData.category);
        if (categoryPriceRange && productData.price) {
            const price = parseFloat(productData.price);
            if (price < categoryPriceRange.min * 0.2 || price > categoryPriceRange.max * 2) {
                flags.push({
                    field: 'price',
                    severity: 'high',
                    message: `Price (${price}) is outside typical range for category "${productData.category}"`,
                    suggestion: `Typical range: ${categoryPriceRange.min} - ${categoryPriceRange.max}`
                });
                confidence += 0.5;
            }
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Validate specifications
     */
    validateSpecifications(productData) {
        const flags = [];
        let confidence = 0;

        if (!productData.specifications || productData.specifications.length === 0) {
            flags.push({
                field: 'specifications',
                severity: 'low',
                message: 'No specifications provided',
                suggestion: 'Add product specifications'
            });
            confidence += 0.5;
            return { flags, confidence };
        }

        const specs = productData.specifications;
        const suspiciousSpecs = [];

        for (const spec of specs) {
            if (this.isSuspiciousSpec(spec)) {
                suspiciousSpecs.push(spec);
            }
        }

        if (suspiciousSpecs.length > 0) {
            flags.push({
                field: 'specifications',
                severity: 'high',
                message: `Suspicious specifications detected: ${suspiciousSpecs.map(s => s.name).join(', ')}`,
                suggestion: 'Verify these specifications'
            });
            confidence += 0.3;
        }

        if (productData.category) {
            const expectedSpecs = this.getCategorySpecs(productData.category);
            const missingSpecs = expectedSpecs.filter(es => 
                !specs.some(s => s.name.toLowerCase() === es.toLowerCase())
            );

            if (missingSpecs.length > 0) {
                flags.push({
                    field: 'specifications',
                    severity: 'medium',
                    message: `Missing expected specifications: ${missingSpecs.join(', ')}`,
                    suggestion: `Add: ${missingSpecs.join(', ')}`
                });
                confidence += 0.5;
            }
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Detect suspicious patterns in data
     */
    detectSuspiciousPatterns(productData) {
        const flags = [];
        let confidence = 0;
        const text = JSON.stringify(productData).toLowerCase();

        for (const pattern of HALLUCINATION_CONFIG.suspiciousPatterns) {
            if (pattern.test(text)) {
                flags.push({
                    field: 'general',
                    severity: 'medium',
                    message: `Suspicious pattern detected: ${pattern}`,
                    suggestion: 'Review content for accuracy'
                });
                confidence += 0.1;
            }
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Check if a specification is suspicious
     */
    isSuspiciousSpec(spec) {
        const suspiciousValues = [
            /9999/,
            /unlimited/i,
            /infinite/i,
            /zero/i,
            /negative/i,
            /impossible/i
        ];

        const text = `${spec.name} ${spec.value}`.toLowerCase();
        return suspiciousValues.some(pattern => pattern.test(text));
    }

    /**
     * Get market data for a category
     */
    async getMarketData(category) {
        if (this.marketData.has(category)) {
            return this.marketData.get(category);
        }

        try {
            const [data] = await db.query(
                `SELECT 
                    AVG(price) as averagePrice,
                    MIN(price) as minPrice,
                    MAX(price) as maxPrice,
                    COUNT(*) as productCount
                 FROM products 
                 WHERE category = ? AND price > 0 AND verified = 1`,
                [category]
            );

            if (data && data.productCount > 0) {
                const marketData = {
                    averagePrice: parseFloat(data.averagePrice),
                    minPrice: parseFloat(data.minPrice),
                    maxPrice: parseFloat(data.maxPrice),
                    productCount: data.productCount
                };
                this.marketData.set(category, marketData);
                return marketData;
            }
        } catch (error) {
            console.error('Get market data error:', error);
        }

        return null;
    }

    /**
     * Get valid categories
     */
    async getValidCategories() {
        try {
            const [rows] = await db.query(
                'SELECT DISTINCT category FROM products WHERE verified = 1'
            );
            return rows.map(r => r.category);
        } catch (error) {
            console.error('Get valid categories error:', error);
            return ['Electronics', 'Fashion', 'Home', 'Beauty', 'Books'];
        }
    }

    /**
     * Get category price range
     */
    async getCategoryPriceRange(category) {
        const data = await this.getMarketData(category);
        if (data) {
            return { min: data.minPrice, max: data.maxPrice };
        }
        return null;
    }

    /**
     * Get category specifications
     */
    getCategorySpecs(category) {
        const categorySpecs = {
            'Electronics': ['Brand', 'Model', 'Weight', 'Dimensions', 'Color', 'Battery'],
            'Fashion': ['Brand', 'Size', 'Material', 'Color', 'Style', 'Fabric'],
            'Home': ['Brand', 'Material', 'Dimensions', 'Weight', 'Color', 'Assembly'],
            'Beauty': ['Brand', 'Type', 'Ingredients', 'Volume', 'Skin Type', 'Expiry'],
            'Books': ['Author', 'ISBN', 'Pages', 'Publisher', 'Year', 'Language']
        };
        return categorySpecs[category] || [];
    }

    /**
     * Load verified data
     */
    async loadVerifiedData() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM products WHERE verified = 1 AND price > 0'
            );

            for (const row of rows) {
                this.productProfiles.set(row.id, row);
                this.marketData.set(row.category, {
                    averagePrice: parseFloat(row.price),
                    minPrice: parseFloat(row.price),
                    maxPrice: parseFloat(row.price),
                    productCount: 1
                });
            }

            console.log(`📊 Loaded ${rows.length} verified products`);
        } catch (error) {
            console.error('Load verified data error:', error);
        }
    }

    /**
     * Load market data
     */
    async loadMarketData() {
        try {
            const [rows] = await db.query(
                `SELECT 
                    category,
                    AVG(price) as avgPrice,
                    MIN(price) as minPrice,
                    MAX(price) as maxPrice,
                    COUNT(*) as count
                 FROM products 
                 WHERE verified = 1 AND price > 0
                 GROUP BY category`
            );

            for (const row of rows) {
                this.marketData.set(row.category, {
                    averagePrice: parseFloat(row.avgPrice),
                    minPrice: parseFloat(row.minPrice),
                    maxPrice: parseFloat(row.maxPrice),
                    productCount: row.count
                });
            }

            console.log(`📊 Loaded market data for ${rows.length} categories`);
        } catch (error) {
            console.error('Load market data error:', error);
        }
    }

    /**
     * Log validation
     */
    async logValidation(productData, validation) {
        try {
            await db.query(
                `INSERT INTO hallucination_detection_logs 
                 (product_id, confidence, flags, warnings, suggestions, source, validation_result, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    productData.id || productData.name,
                    validation.confidence,
                    JSON.stringify(validation.flags),
                    JSON.stringify(validation.warnings),
                    JSON.stringify(validation.suggestedCorrections),
                    validation.source,
                    validation.isValid ? 'pass' : 'fail'
                ]
            );
        } catch (error) {
            console.error('Log validation error:', error);
        }
    }

    /**
     * Create hallucination alert
     */
    async createHallucinationAlert(productData, validation) {
        const alert = {
            id: `HALL_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            productId: productData.id || productData.name,
            confidence: validation.confidence,
            flags: validation.flags,
            timestamp: new Date().toISOString(),
            resolved: false
        };

        this.hallucinationAlerts.push(alert);
        this.emit('hallucination.detected', alert);

        if (validation.confidence < 0.3) {
            console.error(`🚨 CRITICAL: Hallucination detected for ${alert.productId}`);
            console.error(`Confidence: ${validation.confidence}`);
            console.error('Flags:', validation.flags);
        }

        return alert;
    }

    /**
     * Get hallucinations
     */
    getHallucinations(limit = 50) {
        return this.hallucinationAlerts.slice(-limit);
    }

    /**
     * Resolve hallucination alert
     */
    async resolveHallucination(alertId, resolution) {
        const alert = this.hallucinationAlerts.find(a => a.id === alertId);
        if (!alert) {
            throw new Error('Alert not found');
        }

        alert.resolved = true;
        alert.resolvedAt = new Date().toISOString();
        alert.resolution = resolution;

        await this.updateAlert(alert);
        return alert;
    }

    /**
     * Update alert in database
     */
    async updateAlert(alert) {
        try {
            await db.query(
                `UPDATE hallucination_detection_logs 
                 SET resolved = 1, resolved_at = NOW(), resolution = ?
                 WHERE id = ?`,
                [alert.resolution, alert.id]
            );
        } catch (error) {
            console.error('Update alert error:', error);
        }
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        return {
            validatedProducts: this.productProfiles.size,
            marketCategories: this.marketData.size,
            hallucinationAlerts: this.hallucinationAlerts.length,
            pendingAlerts: this.hallucinationAlerts.filter(a => !a.resolved).length,
            detectionLogs: this.detectionLogs.length,
            pendingEscalations: this.escalationQueue.filter(e => e.status === 'pending').length,
            retryCounts: Array.from(this.retryCounter.entries()),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            validatedProducts: this.productProfiles.size,
            marketCategories: this.marketData.size,
            alerts: this.hallucinationAlerts.length,
            pendingAlerts: this.hallucinationAlerts.filter(a => !a.resolved).length,
            pendingEscalations: this.escalationQueue.filter(e => e.status === 'pending').length,
            maxRetryIterations: HALLUCINATION_CONFIG.maxRetryIterations,
            dbTruthCacheSize: this.dbTruthCache.size
        };
    }

    resetRetryCounters() {
        this.retryCounter.clear();
    }

    clearEscalationQueue() {
        this.escalationQueue = [];
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    HallucinationDetectionService,
    DATA_SOURCES,
    HALLUCINATION_CONFIG,
    GroundTruthSchema,
    RefundEligibilitySchema,
    hallucinationDetectionService: new HallucinationDetectionService()
};