// backend/middleware/aiCrawlerMiddleware.js
const aiCrawlerVerification = require('../services/aiCrawlerVerificationService');
const { db } = require("../config/db");

/**
 * Middleware to verify AI crawlers
 */
async function verifyAICrawler(req, res, next) {
    try {
        // Skip verification for non-API routes or specific paths
        if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth/')) {
            return next();
        }

        // Check if it's an AI crawler
        const userAgent = req.headers['user-agent'] || '';
        const isAICrawler = /bot|crawler|spider|scraper|ChatGPT|Claude|Perplexity/i.test(userAgent);

        if (!isAICrawler) {
            return next();
        }

        // Verify the crawler
        const verification = await aiCrawlerVerification.verifyCrawler(req);

        // Log the attempt
        await aiCrawlerVerification.logVerification(req, verification);

        // Store verification result
        req.crawlerVerification = verification;

        // Block if not verified and suspicious
        if (!verification.isVerified && verification.confidence < 30) {
            return res.status(403).json({
                success: false,
                error: 'Crawler verification failed',
                details: verification.flags,
                confidence: verification.confidence
            });
        }

        // Add verification headers to response
        res.setHeader('X-Crawler-Verified', verification.isVerified ? 'true' : 'false');
        res.setHeader('X-Crawler-Confidence', verification.confidence);

        next();
    } catch (error) {
        console.error('Crawler verification error:', error);
        next();
    }
}

/**
 * Middleware to verify specific crawlers
 */
async function verifySpecificCrawler(crawlerType) {
    return async function (req, res, next) {
        try {
            const userAgent = req.headers['user-agent'] || '';

            // Check if User-Agent matches target crawler
            const normalizedUserAgent = String(userAgent || "").toLowerCase();
            const normalizedCrawlerType = String(crawlerType || "").toLowerCase();

            if (!normalizedUserAgent.includes(normalizedCrawlerType)) {
                return next();
            }
            // Verify the crawler
            const verification = await aiCrawlerVerification.verifyCrawler(req);

            if (!verification.isVerified) {
                return res.status(403).json({
                    success: false,
                    error: `${crawlerType} verification failed`,
                    confidence: verification.confidence,
                    flags: verification.flags
                });
            }

            req.crawlerVerification = verification;
            next();
        } catch (error) {
            console.error(`${crawlerType} verification error:`, error);
            next();
        }
    };
}

/**
 * Middleware to block suspicious IPs
 */
async function blockSuspiciousIPs(req, res, next) {
    try {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';

        // Check if IP is blocked
        const [blocked] = await db.query(
            'SELECT * FROM blocked_ips WHERE ip_address = ? AND blocked_at > DATE_SUB(NOW(), INTERVAL 7 DAY)',
            [ip]
        );

        if (blocked.length > 0) {
            return res.status(403).json({
                success: false,
                error: 'IP address is blocked',
                reason: blocked[0].reason,
                blocked_at: blocked[0].blocked_at
            });
        }

        // Check IP reputation
        const reputation = await aiCrawlerVerification.checkIPReputation(ip);
        if (reputation.score < 20) {
            // Block the IP
            await aiCrawlerVerification.blockIP(ip, 'Poor reputation score');
            return res.status(403).json({
                success: false,
                error: 'IP address blocked due to poor reputation',
                reputationScore: reputation.score
            });
        }

        next();
    } catch (error) {
        console.error('IP blocking error:', error);
        next();
    }
}

module.exports = {
    verifyAICrawler,
    verifySpecificCrawler,
    blockSuspiciousIPs
};