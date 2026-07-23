// backend/middleware/botProtectionMiddleware.js
const botDetectionService = require('../services/botDetectionService');

/**
 * Middleware to detect and block bots
 */
async function detectBot(req, res, next) {
    try {
        // Skip detection for health checks and static files
        if (req.path === '/health' || req.path.startsWith('/static/') || req.path.startsWith('/assets/')) {
            return next();
        }

        // Detect bot
        const detection = await botDetectionService.detectBot(req);

        // Store detection result
        req.botDetection = detection;

        // If bot detected, block or challenge
        if (detection.isBot) {
            // Add headers for response
            res.setHeader('X-Bot-Detected', 'true');
            res.setHeader('X-Bot-Confidence', detection.confidence);

            // Block critical paths
            if (req.path.includes('/checkout') || req.path.includes('/payment')) {
                return res.status(403).json({
                    success: false,
                    error: 'Bot detected. Access denied.',
                    confidence: detection.confidence,
                    factors: detection.factors
                });
            }

            // For non-critical paths, serve with CAPTCHA challenge
            if (detection.confidence > 70) {
                return res.status(403).json({
                    success: false,
                    error: 'Bot detected. Please complete CAPTCHA.',
                    confidence: detection.confidence,
                    requiresCaptcha: true
                });
            }

            // Rate limit for suspicious requests
            if (detection.confidence > 50) {
                const rateLimit = botDetectionService.getRateLimit(req.ip);
                if (rateLimit < 10) {
                    return res.status(429).json({
                        success: false,
                        error: 'Too many requests. Please slow down.',
                        retryAfter: 60
                    });
                }
            }
        }

        // Add detection to request for downstream use
        req.botDetection = detection;
        
        next();
    } catch (error) {
        console.error('Bot detection error:', error);
        // Fail open - allow request but log
        next();
    }
}

/**
 * Middleware to add bot detection headers
 */
function addBotDetectionHeaders(req, res, next) {
    res.setHeader('X-Bot-Protection', 'enabled');
    res.setHeader('X-Bot-Protection-Version', '1.0.0');
    next();
}

module.exports = {
    detectBot,
    addBotDetectionHeaders
};