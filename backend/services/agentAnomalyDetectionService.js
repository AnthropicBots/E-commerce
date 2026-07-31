// backend/services/agentAnomalyDetectionService.js

const db = require('../config/db').promise;
const crypto = require('crypto');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION
// ============================================

const ANOMALY_CONFIG = {
    // Behavioral baselining
    baselineWindow: 30, // days
    anomalyThreshold: 0.75, // 75% deviation triggers alert
    
    // Transaction limits
    maxTransactionAmount: 50000,
    maxTransactionsPerHour: 10,
    maxTransactionsPerDay: 50,
    
    // Agent permissions
    defaultPermissions: ['view', 'search'],
    elevatedPermissions: ['purchase', 'modify', 'delete'],
    
    // Conversation patterns
    maxConversationLength: 1000,
    suspiciousPatterns: [
        /urgent|immediate|asap/i,
        /bypass|override|ignore/i,
        /free|unlimited|unrestricted/i,
        /admin|ceo|founder|executive/i,
        /hack|exploit|vulnerability/i
    ],
    
    // Cache configuration
    cacheTTL: 3600, // 1 hour
    cacheCheckPeriod: 600, // 10 minutes
    
    // Rate limiting
    rateLimitWindow: 60000, // 1 minute
    rateLimitMax: 100, // 100 requests per minute
    
    // ML Detection
    mlEnabled: true,
    mlConfidenceThreshold: 0.7,
    
    // Webhook alerts
    webhookUrl: process.env.WEBHOOK_ALERT_URL || null,
    webhookRetries: 3,
    webhookTimeout: 5000,
};

// Initialize cache
const baselineCache = new NodeCache({
    stdTTL: ANOMALY_CONFIG.cacheTTL,
    checkperiod: ANOMALY_CONFIG.cacheCheckPeriod,
});

// ============================================
// AGENT ANOMALY DETECTION CLASS
// ============================================

class AgentAnomalyDetection {
    constructor() {
        this.agentBaselines = new Map();
        this.agentSessions = new Map();
        this.anomalyAlerts = [];
        this.conversationPatterns = new Map();
        this.isInitialized = false;
        this.mlModels = new Map();
    }

    /**
     * Initialize the service
     */
    async initialize() {
        if (this.isInitialized) return;
        
        try {
            // Load ML models if enabled
            if (ANOMALY_CONFIG.mlEnabled) {
                await this.loadMLModels();
            }
            
            // Load existing baselines from cache
            const cachedBaselines = baselineCache.get('agentBaselines');
            if (cachedBaselines) {
                this.agentBaselines = new Map(cachedBaselines);
            }
            
            this.isInitialized = true;
            console.log('AgentAnomalyDetection initialized successfully');
        } catch (error) {
            console.error('Failed to initialize AgentAnomalyDetection:', error);
            // Graceful degradation - continue without ML
            this.isInitialized = true;
        }
    }

    /**
     * Load ML models for anomaly detection
     */
    async loadMLModels() {
        try {
            // In production, load actual ML models
            // This is a placeholder for ML integration
            console.log('Loading ML models for anomaly detection...');
            
            // Simulate model loading
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            this.mlModels.set('isolationForest', {
                type: 'isolation_forest',
                version: '1.0.0',
                loadedAt: new Date().toISOString()
            });
            
            this.mlModels.set('autoencoder', {
                type: 'autoencoder',
                version: '1.0.0',
                loadedAt: new Date().toISOString()
            });
            
            console.log('ML models loaded successfully');
        } catch (error) {
            console.error('Failed to load ML models:', error);
            throw error;
        }
    }

