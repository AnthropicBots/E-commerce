// backend/routes/complexityRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { architectureComplexityService } = require('../services/architectureComplexityService');

/**
 * POST /api/complexity/analyze
 * Analyze architecture complexity (admin only)
 */
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const results = await architectureComplexityService.analyzeComplexity();

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Analyze complexity error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze complexity'
        });
    }
});

/**
 * GET /api/complexity/scores
 * Get current complexity scores
 */
router.get('/scores', authMiddleware, async (req, res) => {
    try {
        const scores = architectureComplexityService.scores;

        res.json({
            success: true,
            data: scores
        });
    } catch (error) {
        console.error('Get scores error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get scores'
        });
    }
});

/**
 * GET /api/complexity/details
 * Get detailed complexity breakdown
 */
router.get('/details', authMiddleware, async (req, res) => {
    try {
        const details = architectureComplexityService.details;

        res.json({
            success: true,
            data: details
        });
    } catch (error) {
        console.error('Get details error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get details'
        });
    }
});

/**
 * GET /api/complexity/history
 * Get complexity history (admin only)
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
        const history = architectureComplexityService.history.slice(-parseInt(limit));

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
 * GET /api/complexity/status
 * Get complexity service status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = architectureComplexityService.getStatus();

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
 * GET /api/complexity/thresholds
 * Get complexity thresholds
 */
router.get('/thresholds', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: COMPLEXITY_THRESHOLDS
    });
});

/**
 * GET /api/complexity/stats
 * Get complexity statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await architectureComplexityService.getStatistics();

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