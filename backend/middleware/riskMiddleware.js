// backend/middleware/riskMiddleware.js
const { riskEvaluationService, RISK_CONFIG } = require('../services/riskEvaluationService');

/**
 * Middleware to evaluate risk for requests
 */
async function evaluateRisk(req, res, next) {
    try {
        const user = req.user || null;
        const risk = await riskEvaluationService.evaluateRisk(req, user);

        // Store risk in request
        req.risk = risk;

        // Handle critical risk
        if (risk.level === RISK_CONFIG.levels.CRITICAL) {
            return res.status(403).json({
                success: false,
                error: 'Request blocked due to security risk',
                riskLevel: risk.level,
                signals: risk.signals,
                recommendations: risk.recommendations
            });
        }

        // Handle high risk - require additional verification
        if (risk.level === RISK_CONFIG.levels.HIGH) {
            res.setHeader('X-Risk-Level', 'high');
            res.setHeader('X-Risk-Score', risk.score);
            
            // For sensitive operations, block high risk
            if (req.path.includes('/checkout') || 
                req.path.includes('/payment') ||
                req.path.includes('/admin')) {
                return res.status(403).json({
                    success: false,
                    error: 'Additional verification required',
                    riskLevel: risk.level,
                    signals: risk.signals,
                    requiresChallenge: true,
                    recommendations: risk.recommendations
                });
            }
        }

        // Add risk headers for monitoring
        if (risk.level === RISK_CONFIG.levels.MEDIUM) {
            res.setHeader('X-Risk-Level', 'medium');
            res.setHeader('X-Risk-Score', risk.score);
        }

        next();
    } catch (error) {
        console.error('Risk evaluation error:', error);
        next();
    }
}

/**
 * Middleware to require additional verification for high-risk actions
 */
function requireVerification(actions = []) {
    return async (req, res, next) => {
        const user = req.user;
        const risk = req.risk;

        if (!risk || !user) {
            return next();
        }

        // Check if action requires verification
        if (actions.length > 0 && !actions.includes(req.path)) {
            return next();
        }

        // Check if risk level requires verification
        if (risk.level === RISK_CONFIG.levels.HIGH || 
            risk.level === RISK_CONFIG.levels.CRITICAL) {
            
            // Check if user has recently verified
            const verified = await riskEvaluationService.isRecentlyVerified(user.id);
            if (!verified) {
                return res.status(403).json({
                    success: false,
                    error: 'Additional verification required',
                    riskLevel: risk.level,
                    signals: risk.signals,
                    requiresChallenge: true
                });
            }
        }

        next();
    };
}

module.exports = {
    evaluateRisk,
    requireVerification
};