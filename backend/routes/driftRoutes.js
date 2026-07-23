// backend/routes/driftRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { architectureDriftService } = require('../services/architectureDriftService');

/**
 * POST /api/drift/analyze
 * Analyze architecture drift (admin only)
 */
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const report = await architectureDriftService.analyzeDrift();

        res.json({
            success: true,
            data: report
        });
    } catch (error) {
        console.error('Analyze drift error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze drift'
        });
    }
});

/**
 * GET /api/drift/report
 * Get latest drift report
 */
router.get('/report', authMiddleware, async (req, res) => {
    try {
        const report = architectureDriftService.getLatestReport();

        if (!report) {
            return res.status(404).json({
                success: false,
                error: 'No drift report found'
            });
        }

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
 * GET /api/drift/history
 * Get drift history (admin only)
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { limit = 50 } = req.query;
        const history = architectureDriftService.getHistory(parseInt(limit));

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get history'
        });
    }
});

/**
 * GET /api/drift/status
 * Get drift service status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = architectureDriftService.getStatus();

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get status'
        });
    }
});

/**
 * GET /api/drift/stats
 * Get drift statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await architectureDriftService.getStatistics();

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