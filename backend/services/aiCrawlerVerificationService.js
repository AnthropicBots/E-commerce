// backend/services/aiCrawlerVerificationService.js
const crypto = require('crypto');
const db = require('../config/db').promise;


// ============================================
// CONFIGURATION
// ============================================

const CRAWLER_CONFIG = {
    // Cryptographic verification
    signatureHeader: 'X-AI-Crawler-Signature',
    timestampHeader: 'X-AI-Crawler-Timestamp',
    nonceHeader: 'X-AI-Crawler-Nonce',
    signatureTTL: 300, // 5 minutes
    
    // Trusted AI crawlers
    trustedCrawlers: [
        'ChatGPT-User',
        'ClaudeBot',
        'PerplexityBot',
        'Googlebot',
        'Bingbot',
        'Applebot',
        'DuckDuckBot',
        'YandexBot',
        'Baiduspider'
    ],
    
    // Verification providers
    verificationProviders: [
        'openai',      // ChatGPT
        'anthropic',   // Claude
        'perplexity',  // Perplexity
        'google',      // Google
        'microsoft'    // Bing
    ],
    
    // IP reputation
    ipReputationThreshold: 50,
    maxRequestsPerMinute: 60,
    suspiciousIPPatterns: [
        /^10\./,        // Private IP
        /^172\.16\./,   // Private IP
        /^192\.168\./,  // Private IP
        /^127\./        // Localhost
    ]
};

// ============================================
// AI CRAWLER VERIFICATION CLASS
// ============================================

class AICrawlerVerification {
    constructor() {
        this.crawlerSessions = new Map();
        this.ipReputation = new Map();
        this.verificationCache = new Map();
        this.suspiciousIPs = new Set();
    }

    /**
     * Verify AI crawler identity
     */
    async verifyCrawler(req) {
        const userAgent = req.headers['user-agent'] || '';
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const signature = req.headers[CRAWLER_CONFIG.signatureHeader.toLowerCase()];
        const timestamp = req.headers[CRAWLER_CONFIG.timestampHeader.toLowerCase()];
        const nonce = req.headers[CRAWLER_CONFIG.nonceHeader.toLowerCase()];

        const verification = {
            isVerified: false,
            crawlerType: null,
            confidence: 0,
            flags: [],
            details: {}
        };

        // 1. Check if it's a known crawler
        const crawlerType = this.detectCrawlerType(userAgent);
        if (!crawlerType) {
            verification.flags.push({
                type: 'unknown_crawler',
                severity: 'medium',
                details: 'Unknown or unrecognized crawler'
            });
            return verification;
        }

        verification.crawlerType = crawlerType;

        // 2. Cryptographic signature verification
        if (signature && timestamp && nonce) {
            const signatureValid = await this.verifySignature(
                crawlerType,
                signature,
                timestamp,
                nonce,
                req.body
            );
            
            if (signatureValid) {
                verification.isVerified = true;
                verification.confidence = 95;
                verification.details.signature = 'valid';
                return verification;
            }
        }

        // 3. IP reputation check
        const ipReputation = await this.checkIPReputation(ip);
        if (ipReputation.score < CRAWLER_CONFIG.ipReputationThreshold) {
            verification.flags.push({
                type: 'poor_ip_reputation',
                severity: 'high',
                details: `IP reputation score: ${ipReputation.score}`
            });
            verification.confidence -= 30;
        }

        // 4. Behavior validation
        const behaviorValid = await this.validateCrawlerBehavior(req, crawlerType);
        if (!behaviorValid.isValid) {
            verification.flags.push({
                type: 'suspicious_behavior',
                severity: 'high',
                details: behaviorValid.reason
            });
            verification.confidence -= 40;
        }

        // 5. Provider verification
        const providerVerified = await this.verifyWithProvider(crawlerType, ip);
        if (providerVerified) {
            verification.isVerified = true;
            verification.confidence += 30;
            verification.details.provider = 'verified';
            return verification;
        }

        // 6. Check cache
        const cacheKey = `${crawlerType}:${ip}`;
        if (this.verificationCache.has(cacheKey)) {
            const cached = this.verificationCache.get(cacheKey);
            if (cached.expiry > Date.now()) {
                verification.isVerified = cached.isVerified;
                verification.confidence = cached.confidence;
                verification.details.cached = true;
                return verification;
            }
        }

        // 7. Determine final verification
        verification.confidence = Math.max(0, Math.min(100, verification.confidence));
        verification.isVerified = verification.confidence > 60;

        // Cache the result
        this.verificationCache.set(cacheKey, {
            isVerified: verification.isVerified,
            confidence: verification.confidence,
            expiry: Date.now() + 3600000 // 1 hour
        });

        return verification;
    }

