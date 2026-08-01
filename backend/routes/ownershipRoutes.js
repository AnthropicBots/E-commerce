// backend/routes/ownershipRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { dataOwnershipService, DOMAINS, OWNERSHIP_TYPES } = require('../services/dataOwnershipService');

/**
 * POST /api/ownership/domains
 * Register a domain (admin only)
 */
router.post('/domains', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const domain = await dataOwnershipService.registerDomain(req.body);

        res.json({
            success: true,
            data: domain
        });
    } catch (error) {
        console.error('Register domain error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to register domain'
        });
    }
});

/**
 * GET /api/ownership/domains
 * Get all domains
 */
router.get('/domains', authMiddleware, async (req, res) => {
    try {
        const domains = dataOwnershipService.getAllDomains();

        res.json({
            success: true,
            data: domains,
            count: domains.length
        });
    } catch (error) {
        console.error('Get domains error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get domains'
        });
    }
});

/**
 * GET /api/ownership/domains/:id
 * Get domain by ID
 */
router.get('/domains/:id', authMiddleware, async (req, res) => {
    try {
        const domain = dataOwnershipService.getDomain(req.params.id);

        if (!domain) {
            return res.status(404).json({
                success: false,
                error: 'Domain not found'
            });
        }

        const dependencies = dataOwnershipService.getDomainDependencies(req.params.id);

        res.json({
            success: true,
            data: {
                domain,
                dependencies
            }
        });
    } catch (error) {
        console.error('Get domain error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get domain'
        });
    }
});

/**
 * POST /api/ownership/contracts
 * Define ownership contract (admin only)
 */
router.post('/contracts', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const contract = await dataOwnershipService.defineContract(req.body);

        res.json({
            success: true,
            data: contract
        });
    } catch (error) {
        console.error('Define contract error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to define contract'
        });
    }
});

/**
 * GET /api/ownership/contracts
 * Get all contracts
 */
router.get('/contracts', authMiddleware, async (req, res) => {
    try {
        const { owningDomain, ownershipType } = req.query;
        const contracts = dataOwnershipService.getAllContracts({ owningDomain, ownershipType });

        res.json({
            success: true,
            data: contracts,
            count: contracts.length
        });
    } catch (error) {
        console.error('Get contracts error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get contracts'
        });
    }
});

/**
 * GET /api/ownership/contracts/:entity
 * Get contract for entity
 */
router.get('/contracts/:entity', authMiddleware, async (req, res) => {
    try {
        const contract = dataOwnershipService.getContract(req.params.entity);

        if (!contract) {
            return res.status(404).json({
                success: false,
                error: 'Contract not found'
            });
        }

        res.json({
            success: true,
            data: contract
        });
    } catch (error) {
        console.error('Get contract error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get contract'
        });
    }
});

/**
 * GET /api/ownership/dependencies/cross-domain
 * Get cross-domain dependencies
 */
router.get('/dependencies/cross-domain', authMiddleware, async (req, res) => {
    try {
        const dependencies = dataOwnershipService.getCrossDomainDependencies();

        res.json({
            success: true,
            data: dependencies
        });
    } catch (error) {
        console.error('Get cross-domain dependencies error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dependencies'
        });
    }
});

/**
 * GET /api/ownership/dependencies/circular
 * Check circular dependencies
 */
router.get('/dependencies/circular', authMiddleware, async (req, res) => {
    try {
        const cycles = dataOwnershipService.checkCircularDependencies();

        res.json({
            success: true,
            data: {
                hasCircularDependencies: cycles.length > 0,
                cycles
            }
        });
    } catch (error) {
        console.error('Check circular dependencies error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check circular dependencies'
        });
    }
});

/**
 * GET /api/ownership/owner/:entity
 * Get entity owners
 */
router.get('/owner/:entity', authMiddleware, async (req, res) => {
    try {
        const owners = dataOwnershipService.getEntityOwners(req.params.entity);

        res.json({
            success: true,
            data: owners
        });
    } catch (error) {
        console.error('Get owners error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get owners'
        });
    }
});

/**
 * GET /api/ownership/stats
 * Get ownership statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await dataOwnershipService.getStatistics();

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