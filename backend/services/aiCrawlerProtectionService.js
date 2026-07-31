// backend/services/aiCrawlerProtectionService.js
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// AI CRAWLER CONFIGURATION
// ============================================

const CRAWLER_CONFIG = {
    // Rate limiting
    rateLimit: {
        windowMs: 60000, // 1 minute
        maxRequests: 30, // 30 requests per minute
        burstLimit: 50
    },
    // Bot detection
    botPatterns: [
        /bot/i,
        /crawler/i,
        /spider/i,
        /scraper/i,
        /ClaudeBot/i,
        /ChatGPT-User/i,
        /PerplexityBot/i,
        /Googlebot/i,
        /Bingbot/i,
        /GPTBot/i
    ],
    // Blocked bots
    blockedBots: [
        /malicious/i,
        /scraping/i,
        /harvest/i
    ],
    // Whitelisted bots
    whitelistedBots: [
        /googlebot/i,
        /bingbot/i,
        /yandexbot/i,
        /duckduckbot/i
    ],
    // IP reputation
    ipReputation: {
        maxRequestsPerDay: 500,
        suspiciousThreshold: 50,
        blockThreshold: 100
    }
};

// ============================================
// AI CRAWLER PROTECTION SERVICE
// ============================================

class AICrawlerProtectionService extends EventEmitter {
    constructor() {
        super();
        this.crawlerTraffic = new Map();
        this.ipReputation = new Map();
        this.botRegistry = new Map();
        this.blockedIPs = new Set();
        this.isInitialized = false;
        this.cleanupInterval = null;
    }

    /**
     * Initialize crawler protection
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load blocked IPs from database
        await this.loadBlockedIPs();

        // Start cleanup interval
        this.cleanupInterval = setInterval(() => this.cleanupTraffic(), 300000); // 5 minutes

        this.isInitialized = true;
        console.log('✅ AI Crawler Protection Service initialized');
        return this;
    }

    /**
     * Detect if request is from an AI crawler
     */
    detectCrawler(req) {
        const userAgent = req.headers['user-agent'] || '';
        const ip = req.ip || req.connection.remoteAddress || 'unknown';

        // Check if IP is blocked
        if (this.blockedIPs.has(ip)) {
            return {
                isCrawler: true,
                isBlocked: true,
                reason: 'IP blocked',
                type: 'blocked'
            };
        }

        // Check for blocked bot patterns
        for (const pattern of CRAWLER_CONFIG.blockedBots) {
            if (pattern.test(userAgent)) {
                return {
                    isCrawler: true,
                    isBlocked: true,
                    reason: 'Blocked bot pattern',
                    type: 'blocked_bot',
                    pattern: pattern.toString()
                };
            }
        }

        // Check for whitelisted bots
        for (const pattern of CRAWLER_CONFIG.whitelistedBots) {
            if (pattern.test(userAgent)) {
                return {
                    isCrawler: false,
                    isWhitelisted: true,
                    type: 'whitelisted'
                };
            }
        }

        // Check for AI crawler patterns
        for (const pattern of CRAWLER_CONFIG.botPatterns) {
            if (pattern.test(userAgent)) {
                return {
                    isCrawler: true,
                    isBlocked: false,
                    type: 'ai_crawler',
                    userAgent: userAgent,
                    pattern: pattern.toString()
                };
            }
        }

        return { isCrawler: false };
    }

    /**
     * Check rate limit for crawler
     */
    checkRateLimit(req) {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const key = `crawler_${ip}`;
        const now = Date.now();

        // Get traffic data
        let traffic = this.crawlerTraffic.get(key);
        if (!traffic) {
            traffic = {
                requests: [],
                firstSeen: now,
                lastSeen: now,
                totalRequests: 0
            };
            this.crawlerTraffic.set(key, traffic);
        }

        // Clean old requests
        const windowStart = now - CRAWLER_CONFIG.rateLimit.windowMs;
        traffic.requests = traffic.requests.filter(t => t > windowStart);
        traffic.lastSeen = now;

        // Check rate limit
        if (traffic.requests.length >= CRAWLER_CONFIG.rateLimit.maxRequests) {
            return {
                allowed: false,
                limit: CRAWLER_CONFIG.rateLimit.maxRequests,
                current: traffic.requests.length,
                retryAfter: Math.ceil(CRAWLER_CONFIG.rateLimit.windowMs / 1000),
                ip
            };
        }

        traffic.totalRequests++;

        // Add current request
        traffic.requests.push(now);

        return {
            allowed: true,
            current: traffic.requests.length,
            ip
        };
    }

