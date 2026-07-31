// backend/routes/experimentRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { experimentFramework, EXPERIMENT_TYPES } = require('../services/experimentFrameworkService');

/**
 * POST /api/experiments
 * Create an experiment (admin only)
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const experiment = await experimentFramework.createExperiment(req.body);

        res.json({
            success: true,
            data: experiment
        });
    } catch (error) {
        console.error('Create experiment error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create experiment'
        });
    }
});

/**
 * GET /api/experiments
 * Get all experiments
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const experiments = Array.from(experimentFramework.experiments.values());

        res.json({
            success: true,
            data: experiments,
            count: experiments.length
        });
    } catch (error) {
        console.error('Get experiments error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get experiments'
        });
    }
});

/**
 * GET /api/experiments/:id
 * Get experiment by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const experiment = experimentFramework.experiments.get(req.params.id);

        if (!experiment) {
            return res.status(404).json({
                success: false,
                error: 'Experiment not found'
            });
        }

        res.json({
            success: true,
            data: experiment
        });
    } catch (error) {
        console.error('Get experiment error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get experiment'
        });
    }
});

/**
 * POST /api/experiments/:id/start
 * Start an experiment (admin only)
 */
router.post('/:id/start', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const experiment = await experimentFramework.startExperiment(req.params.id);

        res.json({
            success: true,
            data: experiment
        });
    } catch (error) {
        console.error('Start experiment error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to start experiment'
        });
    }
});

/**
 * GET /api/experiments/:id/variant
 * Get variant for current user
 */
router.get('/:id/variant', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const experimentId = req.params.id;

        const variant = await experimentFramework.getVariant(experimentId, userId);

        res.json({
            success: true,
            data: {
                experimentId,
                variant,
                hasVariant: !!variant
            }
        });
    } catch (error) {
        console.error('Get variant error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get variant'
        });
    }
});

/**
 * POST /api/experiments/:id/metric
 * Record a metric
 */
router.post('/:id/metric', authMiddleware, async (req, res) => {
    try {
        const { metricType, value } = req.body;
        const userId = req.user.id;
        const experimentId = req.params.id;

        if (!metricType) {
            return res.status(400).json({
                success: false,
                error: 'Metric type is required'
            });
        }

        const metric = await experimentFramework.recordMetric(
            experimentId,
            userId,
            metricType,
            parseFloat(value) || 0
        );

        res.json({
            success: true,
            data: metric
        });
    } catch (error) {
        console.error('Record metric error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to record metric'
        });
    }
});

/**
 * GET /api/experiments/:id/results
 * Get experiment results
 */
router.get('/:id/results', authMiddleware, async (req, res) => {
    try {
        const results = await experimentFramework.getResults(req.params.id);

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Get results error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get results'
        });
    }
});

/**
 * GET /api/experiments/types
 * Get experiment types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: EXPERIMENT_TYPES
    });
});

/**
 * GET /api/experiments/statistics
 * Get experiment statistics (admin only)
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await experimentFramework.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Statistics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

module.exports = router;