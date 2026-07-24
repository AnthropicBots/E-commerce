// backend/middleware/scrapingRateLimiter.js
const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for scraping endpoints
 */
const scrapingRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: {
        success: false,
        error: 'Too many scraping requests. Please slow down.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Rate limiter for heavy scraping
 */
const heavyScrapingRateLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 requests per 5 minutes
    message: {
        success: false,
        error: 'Scraping rate limit exceeded. Please wait 5 minutes.',
        retryAfter: 300
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * IP-based rate limiter
 */
const ipRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => {
        return req.ip || req.connection.remoteAddress;
    },
    message: {
        success: false,
        error: 'IP rate limit exceeded. Please try again later.'
    }
});

module.exports = {
    scrapingRateLimiter,
    heavyScrapingRateLimiter,
    ipRateLimiter
};