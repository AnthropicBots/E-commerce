// backend/routes/dependencyRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { dependencyGraphService } = require('../services/dependencyGraphService');

/**
 * GET /api/dependencies/graph
 * Get dependency graph
 */
router.get('/graph', authMiddleware, async (req, res) => {
    try {
        const graph = {
            nodes: Array.from(dependencyGraphService.graph.entries()).map(([id, data]) => ({
                id,
                ...data
            })),
            edges: Array.from(dependencyGraphService.edges.entries()).map(([id, data]) => ({
                id,
                ...data
            }))
        };

        res.json({
            success: true,
            data: graph
        });
    } catch (error) {
        console.error('Get graph error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dependency graph'
        });
    }
});

/**
 * GET /api/dependencies/cycles
 * Get circular dependencies
 */
router.get('/cycles', authMiddleware, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                cycles: dependencyGraphService.cycles,
                count: dependencyGraphService.cycles.length
            }
        });
    } catch (error) {
        console.error('Get cycles error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get cycles'
        });
    }
});

/**
 * GET /api/dependencies/metrics
 * Get coupling metrics
 */
router.get('/metrics', authMiddleware, async (req, res) => {
    try {
        res.json({
            success: true,
            data: dependencyGraphService.metrics
        });
    } catch (error) {
        console.error('Get metrics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get metrics'
        });
    }
});

/**
 * GET /api/dependencies/hotspots
 * Get architectural hotspots
 */
router.get('/hotspots', authMiddleware, async (req, res) => {
    try {
        const hotspots = dependencyGraphService.getHotspots();

        res.json({
            success: true,
            data: hotspots
        });
    } catch (error) {
        console.error('Get hotspots error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get hotspots'
        });
    }
});

/**
 * GET /api/dependencies/report
 * Get analysis report
 */
router.get('/report', authMiddleware, async (req, res) => {
    try {
        const report = dependencyGraphService.generateReport();

        res.json({
            success: true,
            data: report
        });
    } catch (error) {
        console.error('Get report error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get report'
        });
    }
});

/**
 * POST /api/dependencies/analyze
 * Trigger dependency analysis (admin only)
 */
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await dependencyGraphService.analyzeDependencies();

        res.json({
            success: true,
            message: 'Dependency analysis triggered'
        });
    } catch (error) {
        console.error('Trigger analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to trigger analysis'
        });
    }
});

/**
 * GET /api/dependencies/history
 * Get analysis history (admin only)
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const history = dependencyGraphService.analysisHistory;

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get history'
        });
    }
});

/**
 * GET /api/dependencies/stats
 * Get dependency statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await dependencyGraphService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

module.exports = router;