    /**
     * Detect crawler type from User-Agent
     */
    detectCrawlerType(userAgent) {
        const crawlerPatterns = {
            'ChatGPT-User': /ChatGPT-User/i,
            'ClaudeBot': /ClaudeBot/i,
            'PerplexityBot': /PerplexityBot/i,
            'Googlebot': /Googlebot/i,
            'Bingbot': /Bingbot/i,
            'Applebot': /Applebot/i,
            'DuckDuckBot': /DuckDuckBot/i,
            'YandexBot': /YandexBot/i,
            'Baiduspider': /Baiduspider/i
        };

        for (const [crawler, pattern] of Object.entries(crawlerPatterns)) {
            if (pattern.test(userAgent)) {
                return crawler;
            }
        }

        // Check if it's an AI crawler not in our list
        if (/ai|bot|crawler|spider|scraper/i.test(userAgent)) {
            return 'UnknownAI';
        }

        return null;
    }

    /**
     * Verify cryptographic signature
     */
    async verifySignature(crawlerType, signature, timestamp, nonce, body) {
        try {
            // Check timestamp freshness
            const requestTime = parseInt(timestamp);
            if (isNaN(requestTime)) {
                return false;
            }

            const now = Date.now();
            if (Math.abs(now - requestTime) > CRAWLER_CONFIG.signatureTTL * 1000) {
                return false;
            }

            // Get crawler secret
            const secret = await this.getCrawlerSecret(crawlerType);
            if (!secret) {
                return false;
            }

            // Generate expected signature
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(`${crawlerType}:${timestamp}:${nonce}:${JSON.stringify(body || {})}`)
                .digest('hex');

            // Compare signatures (timing-safe)
            return crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            );
        } catch (error) {
            console.error('Signature verification error:', error);
            return false;
        }
    }

    /**
     * Get crawler secret
     */
    async getCrawlerSecret(crawlerType) {
        // In production, fetch from secure vault
        const secrets = {
            'ChatGPT-User': process.env.OPENAI_CRAWLER_SECRET || 'default_openai_secret',
            'ClaudeBot': process.env.ANTHROPIC_CRAWLER_SECRET || 'default_anthropic_secret',
            'PerplexityBot': process.env.PERPLEXITY_CRAWLER_SECRET || 'default_perplexity_secret'
        };

        return secrets[crawlerType] || null;
    }

    /**
     * Check IP reputation
     */
    async checkIPReputation(ip) {
        // Check cache
        if (this.ipReputation.has(ip)) {
            return this.ipReputation.get(ip);
        }

        let score = 100;
        const flags = [];

        // Check against suspicious patterns
        for (const pattern of CRAWLER_CONFIG.suspiciousIPPatterns) {
            if (pattern.test(ip)) {
                score -= 30;
                flags.push('private_ip');
                break;
            }
        }

        // Check database for IP history
        try {
            const [history] = await db.query(
                `SELECT COUNT(*) as count, 
                        SUM(CASE WHEN verified = false THEN 1 ELSE 0 END) as suspicious_count
                 FROM crawler_verification_logs 
                 WHERE ip_address = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`,
                [ip]
            );

            if (history[0].suspicious_count > 5) {
                score -= 20;
                flags.push('multiple_failures');
            }

            if (history[0].count > 100) {
                score -= 10;
                flags.push('high_volume');
            }
        } catch (error) {
            console.error('IP history check error:', error);
        }

        // Check rate limiting
        const requestsInMinute = await this.getRequestsInMinute(ip);
        if (requestsInMinute > CRAWLER_CONFIG.maxRequestsPerMinute) {
            score -= 20;
            flags.push('rate_limit_exceeded');
        }

        const result = {
            score: Math.max(0, Math.min(100, score)),
            flags,
            lastChecked: new Date().toISOString()
        };

        this.ipReputation.set(ip, result);
        return result;
    }

    /**
     * Get requests in minute
     */
    async getRequestsInMinute(ip) {
        // In production, use Redis counter
        // Simplified: check database
        try {
            const [result] = await db.query(
                'SELECT COUNT(*) as count FROM crawler_verification_logs WHERE ip_address = ? AND timestamp > DATE_SUB(NOW(), INTERVAL 1 MINUTE)',
                [ip]
            );
            return result[0]?.count || 0;
        } catch (error) {
            console.error('Rate check error:', error);
            return 0;
        }
    }

    /**
     * Validate crawler behavior
     */
    async validateCrawlerBehavior(req, crawlerType) {
        const userAgent = req.headers['user-agent'] || '';
        const acceptHeader = req.headers['accept'] || '';
        const acceptLanguage = req.headers['accept-language'] || '';

        const issues = [];

        // Check User-Agent consistency
        if (crawlerType && !userAgent.includes(crawlerType)) {
            issues.push('User-Agent does not match detected crawler');
        }

        // Check for typical browser headers (non-bot behavior)
        if (acceptHeader.includes('text/html') && 
            acceptHeader.includes('application/xhtml+xml') &&
            !userAgent.includes('bot') && !userAgent.includes('crawler')) {
            issues.push('Suspicious: Browser-like headers from crawler');
        }

        // Check for missing typical crawler headers
        const crawlerHeaders = [
            'Accept-Encoding',
            'Accept-Language',
            'Connection'
        ];

        for (const header of crawlerHeaders) {
            if (!req.headers[header.toLowerCase()]) {
                issues.push(`Missing header: ${header}`);
            }
        }

        return {
            isValid: issues.length < 2,
            issues,
            reason: issues.length > 0 ? issues.join('; ') : 'Valid'
        };
    }

    /**
     * Verify with provider
     */
    async verifyWithProvider(crawlerType, ip) {
        try {
            // This would call provider APIs to verify the crawler
            // For now, we'll check against known IP ranges
            
            // OpenAI IP ranges (example)
            const openaiRanges = [
                '20.42.0.0/16',
                '20.43.0.0/16',
                '20.44.0.0/16'
            ];

            // Anthropic IP ranges (example)
            const anthropicRanges = [
                '34.64.0.0/16',
                '34.65.0.0/16'
            ];

            // Check if IP is in provider ranges
            const providers = {
                'ChatGPT-User': openaiRanges,
                'ClaudeBot': anthropicRanges,
                'PerplexityBot': [] // Perplexity ranges
            };

            const ranges = providers[crawlerType] || [];
            for (const range of ranges) {
                if (this.ipInRange(ip, range)) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error('Provider verification error:', error);
            return false;
        }
    }

    /**
     * Check if IP is in CIDR range
     */
    ipInRange(ip, cidr) {
        const [range, bits] = cidr.split('/');
        const mask = ~(Math.pow(2, 32 - parseInt(bits)) - 1);
        const ipNum = this.ipToNumber(ip);
        const rangeNum = this.ipToNumber(range);
        
        return (ipNum & mask) === (rangeNum & mask);
    }

    /**
     * Convert IP to number
     */
    ipToNumber(ip) {
        const parts = ip.split('.');
        return (parseInt(parts[0]) << 24) |
               (parseInt(parts[1]) << 16) |
               (parseInt(parts[2]) << 8) |
               parseInt(parts[3]);
    }

    /**
     * Log verification attempt
     */
    async logVerification(req, verification) {
        try {
            await db.query(
                `INSERT INTO crawler_verification_logs 
                 (ip_address, user_agent, crawler_type, is_verified, 
                  confidence, flags, details, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    req.ip || req.connection.remoteAddress || 'unknown',
                    req.headers['user-agent'] || 'unknown',
                    verification.crawlerType,
                    verification.isVerified ? 1 : 0,
                    verification.confidence,
                    JSON.stringify(verification.flags),
                    JSON.stringify(verification.details)
                ]
            );
        } catch (error) {
            console.error('Log verification error:', error);
        }
    }

    /**
     * Get crawler statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_attempts,
                    SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_count,
                    SUM(CASE WHEN is_verified = 0 THEN 1 ELSE 0 END) as suspicious_count,
                    AVG(confidence) as avg_confidence,
                    COUNT(DISTINCT ip_address) as unique_ips,
                    COUNT(DISTINCT crawler_type) as unique_crawlers
                 FROM crawler_verification_logs
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                ...stats[0],
                verified_rate: stats[0].total_attempts > 0 
                    ? ((stats[0].verified_count / stats[0].total_attempts) * 100).toFixed(2) + '%'
                    : '0%',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    /**
     * Get suspicious IPs
     */
    async getSuspiciousIPs(limit = 50) {
        try {
            const [results] = await db.query(
                `SELECT 
                    ip_address,
                    COUNT(*) as attempts,
                    SUM(CASE WHEN is_verified = 0 THEN 1 ELSE 0 END) as failures,
                    AVG(confidence) as avg_confidence,
                    MAX(timestamp) as last_attempt
                 FROM crawler_verification_logs
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
                 GROUP BY ip_address
                 HAVING failures > 5
                 ORDER BY failures DESC
                 LIMIT ?`,
                [limit]
            );

            return results;
        } catch (error) {
            console.error('Suspicious IPs error:', error);
            throw error;
        }
    }

    /**
     * Block suspicious IP
     */
    async blockIP(ip, reason) {
        this.suspiciousIPs.add(ip);
        
        await db.query(
            `INSERT INTO blocked_ips (ip_address, reason, blocked_at)
             VALUES (?, ?, NOW())`,
            [ip, reason]
        );

        console.log(`🚫 IP blocked: ${ip} - ${reason}`);
    }

    /**
     * Get crawler verification status
     */
    getStatus() {
        return {
            verificationCache: this.verificationCache.size,
            ipReputation: this.ipReputation.size,
            suspiciousIPs: this.suspiciousIPs.size,
            configuration: {
                signatureTTL: CRAWLER_CONFIG.signatureTTL,
                ipReputationThreshold: CRAWLER_CONFIG.ipReputationThreshold,
                maxRequestsPerMinute: CRAWLER_CONFIG.maxRequestsPerMinute
            }
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new AICrawlerVerification();