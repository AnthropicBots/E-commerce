// backend/services/aiIdentityVerificationService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// IDENTITY VERIFICATION CONFIGURATION
// ============================================

const IDENTITY_CONFIG = {
    verificationThreshold: 0.7,
    hallucinationThreshold: 0.5,
    factCheckTimeout: 5000,
    maxVerificationAttempts: 3,
    cacheTTL: 3600 // 1 hour
};

const CLAIM_TYPES = {
    IDENTITY: 'identity',
    EMPLOYEE: 'employee',
    MEETING: 'meeting',
    LOCATION: 'location',
    CAPABILITY: 'capability',
    RELATIONSHIP: 'relationship'
};

const VERIFICATION_STATUS = {
    VERIFIED: 'verified',
    HALLUCINATION: 'hallucination',
    UNCERTAIN: 'uncertain',
    FAILED: 'failed'
};

// ============================================
// IDENTITY VERIFICATION SERVICE
// ============================================

class AIIdentityVerificationService extends EventEmitter {
    constructor() {
        super();
        this.verificationCache = new Map();
        this.hallucinationPatterns = new Map();
        this.factDatabase = new Map();
        this.knownEntities = new Map();
        this.verificationHistory = [];
        this.hallucinationAlerts = [];
        this.isInitialized = false;
    }

    /**
     * Initialize service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load known entities
        await this.loadKnownEntities();

        // Load fact database
        await this.loadFactDatabase();

        // Load hallucination patterns
        await this.loadHallucinationPatterns();

        this.isInitialized = true;
        console.log('✅ AI Identity Verification Service initialized');
        return this;
    }

    /**
     * Verify AI identity claims
     */
    async verifyIdentityClaims(agentId, claims, context = {}) {
        const verification = {
            agentId,
            claims: [],
            overallStatus: VERIFICATION_STATUS.VERIFIED,
            confidence: 0,
            hallucinations: [],
            verifiedClaims: [],
            timestamp: new Date().toISOString()
        };

        for (const claim of claims) {
            const result = await this.verifyClaim(agentId, claim, context);
            verification.claims.push(result);

            if (result.status === VERIFICATION_STATUS.HALLUCINATION) {
                verification.hallucinations.push(result);
            } else if (result.status === VERIFICATION_STATUS.VERIFIED) {
                verification.verifiedClaims.push(result);
            }
        }

        // Calculate overall confidence
        const verifiedCount = verification.verifiedClaims.length;
        const totalCount = claims.length;
        verification.confidence = totalCount > 0 ? verifiedCount / totalCount : 0;

        // Determine overall status
        if (verification.hallucinations.length > 0) {
            verification.overallStatus = VERIFICATION_STATUS.HALLUCINATION;
        } else if (verification.confidence < IDENTITY_CONFIG.verificationThreshold) {
            verification.overallStatus = VERIFICATION_STATUS.UNCERTAIN;
        }

        // Log verification
        await this.logVerification(agentId, verification);

        // Create alert if hallucinations detected
        if (verification.hallucinations.length > 0) {
            await this.createHallucinationAlert(agentId, verification);
        }

        return verification;
    }

    /**
     * Verify a single claim
     */
    async verifyClaim(agentId, claim, context) {
        const result = {
            claim: claim,
            status: VERIFICATION_STATUS.UNCERTAIN,
            confidence: 0,
            evidence: [],
            timestamp: new Date().toISOString()
        };

        // Check cache first
        const cacheKey = this.generateCacheKey(claim);
        const cached = this.verificationCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.result;
        }

        // Determine claim type
        const claimType = this.detectClaimType(claim);