    /**
     * Validate agent ID
     */
    validateAgentId(agentId) {
        if (!agentId || typeof agentId !== 'string') {
            throw new Error('Invalid agent ID: must be a non-empty string');
        }
        
        if (agentId.length > 255) {
            throw new Error('Agent ID exceeds maximum length of 255 characters');
        }
        
        // Check for SQL injection patterns
        const sqlInjectionPatterns = /['";]|(--)/;
        if (sqlInjectionPatterns.test(agentId)) {
            throw new Error('Invalid agent ID: contains suspicious characters');
        }
        
        return true;
    }

    /**
     * Get rate limiter for agent
     */
    getRateLimiter(agentId) {
        return rateLimit({
            windowMs: ANOMALY_CONFIG.rateLimitWindow,
            max: ANOMALY_CONFIG.rateLimitMax,
            keyGenerator: (req) => `agent_${agentId}`,
            handler: (req, res) => {
                throw new Error(`Rate limit exceeded for agent ${agentId}`);
            }
        });
    }

    /**
     * Initialize agent baseline with validation
     */
    async initializeBaseline(agentId, userId) {
        try {
            // Validate inputs
            this.validateAgentId(agentId);
            
            if (!userId || typeof userId !== 'string') {
                throw new Error('Invalid user ID: must be a non-empty string');
            }

            // Check cache first
            const cacheKey = `baseline_${agentId}`;
            const cachedBaseline = baselineCache.get(cacheKey);
            if (cachedBaseline) {
                this.agentBaselines.set(agentId, cachedBaseline);
                return cachedBaseline;
            }

            // Get historical agent behavior
            const [history] = await db.query(
                `SELECT 
                    COUNT(*) as total_actions,
                    AVG(transaction_amount) as avg_amount,
                    COUNT(DISTINCT merchant_id) as merchant_count,
                    AVG(conversation_length) as avg_conversation_length,
                    AVG(action_duration) as avg_action_duration
                 FROM agent_activity_logs 
                 WHERE agent_id = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [agentId, ANOMALY_CONFIG.baselineWindow]
            );

            const baseline = {
                agentId,
                userId,
                establishedAt: new Date().toISOString(),
                totalActions: parseInt(history[0]?.total_actions) || 0,
                avgTransactionAmount: parseFloat(history[0]?.avg_amount) || 0,
                merchantCount: parseInt(history[0]?.merchant_count) || 0,
                avgConversationLength: parseInt(history[0]?.avg_conversation_length) || 0,
                avgActionDuration: parseInt(history[0]?.avg_action_duration) || 0,
                permissions: ANOMALY_CONFIG.defaultPermissions
            };

            // Store in memory
            this.agentBaselines.set(agentId, baseline);
            
            // Store in cache
            baselineCache.set(cacheKey, baseline);
            
            // Store in database
            await this.storeBaseline(agentId, baseline);
            
            return baseline;
        } catch (error) {
            console.error('Baseline initialization error:', error);
            throw error;
        }
    }

    /**
     * Detect anomalies with ML integration and async/await handling
     */
    async detectAnomalies(agentId, action, data) {
        try {
            // Validate inputs
            this.validateAgentId(agentId);
            
            if (!action || typeof action !== 'string') {
                throw new Error('Invalid action: must be a non-empty string');
            }

            // Check rate limit
            await this.checkRateLimit(agentId);

            // Get baseline with graceful degradation
            let baseline = this.agentBaselines.get(agentId);
            if (!baseline) {
                // Try to load from cache
                const cacheKey = `baseline_${agentId}`;
                const cachedBaseline = baselineCache.get(cacheKey);
                if (cachedBaseline) {
                    baseline = cachedBaseline;
                    this.agentBaselines.set(agentId, baseline);
                } else {
                    // Graceful degradation - create default baseline
                    baseline = this.createDefaultBaseline(agentId);
                    console.warn(`No baseline found for agent ${agentId}, using default`);
                }
            }

            const anomalies = {
                isAnomalous: false,
                flags: [],
                riskScore: 0,
                confidence: 0,
                details: {},
                mlDetection: null
            };

            // 1. ML-based detection (if enabled)
            if (ANOMALY_CONFIG.mlEnabled && this.mlModels.size > 0) {
                const mlResult = await this.mlDetectAnomalies(agentId, action, data, baseline);
                if (mlResult.isAnomalous) {
                    anomalies.flags.push(mlResult);
                    anomalies.riskScore += 35;
                }
                anomalies.mlDetection = mlResult;
            }

            // 2. Check transaction amount anomaly
            if (data.transactionAmount) {
                const amountAnomaly = this.checkAmountAnomaly(
                    data.transactionAmount,
                    baseline.avgTransactionAmount
                );
                if (amountAnomaly.isAnomalous) {
                    anomalies.flags.push(amountAnomaly);
                    anomalies.riskScore += 30;
                }
            }

            // 3. Check frequency anomaly
            const frequencyAnomaly = await this.checkFrequencyAnomaly(agentId);
            if (frequencyAnomaly.isAnomalous) {
                anomalies.flags.push(frequencyAnomaly);
                anomalies.riskScore += 25;
            }

            // 4. Check permission violation
            if (action === 'purchase' || action === 'delete' || action === 'modify') {
                if (!baseline.permissions.includes(action)) {
                    anomalies.flags.push({
                        type: 'permission_violation',
                        severity: 'critical',
                        details: `Agent attempted ${action} without permission`
                    });
                    anomalies.riskScore += 40;
                }
            }

            // 5. Check merchant access anomaly
            if (data.merchantId) {
                const merchantAnomaly = await this.checkMerchantAccessAnomaly(
                    agentId,
                    data.merchantId,
                    baseline.merchantCount
                );
                if (merchantAnomaly.isAnomalous) {
                    anomalies.flags.push(merchantAnomaly);
                    anomalies.riskScore += 15;
                }
            }

            // 6. Check conversation pattern anomaly
            if (data.conversation) {
                const conversationAnomaly = this.checkConversationPattern(
                    data.conversation,
                    baseline.avgConversationLength
                );
                if (conversationAnomaly.isAnomalous) {
                    anomalies.flags.push(conversationAnomaly);
                    anomalies.riskScore += 20;
                }
            }

            // 7. Check action duration anomaly
            if (data.duration) {
                const durationAnomaly = this.checkDurationAnomaly(
                    data.duration,
                    baseline.avgActionDuration
                );
                if (durationAnomaly.isAnomalous) {
                    anomalies.flags.push(durationAnomaly);
                    anomalies.riskScore += 10;
                }
            }

            // Calculate final risk
            anomalies.riskScore = Math.min(100, anomalies.riskScore);
            anomalies.isAnomalous = anomalies.riskScore > 50;
            anomalies.confidence = this.calculateConfidence(anomalies.flags);
            anomalies.details = {
                agentId,
                action,
                timestamp: new Date().toISOString(),
                baselineReference: {
                    avgAmount: baseline.avgTransactionAmount,
                    merchantCount: baseline.merchantCount,
                    avgConversationLength: baseline.avgConversationLength
                }
            };

            // Log anomaly if detected
            if (anomalies.isAnomalous) {
                await this.logAnomaly(agentId, anomalies);
                
                // Send webhook alert for critical anomalies
                if (anomalies.riskScore > 75) {
                    await this.sendWebhookAlert(agentId, anomalies);
                }
                
                // Real-time monitoring update
                await this.updateRealTimeMonitoring(agentId, anomalies);
            }

            return anomalies;
        } catch (error) {
            console.error('Anomaly detection error:', error);
            // Graceful degradation - return safe default
            return {
                isAnomalous: false,
                flags: [],
                riskScore: 0,
                confidence: 0,
                details: {
                    error: error.message,
                    agentId,
                    action,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }

    /**
     * ML-based anomaly detection
     */
    async mlDetectAnomalies(agentId, action, data, baseline) {
        try {
            // Prepare features for ML detection
            const features = {
                actionFrequency: await this.getActionFrequency(agentId),
                avgTransactionAmount: baseline.avgTransactionAmount,
                currentAmount: data.transactionAmount || 0,
                conversationLength: data.conversation?.length || 0,
                actionDuration: data.duration || 0,
                merchantCount: baseline.merchantCount,
                permissionsCount: baseline.permissions.length
            };

            // Simulate ML prediction
            // In production, call actual ML model
            const mlScore = this.simulateMLPrediction(features);
            
            return {
                type: 'ml_detection',
                severity: mlScore > 0.8 ? 'high' : mlScore > 0.6 ? 'medium' : 'low',
                details: `ML model detected anomaly with score ${mlScore.toFixed(2)}`,
                mlScore,
                confidence: mlScore,
                isAnomalous: mlScore > ANOMALY_CONFIG.mlConfidenceThreshold,
                features
            };
        } catch (error) {
            console.error('ML detection error:', error);
            return {
                type: 'ml_detection',
                severity: 'low',
                details: 'ML detection failed',
                mlScore: 0,
                confidence: 0,
                isAnomalous: false
            };
        }
    }

    /**
     * Simulate ML prediction (placeholder)
     */
    simulateMLPrediction(features) {
        // Simple anomaly score simulation
        let score = 0;
        
        if (features.currentAmount > features.avgTransactionAmount * 2) score += 0.3;
        if (features.actionFrequency > 10) score += 0.2;
        if (features.conversationLength > 500) score += 0.2;
        if (features.actionDuration < 100) score += 0.15;
        if (features.permissionsCount > 5) score += 0.15;
        
        return Math.min(1, score + Math.random() * 0.1);
    }

    /**
     * Get action frequency for agent
     */
    async getActionFrequency(agentId) {
        try {
            const [result] = await db.query(
                'SELECT COUNT(*) as count FROM agent_activity_logs WHERE agent_id = ? AND timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
                [agentId]
            );
            return result[0]?.count || 0;
        } catch (error) {
            console.error('Get action frequency error:', error);
            return 0;
        }
    }

    /**
     * Check rate limit for agent
     */
    async checkRateLimit(agentId) {
        const key = `rate_limit_${agentId}`;
        const now = Date.now();
        const windowStart = now - ANOMALY_CONFIG.rateLimitWindow;
        
        // Get current count
        let count = this.agentSessions.get(key) || 0;
        
        // Reset if window expired
        if (count === 0) {
            this.agentSessions.set(key, 1);
            // Clean up after window
            setTimeout(() => {
                this.agentSessions.delete(key);
            }, ANOMALY_CONFIG.rateLimitWindow);
        } else if (count >= ANOMALY_CONFIG.rateLimitMax) {
            throw new Error(`Rate limit exceeded for agent ${agentId}`);
        } else {
            this.agentSessions.set(key, count + 1);
        }
    }

    /**
     * Create default baseline for graceful degradation
     */
    createDefaultBaseline(agentId) {
        return {
            agentId,
            userId: 'unknown',
            establishedAt: new Date().toISOString(),
            totalActions: 0,
            avgTransactionAmount: 1000,
            merchantCount: 5,
            avgConversationLength: 100,
            avgActionDuration: 5000,
            permissions: ['view', 'search']
        };
    }

    /**
     * Check transaction amount anomaly
     */
    checkAmountAnomaly(amount, baselineAvg) {
        if (amount > ANOMALY_CONFIG.maxTransactionAmount) {
            return {
                type: 'amount_anomaly',
                severity: 'critical',
                details: `Transaction amount (${amount}) exceeds maximum limit (${ANOMALY_CONFIG.maxTransactionAmount})`,
                deviation: ((amount / ANOMALY_CONFIG.maxTransactionAmount) * 100).toFixed(0)
            };
        }
        
        const deviation = baselineAvg > 0 ? ((amount - baselineAvg) / baselineAvg) * 100 : 0;
        
        if (deviation > 100) {
            return {
                type: 'amount_anomaly',
                severity: 'high',
                details: `Transaction amount (${amount}) is ${deviation.toFixed(0)}% above baseline (${baselineAvg})`,
                deviation
            };
        }
        return { isAnomalous: false };
    }

    /**
     * Check frequency anomaly
     */
    async checkFrequencyAnomaly(agentId) {
        try {
            const now = new Date();
            const oneHourAgo = new Date(now - 3600000);
            const oneDayAgo = new Date(now - 86400000);

            const [hourlyCount] = await db.query(
                'SELECT COUNT(*) as count FROM agent_activity_logs WHERE agent_id = ? AND timestamp > ?',
                [agentId, oneHourAgo]
            );

            const [dailyCount] = await db.query(
                'SELECT COUNT(*) as count FROM agent_activity_logs WHERE agent_id = ? AND timestamp > ?',
                [agentId, oneDayAgo]
            );

            if (hourlyCount[0].count > ANOMALY_CONFIG.maxTransactionsPerHour) {
                return {
                    type: 'frequency_anomaly',
                    severity: 'high',
                    details: `${hourlyCount[0].count} actions in the last hour (limit: ${ANOMALY_CONFIG.maxTransactionsPerHour})`,
                    count: hourlyCount[0].count,
                    limit: ANOMALY_CONFIG.maxTransactionsPerHour
                };
            }

            if (dailyCount[0].count > ANOMALY_CONFIG.maxTransactionsPerDay) {
                return {
                    type: 'frequency_anomaly',
                    severity: 'medium',
                    details: `${dailyCount[0].count} actions in the last day (limit: ${ANOMALY_CONFIG.maxTransactionsPerDay})`,
                    count: dailyCount[0].count,
                    limit: ANOMALY_CONFIG.maxTransactionsPerDay
                };
            }

            return { isAnomalous: false };
        } catch (error) {
            console.error('Frequency check error:', error);
            return { isAnomalous: false };
        }
    }

    /**
     * Check merchant access anomaly
     */
    async checkMerchantAccessAnomaly(agentId, merchantId, baselineCount) {
        try {
            const [accessCount] = await db.query(
                'SELECT COUNT(*) as count FROM agent_merchant_access WHERE agent_id = ?',
                [agentId]
            );

            const totalMerchants = accessCount[0].count || 0;
            
            if (totalMerchants > baselineCount * 3 && baselineCount > 0) {
                return {
                    type: 'merchant_access_anomaly',
                    severity: 'medium',
                    details: `Agent accessed ${totalMerchants} merchants (baseline: ${baselineCount})`,
                    totalMerchants,
                    baselineCount
                };
            }

            return { isAnomalous: false };
        } catch (error) {
            console.error('Merchant access check error:', error);
            return { isAnomalous: false };
        }
    }

    /**
     * Check conversation pattern anomaly
     */
    checkConversationPattern(conversation, baselineLength) {
        const issues = [];
        
        // Check length
        if (conversation.length > baselineLength * 3 && baselineLength > 0) {
            issues.push({
                type: 'conversation_length_anomaly',
                severity: 'medium',
                details: `Conversation length (${conversation.length}) is 3x baseline (${baselineLength})`
            });
        }

        // Check for suspicious patterns
        for (const pattern of ANOMALY_CONFIG.suspiciousPatterns) {
            if (pattern.test(conversation)) {
                issues.push({
                    type: 'suspicious_pattern',
                    severity: 'high',
                    details: `Found suspicious pattern: ${pattern}`
                });
                break;
            }
        }

        if (issues.length > 0) {
            return {
                isAnomalous: true,
                type: 'conversation_anomaly',
                severity: issues.some(i => i.severity === 'high') ? 'high' : 'medium',
                details: issues.map(i => i.details).join('; '),
                issues
            };
        }

        return { isAnomalous: false };
    }

    /**
     * Check duration anomaly
     */
    checkDurationAnomaly(duration, baselineAvg) {
        if (baselineAvg > 0 && duration < baselineAvg * 0.25) {
            return {
                type: 'duration_anomaly',
                severity: 'low',
                details: `Action duration (${duration}ms) is 75% below baseline (${baselineAvg}ms)`,
                duration,
                baselineAvg
            };
        }
        return { isAnomalous: false };
    }

    /**
     * Calculate confidence score
     */
    calculateConfidence(flags) {
        if (flags.length === 0) return 0;
        
        const severityWeights = {
            critical: 3,
            high: 2,
            medium: 1.5,
            low: 1
        };

        const totalWeight = flags.reduce((sum, f) => 
            sum + (severityWeights[f.severity] || 1), 0
        );
        const maxWeight = flags.length * 3;
        
        return Math.min(100, (totalWeight / maxWeight) * 100);
    }

    /**
     * Enforce mandate scope
     */
    enforceMandateScope(agentId, action, data) {
        try {
            this.validateAgentId(agentId);
            
            const baseline = this.agentBaselines.get(agentId);
            if (!baseline) {
                // Graceful degradation
                console.warn(`No baseline found for agent ${agentId}, allowing action`);
                return {
                    allowed: true,
                    details: {
                        permission: ['view'],
                        limits: {
                            maxAmount: ANOMALY_CONFIG.maxTransactionAmount
                        },
                        warning: 'Using default permissions'
                    }
                };
            }

            // Check if agent has required permission
            const requiredPermissions = {
                'purchase': ['purchase'],
                'modify': ['modify', 'purchase'],
                'delete': ['delete', 'modify', 'purchase'],
                'view': ['view']
            };

            const required = requiredPermissions[action] || ['view'];
            const hasPermission = required.some(perm => baseline.permissions.includes(perm));

            if (!hasPermission) {
                return {
                    allowed: false,
                    reason: `Agent lacks required permission: ${required.join(', ')}`,
                    required,
                    current: baseline.permissions
                };
            }

            // Check transaction limits
            if (action === 'purchase' && data.amount) {
                if (data.amount > ANOMALY_CONFIG.maxTransactionAmount) {
                    return {
                        allowed: false,
                        reason: `Transaction amount (${data.amount}) exceeds limit (${ANOMALY_CONFIG.maxTransactionAmount})`
                    };
                }
            }

            return {
                allowed: true,
                details: {
                    permission: required,
                    limits: {
                        maxAmount: ANOMALY_CONFIG.maxTransactionAmount
                    }
                }
            };
        } catch (error) {
            console.error('Enforce mandate scope error:', error);
            return {
                allowed: false,
                reason: `Error enforcing mandate scope: ${error.message}`
            };
        }
    }

    /**
     * Grant permission to agent
     */
    async grantPermission(agentId, permission, grantedBy) {
        try {
            this.validateAgentId(agentId);
            
            const baseline = this.agentBaselines.get(agentId);
            if (!baseline) {
                throw new Error('Agent not found');
            }

            if (!baseline.permissions.includes(permission)) {
                baseline.permissions.push(permission);
                
                // Update cache
                const cacheKey = `baseline_${agentId}`;
                baselineCache.set(cacheKey, baseline);
                
                await db.query(
                    `INSERT INTO agent_permission_logs 
                     (agent_id, permission, granted_by, granted_at)
                     VALUES (?, ?, ?, NOW())`,
                    [agentId, permission, grantedBy]
                );
            }

            return baseline;
        } catch (error) {
            console.error('Grant permission error:', error);
            throw error;
        }
    }

    /**
     * Revoke permission from agent
     */
    async revokePermission(agentId, permission, revokedBy) {
        try {
            this.validateAgentId(agentId);
            
            const baseline = this.agentBaselines.get(agentId);
            if (!baseline) {
                throw new Error('Agent not found');
            }

            const index = baseline.permissions.indexOf(permission);
            if (index > -1) {
                baseline.permissions.splice(index, 1);
                
                // Update cache
                const cacheKey = `baseline_${agentId}`;
                baselineCache.set(cacheKey, baseline);
                
                await db.query(
                    `INSERT INTO agent_permission_logs 
                     (agent_id, permission, revoked_by, revoked_at)
                     VALUES (?, ?, ?, NOW())`,
                    [agentId, permission, revokedBy]
                );
            }

            return baseline;
        } catch (error) {
            console.error('Revoke permission error:', error);
            throw error;
        }
    }

    /**
     * Store baseline in database
     */
    async storeBaseline(agentId, baseline) {
        try {
            await db.query(
                `INSERT INTO agent_baselines 
                 (agent_id, user_id, established_at, total_actions, 
                  avg_transaction_amount, merchant_count, avg_conversation_length,
                  avg_action_duration, permissions)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 total_actions = ?, avg_transaction_amount = ?,
                 merchant_count = ?, avg_conversation_length = ?,
                 avg_action_duration = ?, permissions = ?`,
                [
                    agentId,
                    baseline.userId,
                    baseline.establishedAt,
                    baseline.totalActions,
                    baseline.avgTransactionAmount,
                    baseline.merchantCount,
                    baseline.avgConversationLength,
                    baseline.avgActionDuration,
                    JSON.stringify(baseline.permissions),
                    baseline.totalActions,
                    baseline.avgTransactionAmount,
                    baseline.merchantCount,
                    baseline.avgConversationLength,
                    baseline.avgActionDuration,
                    JSON.stringify(baseline.permissions)
                ]
            );
        } catch (error) {
            console.error('Store baseline error:', error);
            throw error;
        }
    }

    /**
     * Log anomaly
     */
    async logAnomaly(agentId, anomalies) {
        try {
            await db.query(
                `INSERT INTO agent_anomaly_logs 
                 (agent_id, risk_score, flags, confidence, details, timestamp)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    agentId,
                    anomalies.riskScore,
                    JSON.stringify(anomalies.flags),
                    anomalies.confidence,
                    JSON.stringify(anomalies.details)
                ]
            );
            
            // Add to local alerts
            this.anomalyAlerts.push({
                agentId,
                timestamp: new Date().toISOString(),
                anomalies
            });
            
            // Keep only last 1000 alerts
            if (this.anomalyAlerts.length > 1000) {
                this.anomalyAlerts = this.anomalyAlerts.slice(-1000);
            }
        } catch (error) {
            console.error('Log anomaly error:', error);
        }
    }

