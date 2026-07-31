// backend/routes/discoveryRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { 
    capabilityDiscoveryService,
    CAPABILITY_STATUS,
    CAPABILITY_CATEGORIES
} = require('../services/capabilityDiscoveryService');

/**
 * GET /api/discovery/services
 * Get all services
 */
router.get('/services', authMiddleware, async (req, res) => {
    try {
        const services = Array.from(capabilityDiscoveryService.services.values());

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
 * GET /api/discovery/services/:id
 * Get service by ID
 */
router.get('/services/:id', authMiddleware, async (req, res) => {
    try {
        const service = capabilityDiscoveryService.services.get(req.params.id);

        if (!service) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        const capabilities = capabilityDiscoveryService.getServiceCapabilities(req.params.id);

        res.json({
            success: true,
            data: {
                service,
                capabilities,
                dependencies: capabilityDiscoveryService.getDependencies(req.params.id)
            }
        });
    } catch (error) {
        console.error('Get service error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get service'
        });
    }
});

/**
 * POST /api/discovery/services
 * Register a service (admin only)
 */
router.post('/services', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const service = await capabilityDiscoveryService.registerService(req.body);

        res.json({
            success: true,
            data: service
        });
    } catch (error) {
        console.error('Register service error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to register service'
        });
    }
});

/**
 * GET /api/discovery/capabilities
 * Get all capabilities
 */
router.get('/capabilities', authMiddleware, async (req, res) => {
    try {
        const { category, search } = req.query;
        let capabilities = Array.from(capabilityDiscoveryService.capabilities.values());

        if (category) {
            capabilities = capabilities.filter(c => c.category === category);
        }

        if (search) {
            capabilities = capabilityDiscoveryService.searchCapabilities(search);
        }

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
 * GET /api/discovery/capabilities/:id
 * Get capability by ID
 */
router.get('/capabilities/:id', authMiddleware, async (req, res) => {
    try {
        const capability = capabilityDiscoveryService.capabilities.get(req.params.id);

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
 * POST /api/discovery/capabilities
 * Register a capability (admin only)
 */
router.post('/capabilities', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { serviceId, ...capabilityData } = req.body;

        if (!serviceId) {
            return res.status(400).json({
                success: false,
                error: 'Service ID is required'
            });
        }

        const capability = await capabilityDiscoveryService.registerCapability(
            serviceId,
            capabilityData
        );

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
 * GET /api/discovery/categories
 * Get all categories
 */
router.get('/categories', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: CAPABILITY_CATEGORIES
    });
});

/**
 * GET /api/discovery/statuses
 * Get all statuses
 */
router.get('/statuses', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: CAPABILITY_STATUS
    });
});

/**
 * GET /api/discovery/graph
 * Get dependency graph
 */
router.get('/graph', authMiddleware, async (req, res) => {
    try {
        const graph = capabilityDiscoveryService.getDependencyGraph();

        res.json({
            success: true,
            data: Array.from(graph.entries())
        });
    } catch (error) {
        console.error('Get graph error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dependency graph'
        });
    }
});

/**
 * GET /api/discovery/health/:serviceId
 * Get service health
 */
router.get('/health/:serviceId', authMiddleware, async (req, res) => {
    try {
        const health = capabilityDiscoveryService.getServiceHealth(req.params.serviceId);

        res.json({
            success: true,
            data: health
        });
    } catch (error) {
        console.error('Service health error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get service health'
        });
    }
});

/**
 * GET /api/discovery/stats
 * Get discovery statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await capabilityDiscoveryService.getStatistics();

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