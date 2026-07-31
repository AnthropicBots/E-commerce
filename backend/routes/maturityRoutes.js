// backend/routes/maturityRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { moduleMaturityService, MATURITY_LEVELS } = require('../services/moduleMaturityService');

/**
 * POST /api/maturity/analyze
 * Trigger maturity analysis (admin only)
 */
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const report = await moduleMaturityService.analyzeMaturity();

        res.json({
            success: true,
            data: report
        });
    } catch (error) {
        console.error('Analyze maturity error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze maturity'
        });
    }
});

/**
 * GET /api/maturity/report
 * Get latest maturity report
 */
router.get('/report', authMiddleware, async (req, res) => {
    try {
        const report = moduleMaturityService.maturityHistory[
            moduleMaturityService.maturityHistory.length - 1
        ];

        if (!report) {
            return res.status(404).json({
                success: false,
                error: 'No maturity report found'
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
 * GET /api/maturity/modules
 * Get all module maturity scores
 */
router.get('/modules', authMiddleware, async (req, res) => {
    try {
        const modules = Array.from(moduleMaturityService.moduleScores.entries()).map(([path, data]) => ({
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
 * GET /api/maturity/modules/:name
 * Get specific module maturity
 */
router.get('/modules/:name', authMiddleware, async (req, res) => {
    try {
        const { name } = req.params;
        let moduleData = null;

        for (const [path, data] of moduleMaturityService.moduleScores) {
            if (path.basename(path) === name) {
                moduleData = { path, ...data };
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
 * GET /api/maturity/levels
 * Get maturity levels
 */
router.get('/levels', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: MATURITY_LEVELS
    });
});

/**
 * GET /api/maturity/history
 * Get maturity history (admin only)
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const history = moduleMaturityService.maturityHistory.slice(-50);

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
 * GET /api/maturity/status
 * Get maturity service status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = moduleMaturityService.getStatus();

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
 * GET /api/maturity/stats
 * Get maturity statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await moduleMaturityService.getStatistics();

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