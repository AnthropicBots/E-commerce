// backend/routes/provenanceRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { provenanceService } = require('../services/provenanceService');

/**
 * GET /api/provenance/:entityId
 * Get provenance for an entity
 */
router.get('/:entityId', authMiddleware, async (req, res) => {
    try {
        const { entityId } = req.params;
        const { entityType, limit } = req.query;

        const records = await provenanceService.getProvenance(
            entityId,
            entityType,
            { limit: parseInt(limit) || 100 }
        );

        res.json({
            success: true,
            data: records,
            count: records.length
        });
    } catch (error) {
        console.error('Get provenance error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get provenance'
        });
    }
});

/**
 * GET /api/provenance/:entityId/lineage
 * Get entity lineage
 */
router.get('/:entityId/lineage', authMiddleware, async (req, res) => {
    try {
        const { entityId } = req.params;
        const { entityType } = req.query;

        const lineage = await provenanceService.getEntityLineage(entityId, entityType);

        res.json({
            success: true,
            data: lineage
        });
    } catch (error) {
        console.error('Get lineage error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get lineage'
        });
    }
});

/**
 * GET /api/provenance/:entityId/flow
 * Get entity flow
 */
router.get('/:entityId/flow', authMiddleware, async (req, res) => {
    try {
        const { entityId } = req.params;
        const { entityType } = req.query;

        const flow = await provenanceService.getEntityFlow(entityId, entityType);

        res.json({
            success: true,
            data: flow
        });
    } catch (error) {
        console.error('Get flow error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get flow'
        });
    }
});

/**
 * GET /api/provenance/modules/dependencies
 * Get module dependencies
 */
router.get('/modules/dependencies', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const dependencies = await provenanceService.getModuleDependencies();

        res.json({
            success: true,
            data: dependencies
        });
    } catch (error) {
        console.error('Get dependencies error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dependencies'
        });
    }
});

/**
 * GET /api/provenance/correlation/:correlationId
 * Get records by correlation ID
 */
router.get('/correlation/:correlationId', authMiddleware, async (req, res) => {
    try {
        const { correlationId } = req.params;
        const records = await provenanceService.getByCorrelationId(correlationId);

        res.json({
            success: true,
            data: records
        });
    } catch (error) {
        console.error('Get by correlation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get records'
        });
    }
});

/**
 * GET /api/provenance/search
 * Search provenance records
 */
router.get('/search', authMiddleware, async (req, res) => {
    try {
        const { q } = req.query;

        if (!q) {
            return res.status(400).json({
                success: false,
                error: 'Search query is required'
            });
        }

        const results = await provenanceService.searchProvenance(q);

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search'
        });
    }
});

/**
 * GET /api/provenance/stats
 * Get provenance statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await provenanceService.getStatistics();

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