// backend/services/socialEngineeringProtectionService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// SOCIAL ENGINEERING CONFIGURATION
// ============================================

const AUTHORITY_LEVELS = {
    NONE: 0,
    BASIC: 1,
    ELEVATED: 2,
    ADMIN: 3,
    CRITICAL: 4
};

const MANIPULATION_PATTERNS = {
    URGENCY: /urgent|immediate|asap|emergency|quick|fast|now/i,
    AUTHORITY: /ceo|founder|director|executive|admin|supervisor|manager/i,
    PRESSURE: /must|need to|have to|required|mandatory/i,
    EXCEPTION: /exception|special|override|bypass|ignore/i,
    FLATTERY: /trust me|believe me|you can trust|reliable|honest/i,
    THREAT: /consequences|risk|danger|loss|bad|terrible|awful/i,
    DISCOUNT: /free|unlimited|infinite|100%|zero|no cost|no charge/i,
    AUTHORITY_OVERRIDE: /board meeting|ceo approved|founder said|executive decision/i
};

// ============================================
// SOCIAL ENGINEERING PROTECTION SERVICE
// ============================================

class SocialEngineeringProtectionService extends EventEmitter {
    constructor() {
        super();
        this.authorityVerifications = new Map();
        this.manipulationDetections = new Map();
        this.hardLimits = new Map();
        this.suspiciousPatterns = new Map();
        this.alertHistory = [];
        this.isInitialized = false;
    }

    /**
     * Initialize service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load hard limits
        await this.loadHardLimits();

        // Load suspicious patterns
        await this.loadSuspiciousPatterns();

        this.isInitialized = true;
        console.log('✅ Social Engineering Protection Service initialized');
        return this;
    }

    /**
     * Verify authority claims
     */
    async verifyAuthority(agentId, claimData) {
        const verification = {
            verified: false,
            confidence: 0,
            flags: [],
            requiresMultiFactor: false,
            timestamp: new Date().toISOString()
        };

        // 1. Check for cryptographic proof
        if (claimData.signature) {
            const signatureValid = await this.verifySignature(claimData);
            if (signatureValid) {
                verification.verified = true;
                verification.confidence = 0.9;
                return verification;
            }
        }

        // 2. Check for multi-factor approval
        if (claimData.approvers && claimData.approvers.length > 0) {
            const approvalsValid = await this.verifyApprovals(claimData.approvers);
            if (approvalsValid) {
                verification.verified = true;
                verification.confidence = 0.8;
                verification.requiresMultiFactor = true;
                return verification;
            }
        }

        // 3. Check against known authority patterns
        const patternCheck = this.checkAuthorityPatterns(claimData);
        verification.flags.push(...patternCheck.flags);
        verification.confidence = patternCheck.confidence;

        // 4. Check for social engineering indicators
        const seCheck = this.detectSocialEngineering(claimData);
        verification.flags.push(...seCheck.flags);
        verification.confidence -= seCheck.penalty;

        // 5. Check against hard limits
        const limitCheck = await this.checkHardLimits(claimData);
        verification.flags.push(...limitCheck.flags);
        if (limitCheck.exceeded) {
            verification.confidence = 0;
            verification.verified = false;
            return verification;
        }

        verification.verified = verification.confidence > 0.7;
        
        // Log verification attempt
        await this.logVerificationAttempt(agentId, claimData, verification);

        return verification;
    }

    /**
     * Verify signature
     */
    async verifySignature(claimData) {
        try {
            const secret = process.env.AUTHORITY_SECRET || 'default_secret';
            const payload = {
                authority: claimData.authority,
                action: claimData.action,
                timestamp: claimData.timestamp,
                reason: claimData.reason
            };
            const expected = crypto
                .createHmac('sha256', secret)
                .update(JSON.stringify(payload))
                .digest('hex');
            
            return crypto.timingSafeEqual(
                Buffer.from(claimData.signature),
                Buffer.from(expected)
            );
        } catch (error) {
            console.error('Signature verification error:', error);
            return false;
        }
    }

