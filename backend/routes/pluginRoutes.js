// backend/routes/pluginRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { pluginSystem, PLUGIN_TYPES } = require('../services/pluginSystemService');

/**
 * GET /api/plugins
 * Get all plugins
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { type, status, loaded } = req.query;
        const plugins = pluginSystem.getAllPlugins({ type, status, loaded });

        res.json({
            success: true,
            data: plugins,
            count: plugins.length
        });
    } catch (error) {
        console.error('Get plugins error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get plugins'
        });
    }
});

/**
 * GET /api/plugins/active
 * Get active plugins
 */
router.get('/active', authMiddleware, (req, res) => {
    try {
        const plugins = pluginSystem.getActivePlugins();

        res.json({
            success: true,
            data: plugins,
            count: plugins.length
        });
    } catch (error) {
        console.error('Get active plugins error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get active plugins'
        });
    }
});

/**
 * GET /api/plugins/:id
 * Get plugin by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const plugin = pluginSystem.getPlugin(req.params.id);

        if (!plugin) {
            return res.status(404).json({
                success: false,
                error: 'Plugin not found'
            });
        }

        res.json({
            success: true,
            data: plugin
        });
    } catch (error) {
        console.error('Get plugin error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get plugin'
        });
    }
});

/**
 * POST /api/plugins
 * Register a new plugin
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const plugin = await pluginSystem.registerPlugin(req.body);

        res.json({
            success: true,
            data: plugin
        });
    } catch (error) {
        console.error('Register plugin error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to register plugin'
        });
    }
});

/**
 * POST /api/plugins/:id/load
 * Load a plugin
 */
router.post('/:id/load', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const plugin = await pluginSystem.loadPlugin(req.params.id);

        res.json({
            success: true,
            data: plugin
        });
    } catch (error) {
        console.error('Load plugin error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to load plugin'
        });
    }
});

/**
 * POST /api/plugins/:id/unload
 * Unload a plugin
 */
router.post('/:id/unload', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const plugin = await pluginSystem.unloadPlugin(req.params.id);

        res.json({
            success: true,
            data: plugin
        });
    } catch (error) {
        console.error('Unload plugin error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to unload plugin'
        });
    }
});

/**
 * DELETE /api/plugins/:id
 * Uninstall a plugin
 */
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const result = await pluginSystem.uninstallPlugin(req.params.id);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Uninstall plugin error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to uninstall plugin'
        });
    }
});

/**
 * POST /api/plugins/hooks/:hookName/execute
 * Execute a hook
 */
router.post('/hooks/:hookName/execute', authMiddleware, async (req, res) => {
    try {
        const { hookName } = req.params;
        const { data } = req.body;

        const results = await pluginSystem.executeHook(hookName, data || {});

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Execute hook error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to execute hook'
        });
    }
});

/**
 * GET /api/plugins/types
 * Get plugin types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: PLUGIN_TYPES
    });
});

/**
 * GET /api/plugins/statistics
 * Get plugin statistics
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await pluginSystem.getStatistics();

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