// backend/middleware/aiCrawlerMiddleware.js
const aiCrawlerVerification = require('../services/aiCrawlerVerificationService');
// config/db exports the pool itself, with named helpers hung off it -- there is
// no `db` property. Destructuring one bound undefined, so the first statement of
// blockSuspiciousIPs threw a TypeError on every call and the catch below fell
// through to next(): the blocklist and the reputation gate were both unreachable
// (#1675). `.promise` is how the rest of the codebase reaches the pool.
const db = require("../config/db").promise;
const logger = require("../utils/logger");

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
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';

        // Is this address currently blocked?
        //
        // The predicate reads the columns the table actually keeps. It used to
        // be `blocked_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`, a fixed window
        // that ignored all four of them:
        //
        //   * expires_at    -- the column that says when a block ends. A block
        //                      set to run for thirty days stopped after seven.
        //   * is_permanent  -- a permanent block silently expired after seven
        //                      days too.
        //   * unblocked_at  -- an address an operator had explicitly unblocked
        //                      stayed blocked for the rest of the window.
        //   * deleted_at    -- soft-deleted rows kept blocking.
        //
        // NULL expires_at means "no expiry set", which is a live block, so the
        // check has to admit NULL rather than compare it.
        const [blocked] = await db.query(
            `SELECT reason, blocked_at, expires_at, is_permanent
               FROM blocked_ips
              WHERE ip_address = ?
                AND unblocked_at IS NULL
                AND deleted_at IS NULL
                AND (is_permanent = TRUE OR expires_at IS NULL OR expires_at > NOW())
              LIMIT 1`,
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
        // Failing open on an infrastructure fault is deliberate: an unreachable
        // database must not take the site down. What was not deliberate is that
        // this ran on every single request because of a programming error, so
        // the gate was permanently open and the only signal was a console line
        // that never reached the configured log streams.
        logger.error(`IP blocking check failed for ${req.ip || 'unknown'}: ${error.message}`);
        next();
    }
}

module.exports = {
    verifyAICrawler,
    verifySpecificCrawler,
    blockSuspiciousIPs
};