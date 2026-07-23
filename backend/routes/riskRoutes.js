// backend/routes/riskRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { architecturalRiskService } = require('../services/architecturalRiskService');
const nodePath = require('path');

/**
 * POST /api/risk/analyze
 * Trigger risk analysis (admin only)
 */
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const report = await architecturalRiskService.analyzeRisk();

        res.json({
            success: true,
            data: report
        });
    } catch (error) {
        console.error('Analyze risk error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze risk'
        });
    }
});

/**
 * GET /api/risk/report
 * Get latest risk report
 */
router.get('/report', authMiddleware, async (req, res) => {
    try {
        const report = architecturalRiskService.analysisResults[
            architecturalRiskService.analysisResults.length - 1
        ];

        if (!report) {
            return res.status(404).json({
                success: false,
                error: 'No risk report found'
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
 * GET /api/risk/modules
 * Get all module risk scores
 */
router.get('/modules', authMiddleware, async (req, res) => {
    try {
        const modules = Array.from(architecturalRiskService.moduleScores.entries()).map(([path, data]) => ({
            path,
            ...data
        }));

        res.json({
            success: true,
            data: modules
        });
    } catch (error) {
        console.error('Get modules error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get modules'
        });
    }
});

/**
 * GET /api/risk/modules/:name
 * Get specific module risk
 */
router.get('/modules/:name', authMiddleware, async (req, res) => {
    try {
        const { name } = req.params;
        let moduleData = null;

        for (const [modulePath, data] of architecturalRiskService.moduleScores) {
            if (nodePath.basename(modulePath) === name) {
                moduleData = { path: modulePath, ...data };
                break;
            }
        }

        if (!moduleData) {
            return res.status(404).json({
                success: false,
                error: 'Module not found'
            });
        }

        res.json({
            success: true,
            data: moduleData
        });
    } catch (error) {
        console.error('Get module error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get module'
        });
    }
});

/**
 * GET /api/risk/history
 * Get risk history (admin only)
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const history = architecturalRiskService.riskHistory;

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
 * GET /api/risk/status
 * Get risk service status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = architecturalRiskService.getStatus();

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get status'
        });
    }
});

/**
 * GET /api/risk/stats
 * Get risk statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await architecturalRiskService.getStatistics();

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