// backend/middleware/oracleScamMiddleware.js
const oracleScamAnticipation = require('../services/oracleScamAnticipationService');

/**
 * Middleware to anticipate scams from trajectories
 */
async function anticipateScam(req, res, next) {
    try {
        const userId = req.user?.id || req.headers['x-user-id'];
        const appUsage = {
            app: req.headers['x-app'] || req.path,
            action: req.method,
            data: req.body,
            timestamp: Date.now()
        };

        if (!userId) {
            return next();
        }

        // Process trajectory
        const result = await oracleScamAnticipation.processTrajectory(userId, appUsage);

        // Attach result to request
        req.scamAnticipation = result;

        // Block critical scams
        if (result.analysis.riskLevel === 'critical') {
            return res.status(403).json({
                success: false,
                error: 'Suspicious activity detected',
                riskLevel: result.analysis.riskLevel,
                scamProbability: result.analysis.scamProbability,
                detectedScams: result.analysis.detectedScams,
                recommendations: result.analysis.recommendations
            });
        }

        // Warning for high risk
        if (result.analysis.riskLevel === 'high') {
            res.setHeader('X-Scam-Risk', 'high');
            res.setHeader('X-Scam-Probability', result.analysis.scamProbability);
            res.setHeader('X-Scam-Warning', result.warning ? result.warning.warningId : 'none');
        }

        next();
    } catch (error) {
        console.error('Scam anticipation error:', error);
        next();
    }
}

module.exports = {
    anticipateScam
};