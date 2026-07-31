// backend/middleware/agentSecurityMiddleware.js
const agentAnomalyDetection = require('../services/agentAnomalyDetectionService');

/**
 * Middleware to detect agent anomalies
 */
async function detectAgentAnomalies(req, res, next) {
    try {
        const { agentId, action, data } = req.body;
        const userId = req.user?.id;

        if (!agentId) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID is required'
            });
        }

        // Initialize baseline if not exists
        const baseline = await agentAnomalyDetection.agentBaselines.get(agentId);
        if (!baseline) {
            await agentAnomalyDetection.initializeBaseline(agentId, userId);
        }

        // Detect anomalies
        const anomalies = await agentAnomalyDetection.detectAnomalies(agentId, action, data);

        // Block if critical anomaly detected
        if (anomalies.isAnomalous && anomalies.riskScore > 75) {
            // Log the attempt
            await agentAnomalyDetection.logAnomaly(agentId, anomalies);

            return res.status(403).json({
                success: false,
                error: 'Agent behavior flagged as anomalous',
                riskScore: anomalies.riskScore,
                flags: anomalies.flags,
                confidence: anomalies.confidence
            });
        }

        // Enforce mandate scope
        const enforcement = agentAnomalyDetection.enforceMandateScope(agentId, action, data);
        
        if (!enforcement.allowed) {
            return res.status(403).json({
                success: false,
                error: 'Agent mandate scope violation',
                reason: enforcement.reason,
                required: enforcement.required,
                current: enforcement.current
            });
        }

        // Attach to request
        req.agentAnomalies = anomalies;
        req.mandateEnforcement = enforcement;

        next();
    } catch (error) {
        console.error('Agent anomaly detection error:', error);
        res.status(500).json({
            success: false,
            error: 'Agent security validation failed'
        });
    }
}

/**
 * Middleware to check agent permissions
 */
async function checkAgentPermissions(req, res, next) {
    try {
        const { agentId, action } = req.body;
        const userId = req.user?.id;

        const baseline = await agentAnomalyDetection.agentBaselines.get(agentId);
        if (!baseline) {
            return res.status(404).json({
                success: false,
                error: 'Agent not found'
            });
        }

        // Check if action is allowed
        const allowedActions = ['view', 'search', 'purchase', 'modify', 'delete'];
        if (!allowedActions.includes(action)) {
            return res.status(400).json({
                success: false,
                error: `Invalid action: ${action}`
            });
        }

        // Check if agent has permission
        const required = {
            'view': ['view'],
            'search': ['view', 'search'],
            'purchase': ['purchase', 'view', 'search'],
            'modify': ['modify', 'purchase', 'view', 'search'],
            'delete': ['delete', 'modify', 'purchase', 'view', 'search']
        };

        const requiredPermissions = required[action] || [];
        const hasPermission = requiredPermissions.some(perm => baseline.permissions.includes(perm));

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                error: 'Agent lacks required permission',
                required: requiredPermissions,
                current: baseline.permissions
            });
        }

        next();
    } catch (error) {
        console.error('Permission check error:', error);
        res.status(500).json({
            success: false,
            error: 'Permission check failed'
        });
    }
}

module.exports = {
    detectAgentAnomalies,
    checkAgentPermissions
};