// backend/routes/configRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { configService } = require('../services/configService');

/**
 * GET /api/config
 * Get all configuration (admin only)
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const config = configService.getAll();

        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        console.error('Get config error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get configuration'
        });
    }
});

/**
 * GET /api/config/:key
 * Get configuration by key
 */
router.get('/:key', authMiddleware, (req, res) => {
    try {
        const value = configService.get(req.params.key);

        res.json({
            success: true,
            data: {
                key: req.params.key,
                value
            }
        });
    } catch (error) {
        console.error('Get config key error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get configuration'
        });
    }
});

/**
 * POST /api/config
 * Set configuration (admin only)
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { key, value, reason } = req.body;

        if (!key) {
            return res.status(400).json({
                success: false,
                error: 'Configuration key is required'
            });
        }

        await configService.set(key, value, {
            user: req.user.id,
            reason: reason || 'Updated via API'
        });

        res.json({
            success: true,
            message: 'Configuration updated successfully',
            data: { key, value }
        });
    } catch (error) {
        console.error('Set config error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update configuration'
        });
    }
});

/**
 * POST /api/config/reload
 * Reload configuration (admin only)
 */
router.post('/reload', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await configService.reload();

        res.json({
            success: true,
            message: 'Configuration reloaded successfully'
        });
    } catch (error) {
        console.error('Reload config error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to reload configuration'
        });
    }
});

/**
 * POST /api/config/reset
 * Reset configuration (admin only)
 */
router.post('/reset', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { key } = req.body;
        await configService.reset(key);

        res.json({
            success: true,
            message: key ? `Configuration "${key}" reset to default` : 'All configurations reset to default'
        });
    } catch (error) {
        console.error('Reset config error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to reset configuration'
        });
    }
});

/**
 * GET /api/config/history
 * Get configuration history (admin only)
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
        const history = configService.getHistory(parseInt(limit));

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Config history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get configuration history'
        });
    }
});

/**
 * GET /api/config/validate
 * Validate configuration (admin only)
 */
router.get('/validate', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const result = configService.validate();

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Validate config error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate configuration'
        });
    }
});

/**
 * GET /api/config/stats
 * Get configuration statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = configService.getStats();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Config stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get configuration statistics'
        });
    }
});

module.exports = router;