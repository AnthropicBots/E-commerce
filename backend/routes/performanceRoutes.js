// backend/routes/performanceRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const agentPerformanceService = require('../services/agentPerformanceService');

/**
 * GET /api/performance/dashboard/:agentId
 * Get agent performance dashboard
 */
router.get('/dashboard/:agentId', authMiddleware, async (req, res) => {
    try {
        const { agentId } = req.params;
        const userId = req.user.id;

        // Verify user owns this agent
        // Add ownership check here

        const dashboard = await agentPerformanceService.getPerformanceDashboard(agentId, userId);

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
 * POST /api/performance/track
 * Track agent performance
 */
router.post('/track', authMiddleware, async (req, res) => {
    try {
        const { agentId, negotiationData } = req.body;

        if (!agentId || !negotiationData) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID and negotiation data are required'
            });
        }

        const performance = await agentPerformanceService.trackPerformance(agentId, negotiationData);

        res.json({
            success: true,
            data: performance
        });
    } catch (error) {
        console.error('Track performance error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to track performance'
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
        const userId = req.user.id;

        if (!agentId || !feedback) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID and feedback are required'
            });
        }

        const result = await agentPerformanceService.submitFeedback(agentId, userId, feedback);

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
 * POST /api/performance/alerts/resolve/:alertId
 * Resolve performance alert
 */
router.post('/alerts/resolve/:alertId', authMiddleware, async (req, res) => {
    try {
        const { alertId } = req.params;
        const userId = req.user.id;

        const result = await agentPerformanceService.resolveAlert(alertId, userId);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Resolve alert error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resolve alert'
        });
    }
});

/**
 * GET /api/performance/comparison
 * Get model comparison
 */
router.get('/comparison', authMiddleware, async (req, res) => {
    try {
        const comparison = await agentPerformanceService.getModelComparison();

        res.json({
            success: true,
            data: comparison
        });
    } catch (error) {
        console.error('Comparison error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get model comparison'
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

        const stats = await agentPerformanceService.getStatistics();

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