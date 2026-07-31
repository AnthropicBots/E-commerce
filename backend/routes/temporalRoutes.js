// backend/routes/temporalRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { temporalDataService, ENTITY_TYPES } = require('../services/temporalDataService');

/**
 * GET /api/temporal/:entityType/:entityId/versions
 * Get all versions of an entity
 */
router.get('/:entityType/:entityId/versions', authMiddleware, async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const { fromDate, toDate, modifiedBy, limit } = req.query;

        const versions = await temporalDataService.getVersions(
            entityType,
            entityId,
            { fromDate, toDate, modifiedBy, limit: parseInt(limit) || 100 }
        );

        res.json({
            success: true,
            data: versions,
            count: versions.length
        });
    } catch (error) {
        console.error('Get versions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get versions'
        });
    }
});

/**
 * GET /api/temporal/:entityType/:entityId/current
 * Get current version
 */
router.get('/:entityType/:entityId/current', authMiddleware, async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const version = await temporalDataService.getCurrentVersion(entityType, entityId);

        if (!version) {
            return res.status(404).json({
                success: false,
                error: 'No version found'
            });
        }

        res.json({
            success: true,
            data: version
        });
    } catch (error) {
        console.error('Get current version error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get current version'
        });
    }
});

/**
 * GET /api/temporal/:entityType/:entityId/version/:versionNumber
 * Get specific version
 */
router.get('/:entityType/:entityId/version/:versionNumber', authMiddleware, async (req, res) => {
    try {
        const { entityType, entityId, versionNumber } = req.params;
        const version = await temporalDataService.getVersion(
            entityType,
            entityId,
            parseInt(versionNumber)
        );

        if (!version) {
            return res.status(404).json({
                success: false,
                error: 'Version not found'
            });
        }

        res.json({
            success: true,
            data: version
        });
    } catch (error) {
        console.error('Get version error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get version'
        });
    }
});

/**
 * GET /api/temporal/:entityType/:entityId/history
 * Get version history with pagination
 */
router.get('/:entityType/:entityId/history', authMiddleware, async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const history = await temporalDataService.getVersionHistory(
            entityType,
            entityId,
            parseInt(page),
            parseInt(limit)
        );

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get history'
        });
    }
});

/**
 * GET /api/temporal/:entityType/:entityId/state
 * Get state at specific time
 */
router.get('/:entityType/:entityId/state', authMiddleware, async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const { timestamp } = req.query;

        if (!timestamp) {
            return res.status(400).json({
                success: false,
                error: 'Timestamp is required'
            });
        }

        const version = await temporalDataService.getStateAtTime(
            entityType,
            entityId,
            timestamp
        );

        if (!version) {
            return res.status(404).json({
                success: false,
                error: 'No version found at this time'
            });
        }

        res.json({
            success: true,
            data: version
        });
    } catch (error) {
        console.error('Get state error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get state'
        });
    }
});

/**
 * POST /api/temporal/:entityType/:entityId/save
 * Save new version (admin only)
 */
router.post('/:entityType/:entityId/save', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { entityType, entityId } = req.params;
        const { data, metadata } = req.body;

        if (!data) {
            return res.status(400).json({
                success: false,
                error: 'Data is required'
            });
        }

        const version = await temporalDataService.saveVersion(
            entityType,
            entityId,
            data,
            {
                ...metadata,
                modifiedBy: req.user.id
            }
        );

        res.json({
            success: true,
            data: version
        });
    } catch (error) {
        console.error('Save version error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to save version'
        });
    }
});

/**
 * GET /api/temporal/:entityType/:entityId/compare
 * Compare two versions
 */
router.get('/:entityType/:entityId/compare', authMiddleware, async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const { version1, version2 } = req.query;

        if (!version1 || !version2) {
            return res.status(400).json({
                success: false,
                error: 'Both version numbers are required'
            });
        }

        const v1 = await temporalDataService.getVersion(entityType, entityId, parseInt(version1));
        const v2 = await temporalDataService.getVersion(entityType, entityId, parseInt(version2));

        if (!v1 || !v2) {
            return res.status(404).json({
                success: false,
                error: 'One or both versions not found'
            });
        }

        const diff = temporalDataService.compareVersions(v1, v2);

        res.json({
            success: true,
            data: diff
        });
    } catch (error) {
        console.error('Compare versions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to compare versions'
        });
    }
});

/**
 * GET /api/temporal/:entityType/:entityId/evolution
 * Get evolution timeline
 */
router.get('/:entityType/:entityId/evolution', authMiddleware, async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const timeline = await temporalDataService.getEvolutionTimeline(entityType, entityId);

        res.json({
            success: true,
            data: timeline
        });
    } catch (error) {
        console.error('Get evolution error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get evolution timeline'
        });
    }
});

/**
 * POST /api/temporal/archive/run
 * Run archive manually (admin only)
 */
router.post('/archive/run', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await temporalDataService.archiveOldRecords();

        res.json({
            success: true,
            message: 'Archive process completed'
        });
    } catch (error) {
        console.error('Run archive error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to run archive'
        });
    }
});

/**
 * GET /api/temporal/stats
 * Get temporal statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await temporalDataService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

module.exports = router;