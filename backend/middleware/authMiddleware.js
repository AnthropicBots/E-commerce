// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const refreshTokenService = require('../services/refreshTokenService');

// Importing the token contract validates the token configuration, so a missing
// or reused secret stops the process at startup instead of surfacing as a
// mysterious 401 on the first protected request.
const {
    COOKIE_NAMES,
    assertAccessTokenSecret,
    hasSubjectClaim,
    verifyAccessToken
} = require('../utils/tokens');

/**
 * Verify JWT token from Authorization header or cookies fallback.
 * Also rejects tokens whose refresh-token family / jti was revoked (#1261).
 */
async function authMiddleware(req, res, next) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET environment variable is required');
    }

    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    } else if (req.cookies && req.cookies[COOKIE_NAMES.accessToken]) {
        token = req.cookies[COOKIE_NAMES.accessToken];
    }

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

        // Revocation cascade checks (family + access jti blacklist)
        if (decoded.jti && await refreshTokenService.isAccessJtiRevoked(decoded.jti)) {
            return res.status(401).json({
                success: false,
                message: 'Token has been revoked',
                errorCode: 'ACCESS_TOKEN_REVOKED'
            });
        }

        if (decoded.fid && await refreshTokenService.isFamilyRevoked(decoded.fid)) {
            return res.status(401).json({
                success: false,
                message: 'Session revoked due to security event. Please login again.',
                errorCode: 'TOKEN_FAMILY_REVOKED'
            });
        }

        req.user = decoded;
        req.tokenFamilyId = decoded.fid || null;
        req.tokenJti = decoded.jti || null;
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
async function optionalAuth(req, res, next) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET environment variable is required');
    }

    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    } else if (req.cookies && req.cookies[COOKIE_NAMES.accessToken]) {
        token = req.cookies[COOKIE_NAMES.accessToken];
    }

    if (!token || token.trim().length === 0) {
        return next();
    }

    if (token.length > 8000 || /<script>/i.test(token) || /'\s*OR\s*'/i.test(token) || /--/.test(token)) {
        return next();
    }

    try {
        const decoded = jwt.verify(token, secret);

        if (decoded.jti && await refreshTokenService.isAccessJtiRevoked(decoded.jti)) {
            return next();
        }
        if (decoded.fid && await refreshTokenService.isFamilyRevoked(decoded.fid)) {
            return next();
        }

        req.user = decoded;
        req.tokenFamilyId = decoded.fid || null;
        req.tokenJti = decoded.jti || null;
    } catch (error) {
        // Ignore invalid tokens for optional auth
    }

    next();
}

/**
 * Attach device fingerprint to request for downstream matching
 */
function attachDeviceFingerprint(req, res, next) {
    const ip = req.ip
        || req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
        || req.connection?.remoteAddress
        || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || '';
    req.deviceFingerprint = refreshTokenService.buildDeviceFingerprint(userAgent, ip);
    req.clientIp = ip;
    next();
}

module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
module.exports.optionalAuth = optionalAuth;
module.exports.attachDeviceFingerprint = attachDeviceFingerprint;
