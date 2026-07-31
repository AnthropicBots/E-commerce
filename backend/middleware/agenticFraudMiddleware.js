// backend/middleware/agenticFraudMiddleware.js
const agenticFraudDetection = require('../services/agenticFraudDetectionService');

/**
 * Middleware to detect agentic fraud
 */
async function detectAgenticFraud(req, res, next) {
    try {
        const { agentId, action, data } = req.body;
        const userId = req.user?.id;

        if (!agentId) {
            return next();
        }

        // Build agent data
        const agentData = {
            agentId,
            type: req.headers['x-agent-type'] || 'unknown',
            signature: req.headers['x-agent-signature'] || null,
            provider: req.headers['x-agent-provider'] || 'unknown',
            provenance: {
                provider: req.headers['x-agent-provider'],
                version: req.headers['x-agent-version'],
                createdAt: req.headers['x-agent-created-at']
            }
        };

        // Build context
        const context = {
            userId,
            action,
            data,
            interactionSpeed: req.headers['x-interaction-speed'],
            navigationPattern: req.headers['x-navigation-pattern'],
            formCompletionTime: req.headers['x-form-completion-time'],
            mandate: req.session?.mandate || null,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        // Evaluate agent interaction
        const evaluation = await agenticFraudDetection.evaluateAgentInteraction(agentData, context);

        // Store evaluation in request
        req.agenticFraudEvaluation = evaluation;

        // Block fraudulent agents
        if (evaluation.isFraudulent || evaluation.riskLevel === 'critical') {
            return res.status(403).json({
                success: false,
                error: 'Agent interaction flagged as fraudulent',
                trustScore: evaluation.trustScore,
                riskLevel: evaluation.riskLevel,
                flags: evaluation.flags,
                recommendations: evaluation.recommendations
            });
        }

        // Rate limit for high risk
        if (evaluation.riskLevel === 'high') {
            // Apply stricter rate limiting
            res.setHeader('X-Agent-Risk-Level', 'high');
            res.setHeader('X-Agent-Trust-Score', evaluation.trustScore);
        }

        next();
    } catch (error) {
        console.error('Agentic fraud detection error:', error);
        next();
    }
}

/**
 * Middleware to get agent reputation
 */
async function getAgentReputation(req, res, next) {
    try {
        const { agentId } = req.params;

        if (!agentId) {
            return next();
        }

        const reputation = await agenticFraudDetection.getAgentReputation(agentId);
        req.agentReputation = reputation;

        next();
    } catch (error) {
        console.error('Agent reputation error:', error);
        next();
    }
}

module.exports = {
    detectAgenticFraud,
    getAgentReputation
};