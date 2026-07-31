// backend/middleware/authMiddleware.js
// Issue #1261: honor refresh-token family / user-level revocation cascade
const jwt = require('jsonwebtoken');

let redis = null;
try {
    redis = require('../config/redis');
} catch (err) {
    console.warn('Redis unavailable in authMiddleware:', err.message);
}

// JWT_SECRET must be set in environment - throw error if missing
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is required but not set. Application cannot start without a secure JWT secret.');
}

async function isFamilyRevoked(familyId) {
    if (!redis || !familyId) return false;
    try {
        return (await redis.exists(`rt:family:revoked:${familyId}`)) === 1;
    } catch (_) {
        return false;
    }
}

async function isUserForceReauth(userId, tokenIat) {
    if (!redis || !userId) return false;
    try {
        const raw = await redis.get(`auth:user:revoke_before:${userId}`);
        if (!raw) return false;
        const revokeBefore = Number(raw);
        if (!Number.isFinite(revokeBefore)) return false;
        // Access tokens issued at/before the cascade must be rejected
        const iat = Number(tokenIat) || 0;
        return iat <= revokeBefore;
    } catch (_) {
        return false;
    }
}

async function isJtiBlacklisted(jti) {
    if (!redis || !jti) return false;
    try {
        return (await redis.exists(`rt:jti:revoked:${jti}`)) === 1;
    } catch (_) {
        return false;
    }
}

/**
 * Verify JWT token from Authorization header or cookies fallback.
 * Also enforces Redis revocation list after refresh-token reuse cascade (#1261).
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
    } else if (req.cookies && req.cookies.accessToken) {
        token = req.cookies.accessToken;
    }

    if (!token || token.trim().length === 0) {
        return res.status(401).json({
            success: false,
            message: 'Authorization header required'
        });
    }

    if (token.length > 8000) {
        return res.status(401).json({
            success: false,
            message: 'Authorization header required'
        });
    }

    if (/<script>/i.test(token)) {
        return res.status(401).json({
            success: false,
            message: 'Authorization header required'
        });
    }

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

        const userId = decoded.id || decoded.userId;

        if (await isJtiBlacklisted(decoded.jti)) {
            return res.status(401).json({
                success: false,
                message: 'Token has been revoked',
                code: 'ACCESS_JTI_REVOKED'
            });
        }

        if (await isFamilyRevoked(decoded.familyId)) {
            return res.status(401).json({
                success: false,
                message: 'Session revoked due to refresh-token security event. Please log in again.',
                code: 'RT_FAMILY_REVOKED',
                securityAlarm: true
            });
        }

        if (await isUserForceReauth(userId, decoded.iat)) {
            return res.status(401).json({
                success: false,
                message: 'All sessions were revoked. Please log in again.',
                code: 'USER_SESSIONS_REVOKED',
                securityAlarm: true
            });
        }

        req.user = decoded;
        req.tokenFamilyId = decoded.familyId || null;
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
    } else if (req.cookies && req.cookies.accessToken) {
        token = req.cookies.accessToken;
    }

    if (!token || token.trim().length === 0) {
        return next();
    }

    if (token.length > 8000 || /<script>/i.test(token) || /'\s*OR\s*'/i.test(token) || /--/.test(token)) {
        return next();
    }

    try {
        const decoded = jwt.verify(token, secret);
        const userId = decoded.id || decoded.userId;

        if (
            (await isJtiBlacklisted(decoded.jti)) ||
            (await isFamilyRevoked(decoded.familyId)) ||
            (await isUserForceReauth(userId, decoded.iat))
        ) {
            return next();
        }

        req.user = decoded;
        req.tokenFamilyId = decoded.familyId || null;
    } catch (error) {
        // Ignore invalid tokens for optional auth
    }

    next();
}

/**
 * Reject requests when the caller's refresh-token family is on the revocation list.
 * Useful for sensitive routes after a reuse cascade.
 */
async function rejectRevokedFamilies(req, res, next) {
    try {
        const familyId = req.tokenFamilyId || req.user?.familyId;
        if (familyId && (await isFamilyRevoked(familyId))) {
            return res.status(401).json({
                success: false,
                message: 'Session family revoked',
                code: 'RT_FAMILY_REVOKED',
                securityAlarm: true
            });
        }
        return next();
    } catch (error) {
        return next();
    }
}

module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
module.exports.optionalAuth = optionalAuth;
module.exports.rejectRevokedFamilies = rejectRevokedFamilies;
module.exports.isFamilyRevoked = isFamilyRevoked;
module.exports.isUserForceReauth = isUserForceReauth;
