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
const { markPolicyMiddleware } = require('../config/policy');

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
    //
    // `|| /--/.test(token)` used to be part of this, and it rejected roughly
    // one legitimate token in a hundred (#1444).
    //
    // A JWT is base64url, and base64url's alphabet is A-Z a-z 0-9 plus `-` and
    // `_`. Two adjacent hyphens are ordinary token content, not a SQL comment:
    // across a ~200-character token the odds of the pair turning up somewhere
    // are just under 1%. Those requests were answered "Authorization header
    // required" -- as though no token had been sent at all -- so the shopper
    // saw a sign-out that no amount of retrying reproduced, on a token that was
    // perfectly valid and would work again the moment it was reissued.
    //
    // The quote-OR pattern stays: `'` is not in the base64url alphabet, so it
    // cannot match a well-formed token and only fires on something that was
    // never a JWT to begin with.
    //
    // Neither pattern is what makes this safe in any case. The token is a
    // signed credential verified below, and it is never interpolated into SQL.
    if (/'\s*OR\s*'/i.test(token)) {
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

// `optionalAuth` is deliberately not marked: it attaches a user when one is
// present and lets everyone else through, so a route guarded only by it is
// still a public route as far as the audit is concerned.
markPolicyMiddleware(authMiddleware, { authentication: true });

module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
module.exports.optionalAuth = optionalAuth;
module.exports.attachDeviceFingerprint = attachDeviceFingerprint;
