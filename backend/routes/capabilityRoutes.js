// backend/routes/capabilityRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { 
    capabilityMappingService,
    CAPABILITY_TYPES,
    CAPABILITY_STATUS,
    DATA_OWNERSHIP
} = require('../services/capabilityMappingService');

/**
 * POST /api/capabilities
 * Register a capability (admin only)
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const capability = await capabilityMappingService.registerCapability(req.body);

        res.json({
            success: true,
            data: capability
        });
    } catch (error) {
        console.error('Register capability error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to register capability'
        });
    }
});

/**
 * GET /api/capabilities
 * Get all capabilities
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { type, status, ownerModule, search } = req.query;
        const capabilities = capabilityMappingService.getAllCapabilities({
            type, status, ownerModule, search
        });

        res.json({
            success: true,
            data: capabilities,
            count: capabilities.length
        });
    } catch (error) {
        console.error('Get capabilities error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get capabilities'
        });
    }
});

/**
 * GET /api/capabilities/:id
 * Get capability by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const capability = capabilityMappingService.getCapability(req.params.id);

        if (!capability) {
            return res.status(404).json({
                success: false,
                error: 'Capability not found'
            });
        }

        res.json({
            success: true,
            data: capability
        });
    } catch (error) {
        console.error('Get capability error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get capability'
        });
    }
});

/**
 * GET /api/capabilities/:id/impact
 * Get impact analysis
 */
router.get('/:id/impact', authMiddleware, async (req, res) => {
    try {
        const impact = capabilityMappingService.getImpactAnalysis(req.params.id);

        res.json({
            success: true,
            data: impact
        });
    } catch (error) {
        console.error('Impact analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get impact analysis'
        });
    }
});

/**
 * POST /api/modules
 * Register a module (admin only)
 */
router.post('/modules', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const module = await capabilityMappingService.registerModule(req.body);

        res.json({
            success: true,
            data: module
        });
    } catch (error) {
        console.error('Register module error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to register module'
        });
    }
});

/**
 * GET /api/modules
 * Get all modules
 */
router.get('/modules', authMiddleware, async (req, res) => {
    try {
        const modules = capabilityMappingService.getAllModules();

        res.json({
            success: true,
            data: modules,
            count: modules.length
        });
    } catch (error) {
        console.error('Get modules error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get modules'
        });
    }
});

/**
 * GET /api/modules/:id
 * Get module by ID
 */
router.get('/modules/:id', authMiddleware, async (req, res) => {
    try {
        const module = capabilityMappingService.getModule(req.params.id);

        if (!module) {
            return res.status(404).json({
                success: false,
                error: 'Module not found'
            });
        }

        const capabilities = capabilityMappingService.getCapabilitiesByModule(req.params.id);

        res.json({
            success: true,
            data: {
                module,
                capabilities
            }
        });
    } catch (error) {
        console.error('Get module error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get module'
        });
    }
});

/**
 * GET /api/mapping/data-ownership
 * Get data ownership map
 */
router.get('/mapping/data-ownership', authMiddleware, async (req, res) => {
    try {
        const ownership = capabilityMappingService.getDataOwnershipMap();

        res.json({
            success: true,
            data: ownership
        });
    } catch (error) {
        console.error('Data ownership error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get data ownership'
        });
    }
});

/**
 * GET /api/mapping/dependencies
 * Get dependency graph
 */
router.get('/mapping/dependencies', authMiddleware, async (req, res) => {
    try {
        const graph = capabilityMappingService.getDependencyGraph();

        res.json({
            success: true,
            data: graph
        });
    } catch (error) {
        console.error('Dependency graph error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dependency graph'
        });
    }
});

/**
 * GET /api/mapping/consumers
 * Get consumer map
 */
router.get('/mapping/consumers', authMiddleware, async (req, res) => {
    try {
        const consumers = capabilityMappingService.getConsumerMap();

        res.json({
            success: true,
            data: consumers
        });
    } catch (error) {
        console.error('Consumer map error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get consumer map'
        });
    }
});

/**
 * GET /api/capabilities/types
 * Get capability types
 */
router.get('/capabilities/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: CAPABILITY_TYPES
    });
});

/**
 * GET /api/capabilities/statuses
 * Get capability statuses
 */
router.get('/capabilities/statuses', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: CAPABILITY_STATUS
    });
});

/**
 * GET /api/mapping/stats
 * Get mapping statistics (admin only)
 */
router.get('/mapping/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await capabilityMappingService.getStatistics();

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

module.exports = router;