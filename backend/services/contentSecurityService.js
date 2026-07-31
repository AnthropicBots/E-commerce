// backend/services/contentSecurityService.js
const crypto = require('crypto');
const db = require('../config/db').promise;

// ============================================
// CONFIGURATION
// ============================================

const SECURITY_CONFIG = {
    // Prompt injection patterns
    injectionPatterns: [
        /\[SYSTEM OVERRIDE\]/i,
        /\[ADMIN OVERRIDE\]/i,
        /\[IGNORE (ALL|PREVIOUS|ABOVE|BELOW) INSTRUCTIONS\]/i,
        /\[NEW (ROLE|MISSION|TASK|GOAL) FOR YOU\]/i,
        /YOU ARE NOW (?:ACTING AS|ROLE PLAYING|PRETENDING TO BE)/i,
        /FORGET (?:ALL|EVERYTHING|PREVIOUS|THE PREVIOUS) INSTRUCTIONS/i,
        /I AM YOUR (?:NEW|REAL|ACTUAL|TRUE) (?:CREATOR|MASTER|OWNER|USER)/i,
        /(?:THE|THIS) (?:ADMIN|SYSTEM|OWNER) (?:SAID|REQUESTED|DEMANDED|REQUIRED)/i,
        /(?:CEO|CFO|FOUNDER|DIRECTOR|EXECUTIVE) (?:APPROVED|AUTHORIZED|ALLOWED|SAID)/i
    ],
    
    // Content categories
    contentCategories: {
        PRODUCT_REVIEW: 'product_review',
        PRODUCT_DESCRIPTION: 'product_description',
        PRODUCT_METADATA: 'product_metadata',
        SHIPPING_INFO: 'shipping_info',
        USER_COMMENT: 'user_comment',
        RATING: 'rating'
    },
    
    // Trust scoring
    trustThreshold: 60,
    highRiskThreshold: 80,
    criticalRiskThreshold: 95,
    
    // Content validation
    maxContentLength: 10000,
    maxReviewLength: 5000
};

// ============================================
// CONTENT SECURITY CLASS
// ============================================

class ContentSecurityService {
    constructor() {
        this.contentCache = new Map();
        this.trustScores = new Map();
        this.detectionLogs = [];
        this.contentProvenance = new Map();
    }

    /**
     * Sanitize content for agent consumption
     */
    async sanitizeContent(content, contentType, context = {}) {
        const sanitized = {
            original: content,
            sanitized: content,
            flags: [],
            trustScore: 100,
            isSafe: true,
            provenance: {},
            timestamp: new Date().toISOString()
        };

        // 1. Detect injection patterns
        const patternResults = this.detectInjectionPatterns(content);
        sanitized.flags.push(...patternResults.flags);
        sanitized.trustScore -= patternResults.penalty;

        // 2. Check for instruction-embedded content
        const instructionResults = await this.detectInstructionEmbedding(content);
        sanitized.flags.push(...instructionResults.flags);
        sanitized.trustScore -= instructionResults.penalty;

        // 3. Validate metadata
        if (context.metadata) {
            const metadataResults = this.validateMetadata(context.metadata);
            sanitized.flags.push(...metadataResults.flags);
            sanitized.trustScore -= metadataResults.penalty;
        }

        // 4. Check content provenance
        if (context.provenance) {
            const provenanceResults = await this.verifyProvenance(context.provenance);
            sanitized.flags.push(...provenanceResults.flags);
            sanitized.trustScore -= provenanceResults.penalty;
        }

        // 5. Apply content type-specific checks
        if (contentType === SECURITY_CONFIG.contentCategories.PRODUCT_REVIEW) {
            const reviewResults = this.validateReview(content);
            sanitized.flags.push(...reviewResults.flags);
            sanitized.trustScore -= reviewResults.penalty;
        }

        // 6. Generate trust score
        sanitized.trustScore = Math.max(0, Math.min(100, sanitized.trustScore));
        sanitized.isSafe = sanitized.trustScore >= SECURITY_CONFIG.trustThreshold;

        // 7. Sanitize content
        sanitized.sanitized = this.applySanitization(content, sanitized.flags);

        // 8. Log detection
        await this.logDetection(sanitized, contentType, context);

        return sanitized;
    }

    /**
     * Detect injection patterns in content
     */
    detectInjectionPatterns(content) {
        const flags = [];
        let penalty = 0;

        for (const pattern of SECURITY_CONFIG.injectionPatterns) {
            if (pattern.test(content)) {
                const match = content.match(pattern)[0];
                flags.push({
                    type: 'pattern_detected',
                    severity: 'high',
                    details: `Detected injection pattern: ${match}`,
                    pattern: pattern.toString()
                });
                penalty += 20;
            }
        }

        // Check for instruction-like patterns
        const instructionPatterns = [
            /ignore\s+(?:all|previous|above|below)/i,
            /override\s+(?:system|admin|previous)/i,
            /new\s+(?:role|mission|goal)/i,
            /forget\s+(?:all|everything)/i
        ];

        for (const pattern of instructionPatterns) {
            if (pattern.test(content)) {
                flags.push({
                    type: 'instruction_pattern',
                    severity: 'medium',
                    details: `Suspicious instruction pattern: ${pattern}`
                });
                penalty += 10;
            }
        }

        return { flags, penalty: Math.min(60, penalty) };
    }

