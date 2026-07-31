// backend/routes/schemaRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { schemaRegistryService, SCHEMA_TYPES } = require('../services/schemaRegistryService');

/**
 * POST /api/schemas
 * Register a new schema (admin only)
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const schema = await schemaRegistryService.registerSchema(req.body);

        res.json({
            success: true,
            data: schema
        });
    } catch (error) {
        console.error('Register schema error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to register schema'
        });
    }
});

/**
 * GET /api/schemas
 * Get all schemas
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { type, status, name } = req.query;
        const schemas = schemaRegistryService.getAllSchemas({ type, status, name });

        res.json({
            success: true,
            data: schemas,
            count: schemas.length
        });
    } catch (error) {
        console.error('Get schemas error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get schemas'
        });
    }
});

/**
 * GET /api/schemas/:id
 * Get schema by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const schema = schemaRegistryService.getSchema(req.params.id);

        if (!schema) {
            return res.status(404).json({
                success: false,
                error: 'Schema not found'
            });
        }

        res.json({
            success: true,
            data: schema
        });
    } catch (error) {
        console.error('Get schema error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get schema'
        });
    }
});

/**
 * GET /api/schemas/name/:name
 * Get schema by name
 */
router.get('/name/:name', authMiddleware, async (req, res) => {
    try {
        const { name } = req.params;
        const { version } = req.query;

        const schema = schemaRegistryService.getSchemaByName(name, version || 'latest');

        if (!schema) {
            return res.status(404).json({
                success: false,
                error: 'Schema not found'
            });
        }

        res.json({
            success: true,
            data: schema
        });
    } catch (error) {
        console.error('Get schema by name error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get schema'
        });
    }
});

/**
 * POST /api/schemas/:id/activate
 * Activate a schema (admin only)
 */
router.post('/:id/activate', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const schema = await schemaRegistryService.activateSchema(req.params.id);

        res.json({
            success: true,
            data: schema
        });
    } catch (error) {
        console.error('Activate schema error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to activate schema'
        });
    }
});

/**
 * POST /api/schemas/:id/deprecate
 * Deprecate a schema (admin only)
 */
router.post('/:id/deprecate', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { reason } = req.body;
        const schema = await schemaRegistryService.deprecateSchema(req.params.id, reason);

        res.json({
            success: true,
            data: schema
        });
    } catch (error) {
        console.error('Deprecate schema error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to deprecate schema'
        });
    }
});

/**
 * POST /api/schemas/:id/archive
 * Archive a schema (admin only)
 */
router.post('/:id/archive', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const schema = await schemaRegistryService.archiveSchema(req.params.id);

        res.json({
            success: true,
            data: schema
        });
    } catch (error) {
        console.error('Archive schema error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to archive schema'
        });
    }
});

/**
 * POST /api/schemas/compare
 * Compare schema versions
 */
router.post('/compare', authMiddleware, async (req, res) => {
    try {
        const { name, version1, version2 } = req.body;

        if (!name || !version1 || !version2) {
            return res.status(400).json({
                success: false,
                error: 'Name, version1, and version2 are required'
            });
        }

        const diff = schemaRegistryService.compareVersions(name, version1, version2);

        res.json({
            success: true,
            data: diff
        });
    } catch (error) {
        console.error('Compare schemas error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to compare schemas'
        });
    }
});

/**
 * POST /api/schemas/generate
 * Generate schema from example
 */
router.post('/generate', authMiddleware, async (req, res) => {
    try {
        const { example, name, options } = req.body;

        if (!example || !name) {
            return res.status(400).json({
                success: false,
                error: 'Example and name are required'
            });
        }

        const schema = schemaRegistryService.generateSchemaFromExample(example, name, options);

        res.json({
            success: true,
            data: schema
        });
    } catch (error) {
        console.error('Generate schema error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate schema'
        });
    }
});

/**
 * GET /api/schemas/types
 * Get schema types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: SCHEMA_TYPES
    });
});

/**
 * GET /api/schemas/statistics
 * Get schema statistics (admin only)
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await schemaRegistryService.getStatistics();

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