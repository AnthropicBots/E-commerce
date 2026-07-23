// backend/routes/policyRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { policyEngine } = require('../services/policyEngineService');

/**
 * GET /api/policies
 * Get all policies (admin only)
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const policies = Array.from(policyEngine.policies.values());

        res.json({
            success: true,
            data: policies,
            count: policies.length
        });
    } catch (error) {
        console.error('Get policies error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get policies'
        });
    }
});

/**
 * GET /api/policies/:id
 * Get policy by ID (admin only)
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const policy = policyEngine.policies.get(req.params.id);

        if (!policy) {
            return res.status(404).json({
                success: false,
                error: 'Policy not found'
            });
        }

        res.json({
            success: true,
            data: policy
        });
    } catch (error) {
        console.error('Get policy error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get policy'
        });
    }
});

/**
 * POST /api/policies
 * Create a new policy (admin only)
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const policy = await policyEngine.createPolicy(req.body);

        res.json({
            success: true,
            data: policy
        });
    } catch (error) {
        console.error('Create policy error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create policy'
        });
    }
});

/**
 * PUT /api/policies/:id
 * Update a policy (admin only)
 */
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const policy = await policyEngine.updatePolicy(req.params.id, req.body);

        res.json({
            success: true,
            data: policy
        });
    } catch (error) {
        console.error('Update policy error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update policy'
        });
    }
});

/**
 * DELETE /api/policies/:id
 * Delete a policy (admin only)
 */
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const result = await policyEngine.deletePolicy(req.params.id);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Delete policy error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete policy'
        });
    }
});

/**
 * POST /api/policies/evaluate
 * Evaluate authorization (for testing)
 */
router.post('/evaluate', authMiddleware, async (req, res) => {
    try {
        const { user, resource, action, context } = req.body;

        const result = await policyEngine.evaluate(user, resource, action, context);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Evaluate error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to evaluate'
        });
    }
});

/**
 * GET /api/policies/statistics
 * Get policy statistics (admin only)
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await policyEngine.getStatistics();

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

/**
 * POST /api/policies/reload
 * Reload policies from filesystem (admin only)
 */
router.post('/reload', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await policyEngine.loadPolicyFiles();

        res.json({
            success: true,
            message: 'Policies reloaded'
        });
    } catch (error) {
        console.error('Reload error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reload policies'
        });
    }
});

module.exports = router;