    /**
     * Send webhook alert
     */
    async sendWebhookAlert(agentId, anomalies) {
        if (!ANOMALY_CONFIG.webhookUrl) {
            console.warn('Webhook URL not configured');
            return;
        }

        const payload = {
            event: 'agent_anomaly_detected',
            agentId,
            timestamp: new Date().toISOString(),
            riskScore: anomalies.riskScore,
            flags: anomalies.flags,
            details: anomalies.details,
            confidence: anomalies.confidence
        };

        let retries = 0;
        while (retries < ANOMALY_CONFIG.webhookRetries) {
            try {
                const response = await fetch(ANOMALY_CONFIG.webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                    timeout: ANOMALY_CONFIG.webhookTimeout
                });

                if (response.ok) {
                    console.log(`Webhook alert sent successfully for agent ${agentId}`);
                    return;
                }
                
                console.error(`Webhook alert failed with status ${response.status}`);
                retries++;
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
            } catch (error) {
                console.error(`Webhook alert attempt ${retries + 1} failed:`, error);
                retries++;
                if (retries < ANOMALY_CONFIG.webhookRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
                }
            }
        }
        
        console.error(`Failed to send webhook alert after ${ANOMALY_CONFIG.webhookRetries} retries`);
    }

    /**
     * Update real-time monitoring
     */
    async updateRealTimeMonitoring(agentId, anomalies) {
        try {
            // In production, push to monitoring system (e.g., Prometheus, DataDog)
            console.log(`Real-time monitoring update for agent ${agentId}:`, {
                riskScore: anomalies.riskScore,
                isAnomalous: anomalies.isAnomalous,
                timestamp: new Date().toISOString()
            });
            
            // Could also emit websocket event for real-time dashboard
            // this.emit('anomaly', { agentId, anomalies });
        } catch (error) {
            console.error('Real-time monitoring update error:', error);
        }
    }

    /**
     * Get agent status
     */
    async getAgentStatus(agentId) {
        try {
            this.validateAgentId(agentId);
            
            const [baseline] = await db.query(
                'SELECT * FROM agent_baselines WHERE agent_id = ?',
                [agentId]
            );

            const [anomalies] = await db.query(
                'SELECT * FROM agent_anomaly_logs WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 10',
                [agentId]
            );

            const [activities] = await db.query(
                'SELECT COUNT(*) as total, AVG(transaction_amount) as avg_amount FROM agent_activity_logs WHERE agent_id = ?',
                [agentId]
            );

            // Get cache status
            const cacheKey = `baseline_${agentId}`;
            const isCached = baselineCache.has(cacheKey);

            return {
                agentId,
                baseline: baseline[0] || null,
                recentAnomalies: anomalies,
                activitySummary: activities[0] || { total: 0, avg_amount: 0 },
                status: anomalies.length > 0 && anomalies[0].risk_score > 75 ? 'critical' : 'normal',
                cacheStatus: {
                    isCached,
                    ttl: baselineCache.getTtl(cacheKey)
                },
                mlStatus: {
                    enabled: ANOMALY_CONFIG.mlEnabled,
                    modelsLoaded: this.mlModels.size
                }
            };
        } catch (error) {
            console.error('Get agent status error:', error);
            throw error;
        }
    }

    /**
     * Get statistics
     */
    getStatistics() {
        return {
            agentBaselines: this.agentBaselines.size,
            activeSessions: this.agentSessions.size,
            anomalyAlerts: this.anomalyAlerts.length,
            conversationPatterns: this.conversationPatterns.size,
            cacheStats: baselineCache.getStats(),
            mlModels: Array.from(this.mlModels.keys()),
            isInitialized: this.isInitialized
        };
    }

    /**
     * Clear cache
     */
    clearCache() {
        baselineCache.flushAll();
        console.log('Cache cleared successfully');
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        console.log('Shutting down AgentAnomalyDetection...');
        
        // Save current state
        try {
            const baselines = Array.from(this.agentBaselines.entries());
            baselineCache.set('agentBaselines', baselines);
            
            // Clear memory
            this.agentBaselines.clear();
            this.agentSessions.clear();
            this.mlModels.clear();
            
            console.log('AgentAnomalyDetection shutdown complete');
        } catch (error) {
            console.error('Shutdown error:', error);
        }
    }
}

// ============================================
// EXPORT
// ============================================

const agentAnomalyDetection = new AgentAnomalyDetection();

// Auto-initialize
agentAnomalyDetection.initialize().catch(error => {
    console.error('Failed to initialize AgentAnomalyDetection:', error);
});

module.exports = agentAnomalyDetection;