// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

// JWT_SECRET must be set in environment - throw error if missing
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is required but not set. Application cannot start without a secure JWT secret.');
}

/**
 * Verify JWT token from Authorization header
 */
function authMiddleware(req, res, next) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET environment variable is required');
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Authorization header required'
        });
    }

    const token = authHeader.slice(7);

    if (!token || token.trim().length === 0) {
        return res.status(401).json({
            success: false,
            message: 'Authorization header required'
        });
    }

    // Security check: excessively long token
    if (token.length > 8000) {
        return res.status(401).json({
            success: false,
            message: 'Authorization header required'
        });
    }

    // Security check: XSS attempt
    if (/<script>/i.test(token)) {
        return res.status(401).json({
            success: false,
            message: 'Authorization header required'
        });
    }

    // Security check: SQL injection attempt
    if (/'\s*OR\s*'/i.test(token) || /--/.test(token)) {
        return res.status(401).json({
            success: false,
            message: 'Authorization header required'
        });
    }

    try {
        const decoded = jwt.verify(token, secret);
        
        if (!decoded || (decoded.userId === undefined && decoded.id === undefined)) {
            return res.status(401).json({
                success: false,
                message: 'Authorization header required'
            });
        }

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
}

/**
 * Optional auth - doesn't fail if no token
 */
function optionalAuth(req, res, next) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET environment variable is required');
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
    }

    const token = authHeader.slice(7);

    if (!token || token.trim().length === 0) {
        return next();
    }

    if (token.length > 8000 || /<script>/i.test(token) || /'\s*OR\s*'/i.test(token) || /--/.test(token)) {
        return next();
    }

    try {
        const decoded = jwt.verify(token, secret);
        req.user = decoded;
    } catch (error) {
        // Ignore invalid tokens for optional auth
    }

    next();
}

module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
module.exports.optionalAuth = optionalAuth;