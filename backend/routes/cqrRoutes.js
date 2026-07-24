// backend/routes/cqrsRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { 
    commandHandler, 
    queryHandler, 
    readModelSynchronizer 
} = require('../services/cqrsService');

// ============================================
// COMMAND ROUTES (Write Operations)
// ============================================

/**
 * POST /api/cqrs/command
 * Execute a command
 */
router.post('/command', authMiddleware, async (req, res) => {
    try {
        const { type, payload } = req.body;
        const userId = req.user.id;

        if (!type) {
            return res.status(400).json({
                success: false,
                error: 'Command type is required'
            });
        }

        const result = await commandHandler.execute({
            type,
            payload,
            userId
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Command error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to execute command'
        });
    }
});

// ============================================
// QUERY ROUTES (Read Operations)
// ============================================

/**
 * POST /api/cqrs/query
 * Execute a query
 */
router.post('/query', authMiddleware, async (req, res) => {
    try {
        const { type, params = {} } = req.body;
        const userId = req.user.id;

        if (!type) {
            return res.status(400).json({
                success: false,
                error: 'Query type is required'
            });
        }

        const result = await queryHandler.execute({
            type,
            params,
            userId
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Query error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to execute query'
        });
    }
});

// ============================================
// STATISTICS ROUTES
// ============================================

/**
 * GET /api/cqrs/stats
 * Get CQRS statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const commandStats = commandHandler.getStatistics();
        const queryStats = queryHandler.getStatistics();

        res.json({
            success: true,
            data: {
                commands: commandStats,
                queries: queryStats,
                lastSync: readModelSynchronizer.lastSync,
                isSyncing: readModelSynchronizer.isSyncing
            }
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
 * DELETE /api/cqrs/cache
 * Clear query cache (admin only)
 */
router.delete('/cache', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        queryHandler.clearCache();

        res.json({
            success: true,
            message: 'Query cache cleared'
        });
    } catch (error) {
        console.error('Cache clear error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear cache'
        });
    }
});

/**
 * POST /api/cqrs/sync
 * Trigger read model sync (admin only)
 */
router.post('/sync', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await readModelSynchronizer.syncReadModels();

        res.json({
            success: true,
            message: 'Read models synced successfully',
            lastSync: readModelSynchronizer.lastSync
        });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync read models'
        });
    }
});

module.exports = router;