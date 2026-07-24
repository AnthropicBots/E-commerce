const CardActivity = require('../models/CardActivity');
const AgentScore = require('../models/AgentScore');
const CardingDetectionService = require('../services/cardingDetectionService');
const VelocityMonitoringService = require('../services/velocityMonitoringService');

/**
 * Get security alerts
 */
exports.getAlerts = async (req, res) => {
    try {
        const { status = 'active', limit = 50 } = req.query;

        const alerts = await AgentScore.find({})
            .populate('userId', 'name email')
            .sort({ overallScore: -1 })
            .limit(parseInt(limit));

        const formattedAlerts = alerts.map(agent => ({
            userId: agent.userId,
            overallScore: agent.overallScore,
            riskLevel: agent.riskLevel,
            alerts: agent.alerts.filter(a => 
                status === 'all' || 
                (status === 'active' && !a.resolved)
            ),
            lastUpdated: agent.lastUpdated
        }));

        res.status(200).json({
            success: true,
            data: formattedAlerts,
            count: formattedAlerts.length
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Get agent score
 */
exports.getAgentScore = async (req, res) => {
    try {
        const { userId } = req.params;

        const agentScore = await AgentScore.findOne({ userId })
            .populate('userId', 'name email');

        if (!agentScore) {
            return res.status(404).json({
                error: 'Agent score not found'
            });
        }

        res.status(200).json({
            success: true,
            data: agentScore
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Get card activity
 */
exports.getCardActivity = async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 50 } = req.query;

        const activities = await CardActivity.find({ userId })
            .sort({ timestamp: -1 })
            .limit(parseInt(limit));

        res.status(200).json({
            success: true,
            data: activities,
            count: activities.length
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Get velocity summary
 */
exports.getVelocitySummary = async (req, res) => {
    try {
        const { userId } = req.params;

        const summary = await VelocityMonitoringService.getVelocitySummary(userId);

        res.status(200).json({
            success: true,
            data: summary
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Block user
 */
exports.blockUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;

        const agentScore = await AgentScore.findOne({ userId });
        if (!agentScore) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        agentScore.overallScore = 100;
        agentScore.riskLevel = 'critical';
        await agentScore.addAlert('critical', `User blocked: ${reason || 'Suspicious activity'}`);
        await agentScore.updateScore();

        // Here you would also block the user in the main User model

        res.status(200).json({
            success: true,
            message: 'User blocked successfully',
            data: agentScore
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Get fraud patterns
 */
exports.getFraudPatterns = async (req, res) => {
    try {
        // Get suspicious activities in last 24 hours
        const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const suspiciousActivities = await CardActivity.find({
            isSuspicious: true,
            timestamp: { $gte: windowStart }
        })
        .populate('userId', 'name email')
        .sort({ timestamp: -1 });

        // Group by pattern type
        const patterns = {};
        suspiciousActivities.forEach(activity => {
            activity.detectionFlags.forEach(flag => {
                if (!patterns[flag]) {
                    patterns[flag] = [];
                }
                patterns[flag].push(activity);
            });
        });

        res.status(200).json({
            success: true,
            data: {
                total: suspiciousActivities.length,
                patterns,
                timestamp: new Date()
            }
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};