// backend/middleware/behavioralCaptcha.js
const NodeCache = require('node-cache');
const captchaCache = new NodeCache({ stdTTL: 600 }); // 10 minutes TTL

// Rate limiting configuration
const RATE_LIMITS = {
    perSecond: 5,
    perMinute: 60,
    perHour: 300
};

/**
 * Behavioral CAPTCHA - detects bot-like patterns
 * Returns { passed: boolean, reason: string, score: number, retryAfter: number }
 */
function verifyHumanChallenge(req) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || '';
    const now = Date.now();

    // Get request history for this IP
    const requestHistory = captchaCache.get(ip) || [];
    
    // Filter recent requests
    const recentRequests = {
        lastSecond: requestHistory.filter(t => now - t < 1000),
        lastMinute: requestHistory.filter(t => now - t < 60000),
        lastHour: requestHistory.filter(t => now - t < 3600000)
    };

    // Check rate limits
    if (recentRequests.lastSecond.length > RATE_LIMITS.perSecond) {
        return {
            passed: false,
            reason: 'rate_limit_exceeded',
            score: 0,
            retryAfter: 5
        };
    }

    if (recentRequests.lastMinute.length > RATE_LIMITS.perMinute) {
        return {
            passed: false,
            reason: 'rate_limit_exceeded',
            score: 0,
            retryAfter: 60
        };
    }

    if (recentRequests.lastHour.length > RATE_LIMITS.perHour) {
        return {
            passed: false,
            reason: 'rate_limit_exceeded',
            score: 0,
            retryAfter: 3600
        };
    }

    // Check for known bot User-Agents
    if (isKnownBot(userAgent)) {
        console.warn(`🤖 Bot detected: ${userAgent} from IP ${ip}`);
        return {
            passed: false,
            reason: 'bot_detected',
            score: 0.1,
            retryAfter: 300
        };
    }

    // Calculate trust score
    const trustScore = calculateTrustScore(req, requestHistory);
    
    if (trustScore < 0.3) {
        return {
            passed: false,
            reason: 'low_trust_score',
            score: trustScore,
            retryAfter: 60
        };
    }

    // Add this request to history
    requestHistory.push(now);
    
    // Keep only last hour of requests
    const oneHourAgo = now - 3600000;
    const filteredHistory = requestHistory.filter(t => t > oneHourAgo);
    captchaCache.set(ip, filteredHistory);

    return {
        passed: true,
        reason: 'verified',
        score: trustScore,
        retryAfter: 0
    };
}

/**
 * Generate a fingerprint from request
 */
function generateFingerprint(req) {
    const components = [
        req.ip || req.connection?.remoteAddress || 'unknown',
        req.headers['user-agent'] || 'unknown',
        req.headers['accept-language'] || 'unknown',
        req.headers['accept-encoding'] || 'unknown'
    ];
    return components.join('|');
}

/**
 * Check if User-Agent is a known bot
 */
function isKnownBot(userAgent) {
    const botPatterns = [
        /bot/i,
        /crawler/i,
        /spider/i,
        /scraper/i,
        /headless/i,
        /puppeteer/i,
        /selenium/i,
        /playwright/i,
        /curl/i,
        /wget/i,
        /python/i,
        /postman/i,
        /insomnia/i
    ];
    
    return botPatterns.some(pattern => pattern.test(userAgent));
}

/**
 * Calculate trust score based on various factors
 */
function calculateTrustScore(req, history) {
    let score = 0.5; // Start with neutral score
    
    const userAgent = req.headers['user-agent'] || '';
    
    // +0.2 for common browsers
    if (/chrome|firefox|safari|edge/i.test(userAgent)) {
        score += 0.2;
    }
    
    // +0.1 for has Accept-Language
    if (req.headers['accept-language']) {
        score += 0.1;
    }
    
    // +0.1 for has Accept-Encoding
    if (req.headers['accept-encoding']) {
        score += 0.1;
    }
    
    // -0.1 for suspicious User-Agent
    if (isKnownBot(userAgent)) {
        score -= 0.2;
    }
    
    // -0.2 for too many requests in short time
    const now = Date.now();
    const recentRequests = history.filter(t => now - t < 5000);
    if (recentRequests.length > 10) {
        score -= 0.2;
    }
    
    // -0.1 for missing common headers
    if (!req.headers['accept']) {
        score -= 0.1;
    }
    
    // Clamp score between 0 and 1
    return Math.max(0, Math.min(1, score));
}

module.exports = {
    verifyHumanChallenge,
    generateFingerprint,
    isKnownBot,
    calculateTrustScore
};