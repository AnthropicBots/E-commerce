// src/config/rateLimiters.js
const rateLimit = require('express-rate-limit');

// Global API limiter - 120 requests per minute
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    errorCode: "API_RATE_LIMIT_EXCEEDED",
    message: "Too many API requests. Please slow down.",
  },
});

// Admin limiter - 100 requests per 15 minutes
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    errorCode: "ADMIN_RATE_LIMIT_EXCEEDED",
    message: "Too many admin requests. Please try again after 15 minutes.",
  },
});

// MCP specific rate limiter - stricter
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    errorCode: "MCP_RATE_LIMIT_EXCEEDED",
    message: "Too many MCP requests. Please try again after 1 minute.",
  },
});

module.exports = {
  apiLimiter,
  adminLimiter,
  mcpLimiter
};