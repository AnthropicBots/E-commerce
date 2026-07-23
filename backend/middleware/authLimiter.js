const rateLimit = require("express-rate-limit");

// =====================
// AUTH LIMITER - For login/register (20 requests per 15 min)
// =====================
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 requests
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        errorCode: "AUTH_RATE_LIMIT_EXCEEDED",
        message: "Too many authentication attempts. Please try again after 15 minutes."
    }
});

// =====================
// ADMIN LIMITER - For admin endpoints (100 requests per 15 min)
// =====================
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        errorCode: "ADMIN_RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again after 15 minutes."
    }
});

module.exports = {
    authLimiter,
    adminLimiter
};