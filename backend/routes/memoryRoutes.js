// backend/routes/memoryRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { memoryPressureService, PRESSURE_LEVELS } = require('../services/memoryPressureService');

/**
 * GET /api/memory/status
 * Get current memory status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = memoryPressureService.getStatus();

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get memory status'
        });
    }
});

/**
 * GET /api/memory/metrics
 * Get detailed memory metrics (admin only)
 */
router.get('/metrics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await memoryPressureService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Metrics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get memory metrics'
        });
    }
});

/**
 * GET /api/memory/history
 * Get memory history (admin only)
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
        const history = memoryPressureService.history.slice(-parseInt(limit));

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get memory history'
        });
    }
});

/**
 * POST /api/memory/evict
 * Force cache eviction (admin only)
 */
router.post('/evict', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        memoryPressureService.forceEviction();

        res.json({
            success: true,
            message: 'Cache eviction triggered'
        });
    } catch (error) {
        console.error('Eviction error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to trigger eviction'
        });
    }
});

/**
 * POST /api/memory/cache/register
 * Register a cache (admin only)
 */
router.post('/cache/register', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { name, strategy, maxSize, minSize } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Cache name is required'
            });
        }

        const cache = memoryPressureService.registerCache(name, null, {
            strategy,
            maxSize,
            minSize
        });

        res.json({
            success: true,
            data: cache
        });
    } catch (error) {
        console.error('Register cache error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to register cache'
        });
    }
});

/**
 * GET /api/memory/caches
 * Get all registered caches (admin only)
 */
router.get('/caches', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const caches = Array.from(memoryPressureService.caches.entries()).map(([name, cache]) => ({
            name,
            ...cache
        }));

        res.json({
            success: true,
            data: caches
        });
    } catch (error) {
        console.error('Get caches error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get caches'
        });
    }
});

/**
 * GET /api/memory/pressure-levels
 * Get pressure levels
 */
router.get('/pressure-levels', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: PRESSURE_LEVELS
    });
});

/**
 * POST /api/memory/gc
 * Trigger garbage collection (admin only)
 */
router.post('/gc', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        if (global.gc) {
            global.gc();
            res.json({
                success: true,
                message: 'Garbage collection triggered'
            });
        } else {
            res.json({
                success: false,
                message: 'Garbage collection not available (run with --expose-gc)'
            });
        }
    } catch (error) {
        console.error('GC error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to trigger GC'
        });
    }
});

module.exports = router;