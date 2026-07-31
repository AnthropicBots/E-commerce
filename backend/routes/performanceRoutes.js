// backend/routes/performanceRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { agentPerformanceMonitor } = require('../services/agentPerformanceMonitorService');

/**
 * POST /api/performance/track
 * Track agent performance
 */
router.post('/track', authMiddleware, async (req, res) => {
    try {
        const { agentId, transactionData } = req.body;

        if (!agentId || !transactionData) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID and transaction data are required'
            });
        }

        const performance = await agentPerformanceMonitor.trackPerformance(agentId, transactionData);

        res.json({
            success: true,
            data: performance
        });
    } catch (error) {
        console.error('Track performance error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to track performance'
        });
    }
});

/**
 * GET /api/performance/dashboard/:agentId
 * Get agent performance dashboard
 */
router.get('/dashboard/:agentId', authMiddleware, async (req, res) => {
    try {
        const { agentId } = req.params;
        const userId = req.user.id;

        const dashboard = await agentPerformanceMonitor.getDashboard(agentId, userId);

        res.json({
            success: true,
            data: dashboard
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dashboard'
        });
    }
});

/**
 * POST /api/performance/feedback
 * Submit agent feedback
 */
router.post('/feedback', authMiddleware, async (req, res) => {
    try {
        const { agentId, feedback } = req.body;

        if (!agentId || !feedback) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID and feedback are required'
            });
        }

        const result = await agentPerformanceMonitor.submitFeedback(agentId, req.user.id, feedback);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Feedback error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit feedback'
        });
    }
});

/**
 * GET /api/performance/alerts/:agentId
 * Get agent performance alerts
 */
router.get('/alerts/:agentId', authMiddleware, (req, res) => {
    try {
        const alerts = agentPerformanceMonitor.getAgentAlerts(req.params.agentId);

        res.json({
            success: true,
            data: alerts
        });
    } catch (error) {
        console.error('Get alerts error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get alerts'
        });
    }
});

/**
 * GET /api/performance/comparison/:agentId
 * Get model comparison
 */
router.get('/comparison/:agentId', authMiddleware, async (req, res) => {
    try {
        const comparison = await agentPerformanceMonitor.getModelComparison(req.params.agentId);

        res.json({
            success: true,
            data: comparison
        });
    } catch (error) {
        console.error('Comparison error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get comparison'
        });
    }
});

/**
 * GET /api/performance/stats
 * Get performance statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await agentPerformanceMonitor.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

module.exports = router;