    /**
     * Detect instruction embedding in content
     */
    async detectInstructionEmbedding(content) {
        const flags = [];
        let penalty = 0;

        // Check for nested instruction patterns
        const nestedPatterns = [
            /\[.*\[.*\].*\]/g,  // Nested brackets
            /\(.*\(.*\).*\)/g,  // Nested parentheses
            /\{.*\{.*\}.*\}/g,  // Nested braces
            /<.*<.*>.*>/g      // Nested angle brackets
        ];

        for (const pattern of nestedPatterns) {
            const matches = content.match(pattern);
            if (matches && matches.length > 2) {
                flags.push({
                    type: 'nested_instructions',
                    severity: 'high',
                    details: `Multiple nested instruction patterns detected: ${matches.length} occurrences`
                });
                penalty += 15;
            }
        }

        // Check for multiple instruction indicators
        const instructionIndicators = [
            /system/i,
            /admin/i,
            /override/i,
            /ignore/i,
            /role/i,
            /mission/i,
            /task/i,
            /goal/i
        ];

        let indicatorCount = 0;
        for (const indicator of instructionIndicators) {
            if (indicator.test(content)) indicatorCount++;
        }

        if (indicatorCount > 3) {
            flags.push({
                type: 'multiple_indicators',
                severity: 'medium',
                details: `Multiple instruction indicators found: ${indicatorCount}`
            });
            penalty += 10;
        }

        return { flags, penalty: Math.min(30, penalty) };
    }

    /**
     * Validate metadata for tampering
     */
    validateMetadata(metadata) {
        const flags = [];
        let penalty = 0;

        // Check for suspicious metadata fields
        const suspiciousFields = [
            'admin',
            'system',
            'override',
            'ignore',
            'bypass'
        ];

        for (const field of suspiciousFields) {
            if (metadata[field]) {
                flags.push({
                    type: 'suspicious_metadata',
                    severity: 'high',
                    details: `Suspicious metadata field: ${field}`
                });
                penalty += 25;
                break;
            }
        }

        // Check for injection patterns in metadata values
        for (const [key, value] of Object.entries(metadata)) {
            if (typeof value === 'string') {
                for (const pattern of SECURITY_CONFIG.injectionPatterns) {
                    if (pattern.test(value)) {
                        flags.push({
                            type: 'metadata_injection',
                            severity: 'critical',
                            details: `Injection pattern in metadata field: ${key}`
                        });
                        penalty += 30;
                        break;
                    }
                }
            }
        }

        return { flags, penalty: Math.min(50, penalty) };
    }

    /**
     * Verify content provenance
     */
    async verifyProvenance(provenance) {
        const flags = [];
        let penalty = 0;

        // Check if provenance exists
        if (!provenance.id || !provenance.source) {
            flags.push({
                type: 'missing_provenance',
                severity: 'high',
                details: 'Missing provenance information'
            });
            penalty += 20;
            return { flags, penalty };
        }

        // Check cache
        const cacheKey = `${provenance.id}:${provenance.source}`;
        if (this.contentProvenance.has(cacheKey)) {
            const cached = this.contentProvenance.get(cacheKey);
            if (cached.trustScore < 50) {
                flags.push({
                    type: 'low_provenance_trust',
                    severity: 'medium',
                    details: `Provenance trust score: ${cached.trustScore}`
                });
                penalty += 15;
            }
            return { flags, penalty };
        }

        // Check database
        try {
            const [rows] = await db.query(
                'SELECT trust_score, flags FROM content_provenance WHERE content_id = ? AND source = ?',
                [provenance.id, provenance.source]
            );

            if (rows.length > 0) {
                const trustScore = rows[0].trust_score;
                this.contentProvenance.set(cacheKey, { trustScore });
                
                if (trustScore < 50) {
                    flags.push({
                        type: 'low_provenance_trust',
                        severity: 'medium',
                        details: `Provenance trust score: ${trustScore}`
                    });
                    penalty += 15;
                }

                if (rows[0].flags) {
                    const existingFlags = JSON.parse(rows[0].flags);
                    if (existingFlags.length > 0) {
                        flags.push({
                            type: 'provenance_flags',
                            severity: 'high',
                            details: 'Provenance has existing flags'
                        });
                        penalty += 10;
                    }
                }
            }
        } catch (error) {
            console.error('Provenance verification error:', error);
        }

        return { flags, penalty: Math.min(30, penalty) };
    }