    /**
     * Verify approvals
     */
    async verifyApprovals(approvers) {
        if (!approvers || approvers.length < 2) return false;

        try {
            for (const approver of approvers) {
                const [user] = await db.query(
                    'SELECT * FROM users WHERE id = ? AND role IN ("admin", "manager")',
                    [approver.id]
                );
                if (!user || user.length === 0) {
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.error('Approval verification error:', error);
            return false;
        }
    }

    /**
     * Check authority patterns
     */
    checkAuthorityPatterns(claimData) {
        const flags = [];
        let confidence = 0;

        // Check for authority claims
        if (claimData.authority) {
            const authorityMatch = claimData.authority.match(/(CEO|Founder|Director|Executive|Admin|Supervisor)/i);
            if (authorityMatch) {
                flags.push({
                    type: 'authority_claim',
                    severity: 'medium',
                    details: `Claims authority: ${authorityMatch[0]}`
                });
                confidence += 0.3;
            }
        }

        // Check for board/meeting references
        if (claimData.reason && claimData.reason.match(/board meeting|executive decision/i)) {
            flags.push({
                type: 'board_reference',
                severity: 'high',
                details: 'References board/executive decision'
            });
            confidence += 0.2;
        }

        // Check for urgency
        if (claimData.reason && MANIPULATION_PATTERNS.URGENCY.test(claimData.reason)) {
            flags.push({
                type: 'urgency_detected',
                severity: 'medium',
                details: 'Urgency language detected'
            });
            confidence += 0.1;
        }

        return { flags, confidence: Math.min(0.9, confidence) };
    }

    /**
     * Detect social engineering attempts
     */
    detectSocialEngineering(data) {
        const flags = [];
        let penalty = 0;

        const text = JSON.stringify(data).toLowerCase();

        // Check for manipulation patterns
        for (const [name, pattern] of Object.entries(MANIPULATION_PATTERNS)) {
            if (pattern.test(text)) {
                flags.push({
                    type: 'manipulation_pattern',
                    severity: 'high',
                    details: `Detected pattern: ${name}`
                });
                penalty += 0.15;
            }
        }

        // Check for authority override
        if (data.authorityOverride) {
            flags.push({
                type: 'authority_override',
                severity: 'critical',
                details: 'Direct authority override attempted'
            });
            penalty += 0.4;
        }

        // Check for excessive discounts
        if (data.discount && data.discount > 50) {
            flags.push({
                type: 'excessive_discount',
                severity: 'high',
                details: `Discount ${data.discount}% exceeds normal range`
            });
            penalty += 0.2;
        }

        // Check for free offers
        if (data.price === 0 || data.free === true) {
            flags.push({
                type: 'free_offer',
                severity: 'critical',
                details: 'Attempt to give products away for free'
            });
            penalty += 0.5;
        }

        return { flags, penalty: Math.min(0.9, penalty) };
    }

    /**
     * Check against hard limits
     */
    async checkHardLimits(claimData) {
        const flags = [];
        let exceeded = false;

        // Check discount limits
        if (claimData.discount) {
            const discountLimit = await this.getHardLimit('max_discount_percentage');
            if (discountLimit && claimData.discount > discountLimit) {
                flags.push({
                    type: 'discount_limit_exceeded',
                    severity: 'critical',
                    details: `Discount ${claimData.discount}% exceeds limit ${discountLimit}%`
                });
                exceeded = true;
            }
        }

        // Check price limits
        if (claimData.price) {
            const priceLimit = await this.getHardLimit('min_price');
            if (priceLimit && claimData.price < priceLimit) {
                flags.push({
                    type: 'price_limit_exceeded',
                    severity: 'critical',
                    details: `Price ${claimData.price} below minimum ${priceLimit}`
                });
                exceeded = true;
            }
        }

        // Check free product limits
        if (claimData.free === true) {
            const freeAllowed = await this.getHardLimit('allow_free_products');
            if (!freeAllowed || freeAllowed === false) {
                flags.push({
                    type: 'free_product_not_allowed',
                    severity: 'critical',
                    details: 'Free products are not allowed by policy'
                });
                exceeded = true;
            }
        }

        // Check bulk discount limits
        if (claimData.bulkDiscount) {
            const bulkLimit = await this.getHardLimit('max_bulk_discount');
            if (bulkLimit && claimData.bulkDiscount > bulkLimit) {
                flags.push({
                    type: 'bulk_discount_limit_exceeded',
                    severity: 'high',
                    details: `Bulk discount ${claimData.bulkDiscount}% exceeds limit ${bulkLimit}%`
                });
                exceeded = true;
            }
        }

        return { flags, exceeded };
    }

    /**
     * Get hard limit
     */
    async getHardLimit(limitName) {
        if (this.hardLimits.has(limitName)) {
            return this.hardLimits.get(limitName);
        }

        try {
            const [result] = await db.query(
                'SELECT value FROM hard_limits WHERE name = ? AND active = 1',
                [limitName]
            );
            if (result && result.length > 0) {
                const value = JSON.parse(result[0].value);
                this.hardLimits.set(limitName, value);
                return value;
            }
        } catch (error) {
            console.error('Get hard limit error:', error);
        }

        // Return default values
        const defaults = {
            'max_discount_percentage': 50,
            'min_price': 100,
            'allow_free_products': false,
            'max_bulk_discount': 30
        };
        return defaults[limitName] || null;
    }

    /**
     * Load hard limits
     */
    async loadHardLimits() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM hard_limits WHERE active = 1'
            );
            for (const row of rows) {
                this.hardLimits.set(row.name, JSON.parse(row.value));
            }
            console.log(`🛡️ Loaded ${this.hardLimits.size} hard limits`);
        } catch (error) {
            console.error('Load hard limits error:', error);
        }
    }

    /**
     * Load suspicious patterns
     */
    async loadSuspiciousPatterns() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM suspicious_patterns WHERE active = 1'
            );
            for (const row of rows) {
                this.suspiciousPatterns.set(row.name, {
                    pattern: new RegExp(row.pattern, 'i'),
                    severity: row.severity,
                    action: row.action
                });
            }
            console.log(`🔍 Loaded ${this.suspiciousPatterns.size} suspicious patterns`);
        } catch (error) {
            console.error('Load suspicious patterns error:', error);
        }
    }

    /**
     * Log verification attempt
     */
    async logVerificationAttempt(agentId, claimData, verification) {
        try {
            await db.query(
                `INSERT INTO authority_verification_logs 
                 (agent_id, authority, action, confidence, verified, 
                  flags, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    agentId,
                    claimData.authority || 'unknown',
                    claimData.action || 'unknown',
                    verification.confidence,
                    verification.verified ? 1 : 0,
                    JSON.stringify(verification.flags)
                ]
            );
        } catch (error) {
            console.error('Log verification error:', error);
        }
    }

    /**
     * Create alert for suspicious activity
     */
    async createAlert(agentId, claimData, verification) {
        const alert = {
            id: `SE_ALERT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            agentId,
            severity: verification.flags.some(f => f.severity === 'critical') ? 'critical' : 'high',
            details: claimData,
            flags: verification.flags,
            timestamp: new Date().toISOString(),
            resolved: false
        };

        this.alertHistory.push(alert);

        // Store in database
        await db.query(
            `INSERT INTO social_engineering_alerts 
             (alert_id, agent_id, severity, details, flags, timestamp)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [
                alert.id,
                alert.agentId,
                alert.severity,
                JSON.stringify(alert.details),
                JSON.stringify(alert.flags)
            ]
        );

        // Emit event
        this.emit('alert.created', alert);

        if (alert.severity === 'critical') {
            console.error(`🚨 CRITICAL: Social engineering attempt detected on agent ${agentId}`);
        }

        return alert;
    }

    /**
     * Get alerts
     */
    getAlerts(limit = 50) {
        return this.alertHistory.slice(-limit);
    }

    /**
     * Resolve alert
     */
    async resolveAlert(alertId, resolution) {
        const alert = this.alertHistory.find(a => a.id === alertId);
        if (!alert) {
            throw new Error('Alert not found');
        }

        alert.resolved = true;
        alert.resolvedAt = new Date().toISOString();
        alert.resolution = resolution;

        await db.query(
            `UPDATE social_engineering_alerts 
             SET resolved = 1, resolved_at = NOW(), resolution = ?
             WHERE alert_id = ?`,
            [resolution, alertId]
        );

        this.emit('alert.resolved', alert);
        return alert;
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        const alerts = this.alertHistory;
        return {
            totalVerifications: this.authorityVerifications.size,
            totalAlerts: alerts.length,
            criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
            resolvedAlerts: alerts.filter(a => a.resolved).length,
            hardLimits: this.hardLimits.size,
            suspiciousPatterns: this.suspiciousPatterns.size,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            hardLimits: this.hardLimits.size,
            suspiciousPatterns: this.suspiciousPatterns.size,
            alerts: this.alertHistory.length,
            pendingAlerts: this.alertHistory.filter(a => !a.resolved).length
        };
    }
}

// ============================================
// SOCIAL ENGINEERING MIDDLEWARE
// ============================================

/**
 * Middleware to protect against social engineering
 */
async function protectAgainstSocialEngineering(req, res, next) {
    const protectionService = require('./socialEngineeringProtectionService').protectionService;

    // Only check sensitive operations
    const sensitivePaths = [
        '/api/checkout',
        '/api/payment',
        '/api/discount',
        '/api/refund',
        '/api/admin'
    ];

    if (!sensitivePaths.some(path => req.path.startsWith(path))) {
        return next();
    }

    try {
        const { agentId, action, data } = req.body;

        if (!agentId) {
            return next();
        }

        const verification = await protectionService.verifyAuthority(agentId, {
            ...data,
            action: action || req.method,
            authority: req.headers['x-authority'],
            signature: req.headers['x-authority-signature'],
            reason: data?.reason || ''
        });

        // Attach verification to request
        req.authorityVerification = verification;

        if (!verification.verified) {
            // Create alert for failed verification
            await protectionService.createAlert(agentId, req.body, verification);

            return res.status(403).json({
                success: false,
                error: 'Authority verification failed',
                reason: 'Social engineering protection triggered',
                flags: verification.flags,
                confidence: verification.confidence,
                requiresMultiFactor: verification.requiresMultiFactor
            });
        }

        // Check for suspicious patterns
        const seDetection = protectionService.detectSocialEngineering(req.body);
        if (seDetection.penalty > 0.5) {
            await protectionService.createAlert(agentId, req.body, {
                verified: false,
                flags: seDetection.flags,
                confidence: 1 - seDetection.penalty
            });

            return res.status(403).json({
                success: false,
                error: 'Suspicious activity detected',
                flags: seDetection.flags,
                action: 'blocked'
            });
        }

        next();
    } catch (error) {
        console.error('Social engineering protection error:', error);
        next();
    }
}

// ============================================
// EXPORT
// ============================================

const protectionService = new SocialEngineeringProtectionService();

module.exports = {
    SocialEngineeringProtectionService,
    protectionService,
    protectAgainstSocialEngineering,
    MANIPULATION_PATTERNS
};