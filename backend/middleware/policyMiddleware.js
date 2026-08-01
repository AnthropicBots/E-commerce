// backend/middleware/policyMiddleware.js
const { policyEngine } = require('../services/policyEngineService');
const { requireOwnership } = require('./requireOwnership');

/**
 * Middleware to check authorization policy
 */
function authorizePolicy(resource, action) {
    return async (req, res, next) => {
        try {
            const user = req.user || { role: 'guest' };
            const context = {
                environment: process.env.NODE_ENV || 'development',
                ip: req.ip,
                method: req.method,
                path: req.path,
                query: req.query,
                ...req.body
            };

            const result = await policyEngine.evaluate(user, resource, action, context);

            if (!result.allowed) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied',
                    reason: result.reason,
                    policies: result.policies
                });
            }

            req.policyResult = result;
            next();
        } catch (error) {
            console.error('Authorization error:', error);
            res.status(500).json({
                success: false,
                error: 'Authorization failed'
            });
        }
    };
}

/**
 * Middleware to check if user is resource owner.
 *
 * Kept as an alias so existing call sites keep resolving, but the check itself
 * now runs through requireOwnership. The previous implementation resolved
 * ownership through a placeholder that returned `true` unconditionally, so
 * wiring this onto a route granted everyone access to everything while reading
 * like a guard.
 *
 * @param {Function} loadOwnerId `(req) => ownerId | null`
 * @param {object} [options] see requireOwnership
 * @returns {Function} express middleware
 */
function isResourceOwner(loadOwnerId, options) {
    return requireOwnership(loadOwnerId, options);
}

module.exports = {
    authorizePolicy,
    isResourceOwner
};