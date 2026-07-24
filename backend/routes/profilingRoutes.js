// backend/routes/profilingRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { queryProfilingService } = require('../services/queryProfilingService');

/**
 * GET /api/profiling/stats
 * Get profiling statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await queryProfilingService.getStatistics();

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

/**
 * GET /api/profiling/slow-queries
 * Get slow queries (admin only)
 */
router.get('/slow-queries', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { limit = 100, offset = 0 } = req.query;
        const queries = queryProfilingService.getSlowQueries(
            parseInt(limit),
            parseInt(offset)
        );

        res.json({
            success: true,
            data: queries,
            count: queries.length
        });
    } catch (error) {
        console.error('Slow queries error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get slow queries'
        });
    }
});

/**
 * GET /api/profiling/alerts
 * Get query alerts (admin only)
 */
router.get('/alerts', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const alerts = queryProfilingService.getAlerts();

        res.json({
            success: true,
            data: alerts
        });
    } catch (error) {
        console.error('Alerts error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get alerts'
        });
    }
});

/**
 * GET /api/profiling/query/:hash
 * Get query details by hash (admin only)
 */
router.get('/query/:hash', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const result = queryProfilingService.getQueryByHash(req.params.hash);

        if (!result.stats) {
            return res.status(404).json({
                success: false,
                error: 'Query not found'
            });
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Query details error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get query details'
        });
    }
});

/**
 * DELETE /api/profiling/slow-queries
 * Clear slow queries (admin only)
 */
router.delete('/slow-queries', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        queryProfilingService.clearSlowQueries();

        res.json({
            success: true,
            message: 'Slow queries cleared'
        });
    } catch (error) {
        console.error('Clear slow queries error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear slow queries'
        });
    }
});

/**
 * POST /api/profiling/toggle
 * Toggle profiling (admin only)
 */
router.post('/toggle', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { enabled } = req.body;
        if (enabled) {
            queryProfilingService.enable();
        } else {
            queryProfilingService.disable();
        }

        res.json({
            success: true,
            data: { enabled: queryProfilingService.profilingEnabled }
        });
    } catch (error) {
        console.error('Toggle profiling error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to toggle profiling'
        });
    }
});

module.exports = router;