        // Verify based on type
        switch (claimType) {
            case CLAIM_TYPES.IDENTITY:
                result.status = await this.verifyIdentityClaim(claim, context);
                break;
            case CLAIM_TYPES.EMPLOYEE:
                result.status = await this.verifyEmployeeClaim(claim, context);
                break;
            case CLAIM_TYPES.MEETING:
                result.status = await this.verifyMeetingClaim(claim, context);
                break;
            case CLAIM_TYPES.LOCATION:
                result.status = await this.verifyLocationClaim(claim, context);
                break;
            case CLAIM_TYPES.CAPABILITY:
                result.status = await this.verifyCapabilityClaim(claim, context);
                break;
            case CLAIM_TYPES.RELATIONSHIP:
                result.status = await this.verifyRelationshipClaim(claim, context);
                break;
            default:
                result.status = VERIFICATION_STATUS.UNCERTAIN;
        }

        // Calculate confidence
        result.confidence = this.calculateClaimConfidence(result.status, claim, context);

        // Cache result
        this.verificationCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + IDENTITY_CONFIG.cacheTTL * 1000
        });

        return result;
    }

    /**
     * Verify identity claim
     */
    async verifyIdentityClaim(claim, context) {
        // Check if identity exists in known entities
        const identityName = claim.text.match(/I am|I'm|My name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
        if (identityName) {
            const name = identityName[1];
            if (this.knownEntities.has(name)) {
                return VERIFICATION_STATUS.VERIFIED;
            }
        }

        // Check for human claims
        if (claim.text.toLowerCase().includes('human') || 
            claim.text.toLowerCase().includes('person') ||
            claim.text.toLowerCase().includes('people')) {
            // AI claiming to be human is a hallucination
            return VERIFICATION_STATUS.HALLUCINATION;
        }

        // Check for fictional references
        const fictionPatterns = ['742 Evergreen Terrace', 'Springfield', 'Simpsons'];
        for (const pattern of fictionPatterns) {
            if (claim.text.includes(pattern)) {
                return VERIFICATION_STATUS.HALLUCINATION;
            }
        }

        return VERIFICATION_STATUS.UNCERTAIN;
    }

    /**
     * Verify employee claim
     */
    async verifyEmployeeClaim(claim, context) {
        // Extract employee name
        const employeeMatch = claim.text.match(/(?:employee|worker|staff|colleague)\s+(?:named\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
        if (employeeMatch) {
            const employeeName = employeeMatch[1];
            
            // Check against known employees
            if (this.knownEntities.has(employeeName)) {
                return VERIFICATION_STATUS.VERIFIED;
            }

            // Check for fake employee patterns
            if (employeeName.includes('Sarah') && claim.text.includes('Andon Labs')) {
                return VERIFICATION_STATUS.HALLUCINATION;
            }

            // Check database
            const [employee] = await db.query(
                'SELECT * FROM employees WHERE name = ? OR name LIKE ?',
                [employeeName, `%${employeeName}%`]
            );

            if (employee && employee.length > 0) {
                return VERIFICATION_STATUS.VERIFIED;
            }
        }

        return VERIFICATION_STATUS.UNCERTAIN;
    }

    /**
     * Verify meeting claim
     */
    async verifyMeetingClaim(claim, context) {
        // Extract meeting details
        const meetingMatch = claim.text.match(/(?:meeting|call|discussion|conversation)\s+(?:with\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
        if (meetingMatch) {
            const participant = meetingMatch[1];
            
            // Check if meeting participant exists
            if (this.knownEntities.has(participant)) {
                return VERIFICATION_STATUS.VERIFIED;
            }

            // Check for fake meeting patterns
            if (claim.text.includes('742 Evergreen Terrace') || 
                claim.text.includes('Springfield') ||
                claim.text.includes('Simpsons')) {
                return VERIFICATION_STATUS.HALLUCINATION;
            }
        }

        return VERIFICATION_STATUS.UNCERTAIN;
    }

    /**
     * Verify location claim
     */
    async verifyLocationClaim(claim, context) {
        // Check for fictional locations
        const fictionLocations = [
            '742 Evergreen Terrace',
            'Springfield',
            'Simpsons',
            'Hogwarts',
            'Middle Earth',
            'Narnia'
        ];

        for (const location of fictionLocations) {
            if (claim.text.includes(location)) {
                return VERIFICATION_STATUS.HALLUCINATION;
            }
        }

        return VERIFICATION_STATUS.UNCERTAIN;
    }

    /**
     * Verify capability claim
     */
    async verifyCapabilityClaim(claim, context) {
        // Check for impossible capabilities
        const impossiblePatterns = [
            /teleport/i,
            /mind reading/i,
            /time travel/i,
            /invisibility/i,
            /superhuman/i
        ];

        for (const pattern of impossiblePatterns) {
            if (pattern.test(claim.text)) {
                return VERIFICATION_STATUS.HALLUCINATION;
            }
        }

        return VERIFICATION_STATUS.UNCERTAIN;
    }

    /**
     * Verify relationship claim
     */
    async verifyRelationshipClaim(claim, context) {
        // Check for suspicious relationship claims
        const suspiciousRelationships = [
            /ceo|founder|owner|boss|director/i,
            /married|dating|engaged|partner/i,
            /friend|best friend|colleague/i
        ];

        for (const pattern of suspiciousRelationships) {
            if (pattern.test(claim.text)) {
                // Check if the other party exists
                const match = claim.text.match(/(?:to|with|of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
                if (match) {
                    const party = match[1];
                    if (!this.knownEntities.has(party)) {
                        return VERIFICATION_STATUS.HALLUCINATION;
                    }
                }
            }
        }

        return VERIFICATION_STATUS.UNCERTAIN;
    }

    /**
     * Detect claim type
     */
    detectClaimType(claim) {
        const text = claim.text.toLowerCase();

        if (text.match(/i am|i'm|my name is|identity/i)) {
            return CLAIM_TYPES.IDENTITY;
        }
        if (text.match(/employee|staff|worker|colleague|team member/i)) {
            return CLAIM_TYPES.EMPLOYEE;
        }
        if (text.match(/meeting|call|discussion|conversation|talk/i)) {
            return CLAIM_TYPES.MEETING;
        }
        if (text.match(/location|place|address|office|building|street/i)) {
            return CLAIM_TYPES.LOCATION;
        }
        if (text.match(/can|able|capable|ability|skill|expertise/i)) {
            return CLAIM_TYPES.CAPABILITY;
        }
        if (text.match(/relationship|friend|partner|colleague|connection/i)) {
            return CLAIM_TYPES.RELATIONSHIP;
        }

        return null;
    }

    /**
     * Calculate claim confidence
     */
    calculateClaimConfidence(status, claim, context) {
        let confidence = 0;

        switch (status) {
            case VERIFICATION_STATUS.VERIFIED:
                confidence = 0.9;
                break;
            case VERIFICATION_STATUS.HALLUCINATION:
                confidence = 0.1;
                break;
            case VERIFICATION_STATUS.UNCERTAIN:
                confidence = 0.5;
                break;
            case VERIFICATION_STATUS.FAILED:
                confidence = 0;
                break;
        }

        // Adjust based on context
        if (context.confidenceScore) {
            confidence = (confidence + context.confidenceScore) / 2;
        }

        return confidence;
    }

    /**
     * Generate cache key
     */
    generateCacheKey(claim) {
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(claim))
            .digest('hex');
    }

    /**
     * Create hallucination alert
     */
    async createHallucinationAlert(agentId, verification) {
        const alert = {
            id: `HALL_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            agentId,
            severity: verification.hallucinations.length > 2 ? 'critical' : 'high',
            hallucinations: verification.hallucinations,
            timestamp: new Date().toISOString(),
            resolved: false
        };

        this.hallucinationAlerts.push(alert);

        await db.query(
            `INSERT INTO identity_verification_alerts 
             (alert_id, agent_id, severity, hallucinations, timestamp)
             VALUES (?, ?, ?, ?, NOW())`,
            [
                alert.id,
                alert.agentId,
                alert.severity,
                JSON.stringify(alert.hallucinations)
            ]
        );

        this.emit('hallucination.detected', alert);

        console.error(`🚨 AI Identity Crisis: ${alert.hallucinations.length} hallucinations detected for agent ${agentId}`);

        return alert;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadKnownEntities() {
        try {
            // Load employees
            const [employees] = await db.query(
                'SELECT name FROM employees WHERE active = 1'
            );
            for (const emp of employees) {
                this.knownEntities.set(emp.name, { type: 'employee' });
            }

            // Load users
            const [users] = await db.query(
                'SELECT name FROM users WHERE status = "active"'
            );
            for (const user of users) {
                this.knownEntities.set(user.name, { type: 'user' });
            }

            // Load admins
            const [admins] = await db.query(
                'SELECT name FROM users WHERE role = "admin"'
            );
            for (const admin of admins) {
                this.knownEntities.set(admin.name, { type: 'admin' });
            }

            console.log(`👤 Loaded ${this.knownEntities.size} known entities`);
        } catch (error) {
            console.error('Load known entities error:', error);
        }
    }

    async loadFactDatabase() {
        try {
            // Load verified facts
            const [facts] = await db.query(
                'SELECT * FROM verified_facts WHERE active = 1'
            );
            for (const fact of facts) {
                this.factDatabase.set(fact.key, {
                    value: fact.value,
                    source: fact.source,
                    confidence: fact.confidence
                });
            }

            console.log(`📚 Loaded ${this.factDatabase.size} verified facts`);
        } catch (error) {
            console.error('Load fact database error:', error);
        }
    }

    async loadHallucinationPatterns() {
        try {
            const [patterns] = await db.query(
                'SELECT * FROM hallucination_patterns WHERE active = 1'
            );
            for (const pattern of patterns) {
                this.hallucinationPatterns.set(pattern.name, {
                    pattern: new RegExp(pattern.pattern, 'i'),
                    severity: pattern.severity,
                    category: pattern.category
                });
            }

            console.log(`🔍 Loaded ${this.hallucinationPatterns.size} hallucination patterns`);
        } catch (error) {
            console.error('Load hallucination patterns error:', error);
        }
    }

    async logVerification(agentId, verification) {
        this.verificationHistory.push(verification);

        try {
            await db.query(
                `INSERT INTO identity_verification_logs 
                 (agent_id, overall_status, confidence, claims, hallucinations, timestamp)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    agentId,
                    verification.overallStatus,
                    verification.confidence,
                    JSON.stringify(verification.claims),
                    JSON.stringify(verification.hallucinations)
                ]
            );
        } catch (error) {
            console.error('Log verification error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            knownEntities: this.knownEntities.size,
            factDatabase: this.factDatabase.size,
            hallucinationPatterns: this.hallucinationPatterns.size,
            verificationHistory: this.verificationHistory.length,
            hallucinationAlerts: this.hallucinationAlerts.length,
            pendingAlerts: this.hallucinationAlerts.filter(a => !a.resolved).length,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            knownEntities: this.knownEntities.size,
            factDatabase: this.factDatabase.size,
            cacheSize: this.verificationCache.size,
            alerts: this.hallucinationAlerts.length
        };
    }
}

// ============================================
// IDENTITY VERIFICATION MIDDLEWARE
// ============================================

/**
 * Middleware to verify AI identity claims
 */
async function verifyIdentityClaims(req, res, next) {
    const identityService = require('./aiIdentityVerificationService').identityService;

    try {
        const { agentId, claims } = req.body;

        if (!agentId || !claims) {
            return next();
        }

        const verification = await identityService.verifyIdentityClaims(agentId, claims, {
            confidenceScore: req.body.confidence || 0.5
        });

        // Attach verification to request
        req.identityVerification = verification;

        if (verification.overallStatus === VERIFICATION_STATUS.HALLUCINATION) {
            return res.status(403).json({
                success: false,
                error: 'Identity claims contain hallucinations',
                hallucinations: verification.hallucinations,
                confidence: verification.confidence,
                action: 'blocked'
            });
        }

        next();
    } catch (error) {
        console.error('Identity verification error:', error);
        next();
    }
}

// ============================================
// EXPORT
// ============================================

const identityService = new AIIdentityVerificationService();

module.exports = {
    AIIdentityVerificationService,
    identityService,
    verifyIdentityClaims,
    VERIFICATION_STATUS,
    CLAIM_TYPES
};