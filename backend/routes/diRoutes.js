// backend/routes/diRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { container } = require('../core/diContainer');

/**
 * GET /api/di/services
 * Get registered services (admin only)
 */
router.get('/services', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const services = container.getRegisteredTokens();

        res.json({
            success: true,
            data: services,
            count: services.length
        });
    } catch (error) {
        console.error('Get services error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get services'
        });
    }
});

/**
 * GET /api/di/stats
 * Get DI container statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = container.getStats();

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
 * GET /api/di/container/info
 * Get container info
 */
router.get('/container/info', (req, res) => {
    res.json({
        success: true,
        data: {
            initialized: container.initialized,
            currentScope: container.currentScope,
            singletonCount: container.singletons.size,
            scopedCount: container.scopedInstances.size
        }
    });
});

/**
 * POST /api/di/container/reset
 * Reset container (admin only)
 */
router.post('/container/reset', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        container.reset();

        res.json({
            success: true,
            message: 'Container reset successfully'
        });
    } catch (error) {
        console.error('Reset container error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset container'
        });
    }
});

module.exports = router;