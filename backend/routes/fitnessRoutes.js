// backend/routes/fitnessRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { architecturalFitnessService } = require('../services/architecturalFitnessService');

/**
 * POST /api/fitness/run
 * Run fitness functions (admin only)
 */
router.post('/run', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await architecturalFitnessService.runFitness();

        res.json({
            success: true,
            message: 'Fitness functions executed'
        });
    } catch (error) {
        console.error('Run fitness error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to run fitness functions'
        });
    }
});

/**
 * GET /api/fitness/report
 * Get fitness report
 */
router.get('/report', authMiddleware, async (req, res) => {
    try {
        const report = architecturalFitnessService.generateReport();

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
 * GET /api/fitness/violations
 * Get violations
 */
router.get('/violations', authMiddleware, async (req, res) => {
    try {
        const { severity } = req.query;
        const violations = architecturalFitnessService.getViolations(severity);

        res.json({
            success: true,
            data: violations,
            count: violations.length
        });
    } catch (error) {
        console.error('Get violations error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get violations'
        });
    }
});

/**
 * GET /api/fitness/score
 * Get fitness score
 */
router.get('/score', authMiddleware, async (req, res) => {
    try {
        const score = architecturalFitnessService.getScore();

        res.json({
            success: true,
            data: {
                score,
                passes: architecturalFitnessService.passes(),
                threshold: 80
            }
        });
    } catch (error) {
        console.error('Get score error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get score'
        });
    }
});

/**
 * GET /api/fitness/rules
 * Get all rules
 */
router.get('/rules', authMiddleware, async (req, res) => {
    try {
        const rules = architecturalFitnessService.getRules();

        res.json({
            success: true,
            data: rules
        });
    } catch (error) {
        console.error('Get rules error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get rules'
        });
    }
});

/**
 * POST /api/fitness/rules
 * Add custom rule (admin only)
 */
router.post('/rules', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { name, description, severity, check } = req.body;

        if (!name || !check) {
            return res.status(400).json({
                success: false,
                error: 'Name and check function are required'
            });
        }

        const rule = architecturalFitnessService.addCustomRule(name, {
            description: description || '',
            severity: severity || 'warning',
            check: new Function('file', 'content', `return (${check})`)
        });

        res.json({
            success: true,
            data: rule
        });
    } catch (error) {
        console.error('Add rule error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to add rule'
        });
    }
});

/**
 * PUT /api/fitness/rules/:name
 * Enable/disable rule (admin only)
 */
router.put('/rules/:name', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { enabled } = req.body;
        const rule = architecturalFitnessService.setRuleEnabled(req.params.name, enabled);

        res.json({
            success: true,
            data: rule
        });
    } catch (error) {
        console.error('Update rule error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update rule'
        });
    }
});

/**
 * GET /api/fitness/history
 * Get fitness history (admin only)
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
        const history = architecturalFitnessService.getHistory(parseInt(limit));

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
 * GET /api/fitness/stats
 * Get fitness statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await architecturalFitnessService.getStatistics();

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