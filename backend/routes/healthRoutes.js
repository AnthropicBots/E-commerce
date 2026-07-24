// backend/routes/healthRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { healthScoreService, HEALTH_STATUS, MODULE_TYPES } = require('../services/healthScoreService');

/**
 * GET /health
 * Basic health check
 */
router.get('/', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

/**
 * GET /health/detailed
 * Detailed health check with module scores
 */
router.get('/detailed', async (req, res) => {
    try {
        const overallHealth = healthScoreService.getOverallHealth();

        res.json({
            success: true,
            data: overallHealth
        });
    } catch (error) {
        console.error('Detailed health error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get detailed health'
        });
    }
});

/**
 * GET /health/modules
 * Get all module health status
 */
router.get('/modules', async (req, res) => {
    try {
        const modules = Array.from(healthScoreService.moduleHealth.values());

        res.json({
            success: true,
            data: modules,
            count: modules.length
        });
    } catch (error) {
        console.error('Modules health error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get module health'
        });
    }
});

/**
 * GET /health/modules/:module
 * Get specific module health
 */
router.get('/modules/:module', async (req, res) => {
    try {
        const { module } = req.params;
        const health = healthScoreService.getModuleHealth(module);

        if (!health) {
            return res.status(404).json({
                success: false,
                error: `Module not found: ${module}`
            });
        }

        res.json({
            success: true,
            data: health
        });
    } catch (error) {
        console.error('Module health error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get module health'
        });
    }
});

/**
 * GET /health/history
 * Get health history (admin only)
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { limit = 100 } = req.query;
        const history = healthScoreService.getHealthHistory(parseInt(limit));

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Health history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get health history'
        });
    }
});

/**
 * GET /health/stats
 * Get health statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = healthScoreService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Health stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get health statistics'
        });
    }
});

/**
 * GET /health/statuses
 * Get all possible health statuses
 */
router.get('/statuses', (req, res) => {
    res.json({
        success: true,
        data: HEALTH_STATUS
    });
});

/**
 * GET /health/module-types
 * Get all module types
 */
router.get('/module-types', (req, res) => {
    res.json({
        success: true,
        data: MODULE_TYPES
    });
});

/**
 * POST /health/check/:module
 * Trigger manual health check for a module (admin only)
 */
router.post('/check/:module', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { module } = req.params;
        
        if (!healthScoreService.healthChecks.has(module)) {
            return res.status(404).json({
                success: false,
                error: `Module not found: ${module}`
            });
        }

        await healthScoreService.performHealthCheck(module);
        const result = healthScoreService.getModuleHealth(module);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Manual health check error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to perform health check'
        });
    }
});

module.exports = router;