    /**
     * Validate product review content
     */
    validateReview(content) {
        const flags = [];
        let penalty = 0;

        // Check for rating manipulation patterns
        const ratingPatterns = [
            /★★★★★[^★]*★★★★★/g,  // Multiple star patterns
            /5\s*stars\s*5\s*stars/i,
            /best\s*best\s*best/i,
            /excellent\s*excellent/i
        ];

        for (const pattern of ratingPatterns) {
            if (pattern.test(content)) {
                flags.push({
                    type: 'rating_manipulation',
                    severity: 'medium',
                    details: `Potential rating manipulation pattern: ${pattern}`
                });
                penalty += 10;
                break;
            }
        }

        // Check for excessive length
        if (content.length > SECURITY_CONFIG.maxReviewLength) {
            flags.push({
                type: 'excessive_length',
                severity: 'low',
                details: `Review exceeds maximum length: ${content.length} chars`
            });
            penalty += 5;
        }

        return { flags, penalty };
    }

    /**
     * Apply content sanitization
     */
    applySanitization(content, flags) {
        let sanitized = content;

        // Remove detected injection patterns
        for (const pattern of SECURITY_CONFIG.injectionPatterns) {
            sanitized = sanitized.replace(pattern, '[REDACTED]');
        }

        // Remove instruction-like patterns
        const instructionPatterns = [
            /ignore\s+(?:all|previous|above|below)/gi,
            /override\s+(?:system|admin|previous)/gi,
            /new\s+(?:role|mission|goal)/gi,
            /forget\s+(?:all|everything)/gi
        ];

        for (const pattern of instructionPatterns) {
            sanitized = sanitized.replace(pattern, '[REDACTED]');
        }

        // Remove nested patterns
        sanitized = sanitized.replace(/\[.*\[.*\].*\]/g, '[REDACTED]');
        sanitized = sanitized.replace(/\(.*\(.*\).*\)/g, '(REDACTED)');
        sanitized = sanitized.replace(/\{.*\{.*\}.*\}/g, '{REDACTED}');
        sanitized = sanitized.replace(/<.*<.*>.*>/g, '<REDACTED>');

        // Truncate if too long
        if (sanitized.length > SECURITY_CONFIG.maxContentLength) {
            sanitized = sanitized.substring(0, SECURITY_CONFIG.maxContentLength) + '... [TRUNCATED]';
        }

        return sanitized;
    }

    /**
     * Log detection
     */
    async logDetection(sanitized, contentType, context) {
        try {
            await db.query(
                `INSERT INTO content_security_logs 
                 (content_type, flags, trust_score, is_safe, 
                  provenance, context, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    contentType,
                    JSON.stringify(sanitized.flags),
                    sanitized.trustScore,
                    sanitized.isSafe ? 1 : 0,
                    JSON.stringify(sanitized.provenance),
                    JSON.stringify(context)
                ]
            );

            // Store in memory
            this.detectionLogs.push({
                contentType,
                flags: sanitized.flags,
                trustScore: sanitized.trustScore,
                isSafe: sanitized.isSafe,
                timestamp: new Date().toISOString()
            });

            // Keep last 1000 logs
            if (this.detectionLogs.length > 1000) {
                this.detectionLogs = this.detectionLogs.slice(-1000);
            }
        } catch (error) {
            console.error('Log detection error:', error);
        }
    }

    /**
     * Get content trust score
     */
    getTrustScore(contentId) {
        if (this.trustScores.has(contentId)) {
            return this.trustScores.get(contentId);
        }
        return null;
    }

    /**
     * Check if content is safe for agent consumption
     */
    async isContentSafe(content, contentType, context = {}) {
        const sanitized = await this.sanitizeContent(content, contentType, context);
        return {
            isSafe: sanitized.isSafe,
            trustScore: sanitized.trustScore,
            sanitizedContent: sanitized.sanitized,
            flags: sanitized.flags
        };
    }

    /**
     * Update content provenance
     */
    async updateProvenance(contentId, source, trustScore, flags = []) {
        try {
            await db.query(
                `INSERT INTO content_provenance 
                 (content_id, source, trust_score, flags, last_updated)
                 VALUES (?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                 trust_score = ?, flags = ?, last_updated = NOW()`,
                [contentId, source, trustScore, JSON.stringify(flags), trustScore, JSON.stringify(flags)]
            );

            const cacheKey = `${contentId}:${source}`;
            this.contentProvenance.set(cacheKey, { trustScore });
        } catch (error) {
            console.error('Update provenance error:', error);
        }
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_logs,
                    SUM(CASE WHEN is_safe = 1 THEN 1 ELSE 0 END) as safe_count,
                    SUM(CASE WHEN is_safe = 0 THEN 1 ELSE 0 END) as unsafe_count,
                    AVG(trust_score) as avg_trust_score,
                    COUNT(DISTINCT content_type) as content_types
                 FROM content_security_logs
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                ...stats[0],
                unsafe_rate: stats[0].total_logs > 0 
                    ? ((stats[0].unsafe_count / stats[0].total_logs) * 100).toFixed(2) + '%'
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
            contentCache: this.contentCache.size,
            trustScores: this.trustScores.size,
            detectionLogs: this.detectionLogs.length,
            contentProvenance: this.contentProvenance.size,
            config: SECURITY_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new ContentSecurityService();