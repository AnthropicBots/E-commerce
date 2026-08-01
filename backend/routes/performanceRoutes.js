// backend/routes/performanceRoutes.js
//
// Agent performance monitoring routes.
//
// Rebuilt in #1355. Two generations of this router had been merged by keeping
// *both* sides: `/track`, `/dashboard/:agentId`, `/feedback`, `/comparison` and
// `/stats` each appeared twice, and the seam fell inside a handler --
//
//     res.status(500).json({
//         success: false,
//         error: 'Failed to get dashboard'
//     const agentPerformanceService = require('../services/agentPerformanceService');
//
// -- leaving an unclosed object literal, an unclosed catch block, and a `const`
// where a property was expected. Hence "Unexpected token 'const'" at line 58,
// which took the parse gate and the boot gate down with it, since server.js
// requires this router.
//
// The duplicated half called `agentPerformanceMonitor` from
// '../services/agentPerformanceMonitorService'. That module does not exist: the
// file on disk is `agentPerfomanceMonitorService.js` -- "Perfomance", missing
// the `r` -- so the require threw MODULE_NOT_FOUND and every handler in that
// half would have called a method on `undefined`. It is dropped entirely.
//
// `agentPerformanceService` implements all seven methods these routes need, so
// this is now a single set of routes against a single service.

const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const agentPerformanceService = require('../services/agentPerformanceService');

/**
 * POST /api/performance/track
 * Record a negotiation outcome for an agent.
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

        const performance = await agentPerformanceService.trackPerformance(
            agentId,
            negotiationData
        );

        res.json({ success: true, data: performance });
    } catch (error) {
        console.error('Track performance error:', error);
        res.status(500).json({ success: false, error: 'Failed to track performance' });
    }
});

/**
 * GET /api/performance/dashboard/:agentId
 * Performance dashboard for one agent.
 */
router.get('/dashboard/:agentId', authMiddleware, async (req, res) => {
    try {
        const { agentId } = req.params;
        const userId = req.user.id;

        const dashboard = await agentPerformanceService.getPerformanceDashboard(
            agentId,
            userId
        );

        res.json({ success: true, data: dashboard });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, error: 'Failed to get dashboard' });
    }
});

/**
 * GET /api/performance/alerts/:agentId
 * Outstanding performance alerts for an agent.
 */
router.get('/alerts/:agentId', authMiddleware, async (req, res) => {
    try {
        const alerts = await agentPerformanceService.getAgentAlerts(req.params.agentId);

        res.json({ success: true, data: alerts });
    } catch (error) {
        console.error('Get alerts error:', error);
        res.status(500).json({ success: false, error: 'Failed to get alerts' });
    }
});

/**
 * POST /api/performance/alerts/resolve/:alertId
 * Mark an alert resolved.
 */
router.post('/alerts/resolve/:alertId', authMiddleware, async (req, res) => {
    try {
        const { alertId } = req.params;
        const userId = req.user.id;

        const result = await agentPerformanceService.resolveAlert(alertId, userId);

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Resolve alert error:', error);
        res.status(500).json({ success: false, error: 'Failed to resolve alert' });
    }
});

/**
 * POST /api/performance/feedback
 * Submit feedback on an agent.
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

        const result = await agentPerformanceService.submitFeedback(
            agentId,
            userId,
            feedback
        );

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Feedback error:', error);
        res.status(500).json({ success: false, error: 'Failed to submit feedback' });
    }
});

/**
 * GET /api/performance/comparison
 * Compare agent models against each other.
 *
 * The duplicated half declared this as `/comparison/:agentId`. The surviving
 * service method takes no argument -- `getModelComparison()` compares models
 * across the fleet -- so the parameterised form could only ever have ignored
 * its own parameter.
 */
router.get('/comparison', authMiddleware, async (req, res) => {
    try {
        const comparison = await agentPerformanceService.getModelComparison();

        res.json({ success: true, data: comparison });
    } catch (error) {
        console.error('Comparison error:', error);
        res.status(500).json({ success: false, error: 'Failed to get model comparison' });
    }
});

/**
 * GET /api/performance/stats
 * Fleet-wide statistics. Admin only.
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }

        const stats = await agentPerformanceService.getStatistics();

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ success: false, error: 'Failed to get statistics' });
    }
});

module.exports = router;
