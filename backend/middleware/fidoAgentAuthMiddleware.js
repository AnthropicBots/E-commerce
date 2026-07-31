// backend/middleware/fidoAgentAuthMiddleware.js
const fidoAgentAuth = require('../services/fidoAgentAuthService');

/**
 * Middleware to verify FIDO agent authentication
 */
async function verifyFIDOAgent(req, res, next) {
    try {
        const { agentId, agentToken } = req.headers;
        
        if (!agentId || !agentToken) {
            return res.status(401).json({
                success: false,
                error: 'Agent authentication required'
            });
        }

        // Verify agent is authenticated
        const agent = fidoAgentAuth.verifiedAgents.get(agentId);
        if (!agent || agent.token !== agentToken) {
            return res.status(401).json({
                success: false,
                error: 'Invalid agent credentials'
            });
        }

        req.authenticatedAgent = agent;
        next();
    } catch (error) {
        console.error('FIDO verification error:', error);
        res.status(401).json({
            success: false,
            error: 'Authentication failed'
        });
    }
}

/**
 * Middleware to check delegation
 */
async function checkDelegation(req, res, next) {
    try {
        const { agentId, action, data } = req.body;
        
        if (!agentId) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID required'
            });
        }

        // Execute with delegation
        const result = await fidoAgentAuth.executeWithDelegation(agentId, action, data);

        req.delegationResult = result;
        next();
    } catch (error) {
        console.error('Delegation check error:', error);
        res.status(403).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    verifyFIDOAgent,
    checkDelegation
};