// backend/middleware/agentCompromiseDetectionMiddleware.js
const agentBehavioralBaseline = require('../services/agentBehavioralBaselineService');

/**
 * Middleware to detect compromised agents
 */
async function detectCompromisedAgent(req, res, next) {
    try {
        const { agentId } = req.body;
        const userId = req.user?.id;

        if (!agentId) {
            return next();
        }

        // Get current activity
        const currentActivity = {
            merchants: req.body.merchants || [],
            basket: req.body.basket || null,
            conversation: req.body.conversation || null,
            mandate: req.body.mandate || null,
            timestamp: new Date().toISOString(),
            frequency: req.body.frequency || 0,
            value: req.body.amount || 0,
            interaction: req.method || 'unknown'
        };

        // Check if baseline exists
        const baseline = agentBehavioralBaseline.agentBaselines.get(agentId);
        
        if (!baseline) {
            // Initialize baseline
            await agentBehavioralBaseline.initializeBaseline(agentId, {
                merchants: currentActivity.merchants,
                baskets: currentActivity.basket ? [currentActivity.basket] : [],
                conversations: currentActivity.conversation ? [currentActivity.conversation] : [],
                mandates: currentActivity.mandate ? [currentActivity.mandate] : []
            });
            return next();
        }

        // Detect if agent is compromised
        const detection = await agentBehavioralBaseline.detectCompromisedAgent(agentId, currentActivity);

        // Update baseline with new data
        await agentBehavioralBaseline.updateBaseline(agentId, currentActivity);

        // Attach detection to request
        req.agentCompromiseDetection = detection;

        // Block if compromised
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

        // Flag for review if suspicious
        if (detection.confidence > 40) {
            res.setHeader('X-Agent-Compromise-Risk', 'suspicious');
            res.setHeader('X-Agent-Compromise-Confidence', detection.confidence);
        }

        next();
    } catch (error) {
        console.error('Compromise detection error:', error);
        next();
    }
}

/**
 * Middleware to get agent status
 */
async function getAgentStatus(req, res) {
    try {
        const { agentId } = req.params;

        const baseline = agentBehavioralBaseline.agentBaselines.get(agentId);
        if (!baseline) {
            return res.status(404).json({
                success: false,
                error: 'Agent not found'
            });
        }

        res.json({
            success: true,
            data: {
                agentId,
                baseline: {
                    initializedAt: baseline.initializedAt,
                    lastUpdated: baseline.lastUpdated,
                    merchantCount: baseline.merchantProfile.knownMerchants.size,
                    typicalItems: baseline.basketProfile.typicalItems.size,
                    mandateScope: baseline.mandateProfile.scope
                }
            }
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get agent status'
        });
    }
}

module.exports = {
    detectCompromisedAgent,
    getAgentStatus
};