    /**
     * Check IP reputation
     */
    checkIPReputation(req) {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';

        let reputation = this.ipReputation.get(ip);
        if (!reputation) {
            reputation = {
                requests: 0,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                violations: 0,
                score: 100
            };
            this.ipReputation.set(ip, reputation);
        }

        reputation.requests++;
        reputation.lastSeen = Date.now();

        // Check daily limit
        const dailyRequests = this.getDailyRequests(ip);
        if (dailyRequests > CRAWLER_CONFIG.ipReputation.maxRequestsPerDay) {
            reputation.score -= 20;
            return {
                suspicious: true,
                score: reputation.score,
                reason: 'Daily request limit exceeded',
                dailyRequests
            };
        }

        // Calculate score based on violation history
        if (reputation.violations > 5) {
            reputation.score -= 10;
        }

        if (reputation.violations > 10) {
            reputation.score -= 20;
        }

        const isSuspicious = reputation.score < CRAWLER_CONFIG.ipReputation.suspiciousThreshold;
        const isBlocked = reputation.score < CRAWLER_CONFIG.ipReputation.blockThreshold;

        if (isBlocked) {
            this.blockedIPs.add(ip);
        }

        return {
            suspicious: isSuspicious,
            blocked: isBlocked,
            score: reputation.score,
            violations: reputation.violations,
            dailyRequests
        };
    }

    /**
     * Get daily requests for IP
     */
    getDailyRequests(ip) {
        const key = `daily_${ip}`;
        const daily = this.crawlerTraffic.get(key);
        if (!daily) return 0;

        const now = Date.now();
        const dayStart = now - 24 * 60 * 60 * 1000;
        return daily.requests.filter(t => t > dayStart).length;
    }

    /**
     * Block an IP
     */
    async blockIP(ip, reason) {
        this.blockedIPs.add(ip);

        await this.storeBlockedIP(ip, reason);

        console.log(`🚫 IP blocked: ${ip} - ${reason}`);
        this.emit('ip.blocked', { ip, reason });

        return true;
    }

    /**
     * Unblock an IP
     */
    async unblockIP(ip) {
        this.blockedIPs.delete(ip);

        await this.removeBlockedIP(ip);

        console.log(`✅ IP unblocked: ${ip}`);
        this.emit('ip.unblocked', { ip });

        return true;
    }

    /**
     * Record violation for IP
     */
    recordViolation(req, type) {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const reputation = this.ipReputation.get(ip);
        if (reputation) {
            reputation.violations++;
            reputation.score = Math.max(0, reputation.score - 10);
        }
    }

    /**
     * Clean up old traffic data
     */
    cleanupTraffic() {
        const now = Date.now();
        const windowStart = now - CRAWLER_CONFIG.rateLimit.windowMs;
        const dayStart = now - 24 * 60 * 60 * 1000;

        for (const [key, data] of this.crawlerTraffic) {
            data.requests = data.requests.filter(t => t > windowStart);
            if (data.requests.length === 0 && (now - data.lastSeen) > 3600000) {
                this.crawlerTraffic.delete(key);
            }
        }

        // Clean IP reputation
        for (const [ip, data] of this.ipReputation) {
            if ((now - data.lastSeen) > 7 * 24 * 60 * 60 * 1000) {
                this.ipReputation.delete(ip);
            }
        }
    }

