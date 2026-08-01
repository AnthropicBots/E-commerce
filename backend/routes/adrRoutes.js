// backend/routes/adrRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { adrService, ADR_STATUS, ADR_CATEGORIES } = require('../services/adrService');

/**
 * POST /api/adr
 * Create a new ADR (admin only)
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const adr = await adrService.createADR({
            ...req.body,
            author: req.user.name || req.user.email
        });

        res.json({
            success: true,
            data: adr
        });
    } catch (error) {
        console.error('Create ADR error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create ADR'
        });
    }
});

/**
 * GET /api/adr
 * Get all ADRs
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { status, category, tag, search } = req.query;
        const adrs = adrService.getAllADRs({ status, category, tag, search });

        res.json({
            success: true,
            data: adrs,
            count: adrs.length
        });
    } catch (error) {
        console.error('Get ADRs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get ADRs'
        });
    }
});

/**
 * GET /api/adr/:id
 * Get ADR by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const adr = adrService.getADR(req.params.id);

        if (!adr) {
            return res.status(404).json({
                success: false,
                error: 'ADR not found'
            });
        }

        res.json({
            success: true,
            data: adr
        });
    } catch (error) {
        console.error('Get ADR error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get ADR'
        });
    }
});

/**
 * PUT /api/adr/:id
 * Update ADR (admin only)
 */
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const adr = await adrService.updateADR(req.params.id, req.body);

        res.json({
            success: true,
            data: adr
        });
    } catch (error) {
        console.error('Update ADR error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update ADR'
        });
    }
});

/**
 * PATCH /api/adr/:id/status
 * Update ADR status (admin only)
 */
router.patch('/:id/status', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { status, reason } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Status is required'
            });
        }

        const adr = await adrService.updateStatus(req.params.id, status, reason);

        res.json({
            success: true,
            data: adr
        });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update status'
        });
    }
});

/**
 * GET /api/adr/search
 * Search ADRs
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

        const results = adrService.searchADRs(q);

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    } catch (error) {
        console.error('Search ADR error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search ADRs'
        });
    }
});

/**
 * GET /api/adr/statuses
 * Get all ADR statuses
 */
router.get('/statuses', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: ADR_STATUS
    });
});

/**
 * GET /api/adr/categories
 * Get all ADR categories
 */
router.get('/categories', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: ADR_CATEGORIES
    });
});

/**
 * GET /api/adr/tags
 * Get all ADR tags
 */
router.get('/tags', authMiddleware, (req, res) => {
    const tags = Array.from(adrService.tags.keys());

    res.json({
        success: true,
        data: tags
    });
});

/**
 * GET /api/adr/stats
 * Get ADR statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await adrService.getStatistics();

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