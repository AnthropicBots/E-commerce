// backend/routes/flagRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { featureFlagService, FLAG_TYPES, FLAG_STATUS } = require('../services/featureFlagService');

/**
 * GET /api/flags
 * Get all flags
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { status, type } = req.query;
        const flags = featureFlagService.getAllFlags({ status, type });

        res.json({
            success: true,
            data: flags,
            count: flags.length
        });
    } catch (error) {
        console.error('Get flags error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get flags'
        });
    }
});

/**
 * GET /api/flags/:key
 * Get flag by key
 */
router.get('/:key', authMiddleware, async (req, res) => {
    try {
        const flag = featureFlagService.getFlag(req.params.key);

        if (!flag) {
            return res.status(404).json({
                success: false,
                error: 'Flag not found'
            });
        }

        res.json({
            success: true,
            data: flag
        });
    } catch (error) {
        console.error('Get flag error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get flag'
        });
    }
});

/**
 * POST /api/flags
 * Create a new flag
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const flag = await featureFlagService.createFlag(req.body);

        res.json({
            success: true,
            data: flag
        });
    } catch (error) {
        console.error('Create flag error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create flag'
        });
    }
});

/**
 * PUT /api/flags/:key
 * Update flag
 */
router.put('/:key', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const flag = await featureFlagService.updateFlag(req.params.key, req.body);

        res.json({
            success: true,
            data: flag
        });
    } catch (error) {
        console.error('Update flag error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update flag'
        });
    }
});

/**
 * DELETE /api/flags/:key
 * Archive flag
 */
router.delete('/:key', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const flag = await featureFlagService.deleteFlag(req.params.key);

        res.json({
            success: true,
            data: flag
        });
    } catch (error) {
        console.error('Delete flag error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete flag'
        });
    }
});

/**
 * GET /api/flags/:key/evaluate
 * Evaluate flag
 */
router.get('/:key/evaluate', authMiddleware, async (req, res) => {
    try {
        const { userId, userGroup } = req.query;
        const context = {
            userId: userId || req.user.id,
            userGroup: userGroup || req.user.group || 'default'
        };

        const result = await featureFlagService.evaluateFlag(req.params.key, context);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Evaluate flag error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to evaluate flag'
        });
    }
});

/**
 * POST /api/flags/:key/enable
 * Enable flag
 */
router.post('/:key/enable', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const flag = await featureFlagService.updateFlag(req.params.key, {
            status: FLAG_STATUS.ACTIVE
        });

        res.json({
            success: true,
            data: flag
        });
    } catch (error) {
        console.error('Enable flag error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to enable flag'
        });
    }
});

/**
 * POST /api/flags/:key/disable
 * Disable flag
 */
router.post('/:key/disable', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const flag = await featureFlagService.updateFlag(req.params.key, {
            status: FLAG_STATUS.PAUSED
        });

        res.json({
            success: true,
            data: flag
        });
    } catch (error) {
        console.error('Disable flag error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disable flag'
        });
    }
});

/**
 * GET /api/flags/types
 * Get flag types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: FLAG_TYPES
    });
});

/**
 * GET /api/flags/statistics
 * Get flag statistics
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await featureFlagService.getStatistics();

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