    /**
     * Get crawler statistics
     */
    async getStatistics() {
        const totalRequests = Array.from(this.crawlerTraffic.values())
            .reduce((sum, data) => sum + data.totalRequests, 0);

        return {
            totalCrawlers: this.crawlerTraffic.size,
            totalRequests,
            blockedIPs: this.blockedIPs.size,
            activeBots: Array.from(this.crawlerTraffic.keys()).length,
            ipReputation: this.ipReputation.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get blocked IPs
     */
    getBlockedIPs() {
        return Array.from(this.blockedIPs);
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadBlockedIPs() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM blocked_ips WHERE expires_at > NOW() OR expires_at IS NULL'
            );

            for (const row of rows) {
                this.blockedIPs.add(row.ip_address);
            }

            console.log(`🚫 Loaded ${this.blockedIPs.size} blocked IPs`);
        } catch (error) {
            console.error('Load blocked IPs error:', error);
        }
    }

    async storeBlockedIP(ip, reason) {
        try {
            await db.query(
                `INSERT INTO blocked_ips (ip_address, reason, blocked_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE reason = VALUES(reason), blocked_at = NOW()`,
                [ip, reason]
            );
        } catch (error) {
            console.error('Store blocked IP error:', error);
        }
    }

    async removeBlockedIP(ip) {
        try {
            await db.query(
                'DELETE FROM blocked_ips WHERE ip_address = ?',
                [ip]
            );
        } catch (error) {
            console.error('Remove blocked IP error:', error);
        }
    }

    // ============================================
    // STATUS
    // ============================================

    getStatus() {
        return {
            initialized: this.isInitialized,
            activeCrawlers: this.crawlerTraffic.size,
            blockedIPs: this.blockedIPs.size,
            ipReputation: this.ipReputation.size
        };
    }

    /**
     * Shutdown service
     */
    shutdown() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        console.log('⏹️ AI Crawler Protection Service shut down');
    }
}

// ============================================
// CRAWLER PROTECTION MIDDLEWARE
// ============================================

/**
 * Middleware to protect against AI crawlers
 */
async function protectAgainstCrawlers(req, res, next) {
    const crawlerService = require('./aiCrawlerProtectionService').crawlerService;

    // Skip for static assets
    if (req.path.startsWith('/assets/') || 
        req.path.startsWith('/static/') ||
        req.path === '/health' ||
        req.path === '/robots.txt') {
        return next();
    }

    // Detect crawler
    const detection = crawlerService.detectCrawler(req);

    // Block if detected
    if (detection.isBlocked) {
        crawlerService.recordViolation(req, 'blocked_bot');
        return res.status(403).json({
            success: false,
            error: 'Access denied',
            reason: detection.reason,
            timestamp: new Date().toISOString()
        });
    }

    // Apply rate limiting for crawlers
    if (detection.isCrawler) {
        const rateLimit = crawlerService.checkRateLimit(req);

        if (!rateLimit.allowed) {
            crawlerService.recordViolation(req, 'rate_limit_exceeded');
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded',
                retryAfter: rateLimit.retryAfter,
                limit: rateLimit.limit,
                current: rateLimit.current,
                timestamp: new Date().toISOString()
            });
        }

        // Check IP reputation
        const reputation = crawlerService.checkIPReputation(req);

        if (reputation.blocked) {
            await crawlerService.blockIP(req.ip, 'Poor reputation score');
            return res.status(403).json({
                success: false,
                error: 'IP blocked due to poor reputation',
                reason: 'reputation_blocked',
                timestamp: new Date().toISOString()
            });
        }

        // Add crawler headers
        res.setHeader('X-Crawler-Detected', 'true');
        res.setHeader('X-RateLimit-Remaining', CRAWLER_CONFIG.rateLimit.maxRequests - rateLimit.current);
        res.setHeader('X-RateLimit-Reset', Math.ceil(CRAWLER_CONFIG.rateLimit.windowMs / 1000));
    }

    next();
}

// ============================================
// EXPORT
// ============================================

const crawlerService = new AICrawlerProtectionService();

module.exports = {
    AICrawlerProtectionService,
    crawlerService,
    protectAgainstCrawlers,
    CRAWLER_CONFIG
};