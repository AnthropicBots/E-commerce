// backend/routes/cacheRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { cacheService } = require('../services/cacheService');

/**
 * GET /api/cache/stats - Cache statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }

        res.json({ success: true, data: cacheService.getStats() });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get cache stats' });
    }
});

/**
 * DELETE /api/cache/:key - Delete cache entry
 */
router.delete('/:key', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }

        const { key } = req.params;
        const { target } = req.query;
        const result = await cacheService.delete(key, target);

        res.json({ success: true, data: { deleted: result } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to delete cache' });
    }
});

/**
 * DELETE /api/cache/tags/:tag - Invalidate by tag
 */
router.delete('/tags/:tag', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }

        const count = await cacheService.invalidateByTag(req.params.tag);
        res.json({ success: true, data: { invalidated: count } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to invalidate cache' });
    }
});

/**
 * DELETE /api/cache/target/:target - Invalidate by target
 */
router.delete('/target/:target', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }

        const count = await cacheService.invalidateByTarget(req.params.target);
        res.json({ success: true, data: { invalidated: count } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to invalidate cache' });
    }
});

/**
 * DELETE /api/cache/clear - Clear all cache
 */
router.delete('/clear', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }

        await cacheService.clear();
        res.json({ success: true, message: 'Cache cleared successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to clear cache' });
    }
});

module.exports = router;