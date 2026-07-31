// backend/middleware/policyMiddleware.js
const { policyEngine } = require('../services/policyEngineService');

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
 * Middleware to check if user is resource owner
 */
function isResourceOwner(getResourceId) {
    return async (req, res, next) => {
        try {
            const resourceId = typeof getResourceId === 'function' 
                ? getResourceId(req) 
                : req.params.id;

            if (!resourceId || !req.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
            }

            // Check if user owns the resource
            // This would be implemented based on your data model
            const isOwner = await checkResourceOwnership(req.user.id, resourceId);
            
            if (!isOwner && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
            }

            next();
        } catch (error) {
            console.error('Resource owner check error:', error);
            res.status(500).json({
                success: false,
                error: 'Authorization failed'
            });
        }
    };
}

/**
 * Helper function to check resource ownership
 */
async function checkResourceOwnership(userId, resourceId) {
    // Implement based on your data model
    // Example: Check if user owns the order
    return true; // Placeholder
}

module.exports = {
    authorizePolicy,
    isResourceOwner
};