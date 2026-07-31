// backend/routes/debtRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { technicalDebtService, DEBT_CATEGORIES } = require('../services/technicalDebtService');

/**
 * POST /api/debt/analyze
 * Trigger debt analysis (admin only)
 */
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const results = await technicalDebtService.analyzeDebt();

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Analyze debt error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze debt'
        });
    }
});

/**
 * GET /api/debt/report
 * Get latest debt report
 */
router.get('/report', authMiddleware, async (req, res) => {
    try {
        const report = technicalDebtService.debtIndex;

        if (!report || !report.timestamp) {
            return res.status(404).json({
                success: false,
                error: 'No debt report found'
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
 * GET /api/debt/history
 * Get debt history (admin only)
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
        const history = technicalDebtService.debtHistory.slice(-parseInt(limit));

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
 * GET /api/debt/todo
 * Get TODO items
 */
router.get('/todo', authMiddleware, async (req, res) => {
    try {
        const todoItems = technicalDebtService.todoItems.slice(0, 50);

        res.json({
            success: true,
            data: todoItems
        });
    } catch (error) {
        console.error('Get TODO error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get TODO items'
        });
    }
});

/**
 * GET /api/debt/categories
 * Get debt categories
 */
router.get('/categories', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: DEBT_CATEGORIES
    });
});

/**
 * GET /api/debt/status
 * Get debt service status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = technicalDebtService.getStatus();

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
 * GET /api/debt/stats
 * Get debt statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await technicalDebtService.getStatistics();

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