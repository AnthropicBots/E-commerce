// backend/middleware/trajectoryFraudMiddleware.js
const trajectoryFraudDetection = require('../services/trajectoryFraudDetectionService');

/**
 * Middleware to detect trajectory-based fraud
 */
async function detectTrajectoryFraud(req, res, next) {
    try {
        const sessionId = req.session?.id || req.headers['x-session-id'] || crypto.randomUUID();
        const userId = req.user?.id;

        // Build interaction data
        const interactionData = {
            prompt: req.body.prompt || req.query.q || '',
            actions: req.body.actions || [],
            tools: req.body.tools || [],
            toolCalls: req.body.toolCalls || [],
            path: req.path,
            method: req.method,
            sessionStart: req.session?.startTime || Date.now(),
            interactionCount: req.session?.interactionCount || 0,
            lastInteractionTime: req.session?.lastInteractionTime || Date.now(),
            navigationDepth: req.session?.navigationDepth || 0,
            userAgent: req.headers['user-agent'],
            fingerprint: req.headers['x-device-fingerprint'],
            ipReputation: req.ipReputation || 0,
            formCompletionTime: req.headers['x-form-completion-time'],
            mouseMovementScore: req.headers['x-mouse-movement-score'],
            locations: req.session?.locations || [],
            timestamps: req.session?.timestamps || [],
            interactions: req.session?.interactions || [],
            contextSwitchCount: req.session?.contextSwitchCount || 0,
            mandateViolations: req.session?.mandateViolations || 0,
            baseline: req.session?.baseline || {}
        };

        // Process interaction
        const result = await trajectoryFraudDetection.processInteraction(sessionId, interactionData);

        // Store session data
        if (req.session) {
            req.session.interactionCount = (req.session.interactionCount || 0) + 1;
            req.session.lastInteractionTime = Date.now();
            req.session.timestamps = req.session.timestamps || [];
            req.session.timestamps.push(Date.now());
            req.session.interactions = req.session.interactions || [];
            req.session.interactions.push({
                path: req.path,
                timestamp: Date.now()
            });
        }

        // Attach result to request
        req.trajectoryFraud = result;

        // Block critical risk
        if (result.trajectoryRisk.riskLevel === 'critical') {
            return res.status(403).json({
                success: false,
                error: 'Fraudulent interaction pattern detected',
                riskLevel: result.trajectoryRisk.riskLevel,
                escalation: result.escalation,
                alert: result.alert
            });
        }

        // Alert for high risk
        if (result.trajectoryRisk.riskLevel === 'high') {
            res.setHeader('X-Fraud-Risk', 'high');
            res.setHeader('X-Fraud-Alert', result.alert ? 'true' : 'false');
        }

        next();
    } catch (error) {
        console.error('Trajectory fraud detection error:', error);
        next();
    }
}

/**
 * Middleware to get trajectory status
 */
async function getTrajectoryStatus(req, res) {
    try {
        const status = trajectoryFraudDetection.getStatus();
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get status'
        });
    }
}

module.exports = {
    detectTrajectoryFraud,
    getTrajectoryStatus
};