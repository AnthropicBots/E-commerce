// backend/middleware/agenticATOMiddleware.js
const agenticATODetection = require('../services/agenticATODetectionService');

/**
 * Middleware to detect compromised agents
 */
async function detectAgenticATO(req, res, next) {
    try {
        const { agentId } = req.body;
        const userId = req.user?.id;

        if (!agentId) {
            return next();
        }

        const currentActivity = {
            merchants: req.body.merchants || [],
            basket: req.body.basket || null,
            conversation: req.body.conversation || null,
            mandate: req.body.mandate || null,
            credentialAccess: req.body.credentialAccess || null,
            timestamp: new Date().toISOString(),
            frequency: req.body.frequency || 0,
            value: req.body.amount || 0,
            interaction: req.method || 'unknown'
        };

        const baseline = agenticATODetection.agentBaselines.get(agentId);

        if (!baseline) {
            await agenticATODetection.initializeBaseline(agentId, {
                merchants: currentActivity.merchants,
                baskets: currentActivity.basket ? [currentActivity.basket] : [],
                conversations: currentActivity.conversation ? [currentActivity.conversation] : [],
                mandates: currentActivity.mandate ? [currentActivity.mandate] : [],
                credentialAccess: currentActivity.credentialAccess ? [currentActivity.credentialAccess] : []
            });
            return next();
        }

        const detection = await agenticATODetection.detectCompromisedAgent(agentId, currentActivity);
        await agenticATODetection.updateBaseline(agentId, currentActivity);

        req.agenticATODetection = detection;

        if (detection.isCompromised) {
            return res.status(403).json({
                success: false,
                error: 'Agent appears to be compromised',
                confidence: detection.confidence,
                flags: detection.flags,
                details: detection.details,
                action: 'blocked'
            });
        }

        if (detection.confidence > 40) {
            res.setHeader('X-ATO-Risk', 'suspicious');
            res.setHeader('X-ATO-Confidence', detection.confidence);
        }

        next();
    } catch (error) {
        console.error('ATO detection error:', error);
        next();
    }
}

module.exports = {
    detectAgenticATO
};