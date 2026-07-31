// backend/middleware/agentLiabilityMiddleware.js
const agentLiabilityService = require('../services/agentLiabilityService');

/**
 * Middleware to authorize agent actions with liability
 */
async function authorizeAgentAction(req, res, next) {
    try {
        const { agentId, action, data } = req.body;

        if (!agentId) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID is required'
            });
        }

        // Authorize the action
        const result = await agentLiabilityService.authorizeAction(agentId, action, data);

        if (!result.authorized) {
            return res.status(403).json({
                success: false,
                error: 'Action not authorized',
                reason: result.reason
            });
        }

        // Attach liability info to request
        req.liability = {
            agentId,
            action,
            authorizationId: result.authorizationId,
            liability: result.liability,
            signature: result.signature
        };

        next();
    } catch (error) {
        console.error('Agent authorization error:', error);
        res.status(500).json({
            success: false,
            error: 'Authorization failed'
        });
    }
}

/**
 * Middleware to register agent
 */
async function registerAgent(req, res, next) {
    try {
        const agentData = req.body;

        if (!agentData.name || !agentData.ownerId) {
            return res.status(400).json({
                success: false,
                error: 'Agent name and owner ID are required'
            });
        }

        const registration = await agentLiabilityService.registerAgent(agentData);

        req.registration = registration;
        next();
    } catch (error) {
        console.error('Agent registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed'
        });
    }
}

module.exports = {
    authorizeAgentAction,
    registerAgent
};