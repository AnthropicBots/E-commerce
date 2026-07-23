// backend/routes/cacheInvalidationRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { cacheInvalidation } = require('../services/cacheInvalidationService');

/**
 * POST /api/cache-invalidate
 * Invalidate cache manually (admin only)
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { key, reason, cascade = true, strategy } = req.body;

        if (!key) {
            return res.status(400).json({
                success: false,
                error: 'Cache key is required'
            });
        }

        const result = await cacheInvalidation.invalidate(key, {
            reason: reason || 'manual',
            cascade,
            strategy
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Invalidation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to invalidate cache'
        });
    }
});

/**
 * POST /api/cache-invalidate/dependency
 * Register a cache dependency (admin only)
 */
router.post('/dependency', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { key, dependencies, strategy, ttl } = req.body;

        if (!key || !dependencies) {
            return res.status(400).json({
                success: false,
                error: 'Key and dependencies are required'
            });
        }

        const dependency = cacheInvalidation.registerDependency(key, dependencies, {
            strategy,
            ttl
        });

        await cacheInvalidation.storeDependency(key, dependency);

        res.json({
            success: true,
            data: dependency
        });
    } catch (error) {
        console.error('Register dependency error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to register dependency'
        });
    }
});

/**
 * GET /api/cache-invalidate/stats
 * Get invalidation statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await cacheInvalidation.getStatistics();

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
 * POST /api/cache-invalidate/event
 * Emit an invalidation event
 */
router.post('/event', authMiddleware, async (req, res) => {
    try {
        const { event, data } = req.body;

        if (!event) {
            return res.status(400).json({
                success: false,
                error: 'Event name is required'
            });
        }

        cacheInvalidation.emit(event, data);

        res.json({
            success: true,
            message: 'Event emitted',
            event,
            data
        });
    } catch (error) {
        console.error('Emit event error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to emit event'
        });
    }
});

module.exports = router;