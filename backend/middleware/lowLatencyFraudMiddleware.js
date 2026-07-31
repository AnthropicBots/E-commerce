// backend/middleware/lowLatencyFraudMiddleware.js
const lowLatencyFraudDetection = require('../services/lowLatencyFraudDetectionService');

/**
 * Middleware for low-latency fraud detection
 */
async function detectLowLatencyFraud(req, res, next) {
    try {
        const sessionId = req.session?.id || req.headers['x-session-id'] || crypto.randomUUID();
        const userId = req.user?.id;

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

        const result = await lowLatencyFraudDetection.processInteraction(sessionId, interactionData);

        if (req.session) {
            req.session.interactionCount = (req.session.interactionCount || 0) + 1;
            req.session.lastInteractionTime = Date.now();
            req.session.timestamps = req.session.timestamps || [];
            req.session.timestamps.push(Date.now());
        }

        req.lowLatencyFraud = result;

        if (result.trajectoryRisk.riskLevel === 'critical') {
            return res.status(403).json({
                success: false,
                error: 'Fraudulent interaction pattern detected',
                riskLevel: result.trajectoryRisk.riskLevel,
                escalation: result.escalation,
                alert: result.alert,
                processingTime: result.processingTime
            });
        }

        if (result.trajectoryRisk.riskLevel === 'high') {
            res.setHeader('X-Fraud-Risk', 'high');
            res.setHeader('X-Fraud-Alert', result.alert ? 'true' : 'false');
            res.setHeader('X-Processing-Time', result.processingTime);
        }

        next();
    } catch (error) {
        console.error('Low latency fraud detection error:', error);
        next();
    }
}

module.exports = {
    detectLowLatencyFraud
};