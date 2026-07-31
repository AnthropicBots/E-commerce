// backend/middleware/authMiddleware.js

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
 * Verify JWT token from Authorization header or cookies fallback
 */
function authMiddleware(req, res, next) {
    assertAccessTokenSecret();

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
        const decoded = verifyAccessToken(token);

        if (!hasSubjectClaim(decoded)) {
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
    assertAccessTokenSecret();

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
        req.user = verifyAccessToken(token);
    } catch (error) {
        // Ignore invalid tokens for optional auth
    }

    next();
}


module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
module.exports.optionalAuth = optionalAuth;