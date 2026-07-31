// backend/routes/impactRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { impactAnalysisService, IMPACT_SEVERITY } = require('../services/impactAnalysisService');

/**
 * POST /api/impact/analyze
 * Analyze impact of file changes (admin only)
 */
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { files, context } = req.body;

        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Files array is required'
            });
        }

        const impact = await impactAnalysisService.analyzeImpact(files, context);

        res.json({
            success: true,
            data: impact
        });
    } catch (error) {
        console.error('Analyze impact error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze impact'
        });
    }
});

/**
 * GET /api/impact/reports
 * Get impact reports (admin only)
 */
router.get('/reports', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const reports = impactAnalysisService.impactReports.slice(-50);

        res.json({
            success: true,
            data: reports
        });
    } catch (error) {
        console.error('Get reports error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get reports'
        });
    }
});

/**
 * GET /api/impact/dependencies
 * Get dependency graph (admin only)
 */
router.get('/dependencies', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const graph = {
            nodes: Array.from(impactAnalysisService.dependencyGraph.keys()),
            edges: Array.from(impactAnalysisService.dependencyGraph.entries()).map(([file, deps]) => ({
                file,
                dependencies: Array.from(deps)
            }))
        };

        res.json({
            success: true,
            data: graph
        });
    } catch (error) {
        console.error('Get dependencies error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dependencies'
        });
    }
});

/**
 * GET /api/impact/status
 * Get impact analysis status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = impactAnalysisService.getStatus();

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
 * GET /api/impact/securities
 * Get severity levels
 */
router.get('/severities', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: IMPACT_SEVERITY
    });
});

/**
 * GET /api/impact/stats
 * Get impact statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await impactAnalysisService.getStatistics();

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