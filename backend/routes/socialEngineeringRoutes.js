// backend/routes/socialEngineeringRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { protectionService } = require('../services/socialEngineeringProtectionService');

/**
 * GET /api/social-engineering/alerts
 * Get alerts (admin only)
 */
router.get('/alerts', authMiddleware, (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const alerts = protectionService.getAlerts();
        res.json({
            success: true,
            data: alerts
        });
    } catch (error) {
        console.error('Get alerts error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get alerts'
        });
    }
});

/**
 * POST /api/social-engineering/alerts/:id/resolve
 * Resolve an alert (admin only)
 */
router.post('/alerts/:id/resolve', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { resolution } = req.body;
        const alert = await protectionService.resolveAlert(req.params.id, resolution);

        res.json({
            success: true,
            data: alert
        });
    } catch (error) {
        console.error('Resolve alert error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to resolve alert'
        });
    }
});

/**
 * GET /api/social-engineering/verify
 * Verify an authority claim
 */
router.post('/verify', authMiddleware, async (req, res) => {
    try {
        const { agentId, claimData } = req.body;

        if (!agentId || !claimData) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID and claim data are required'
            });
        }

        const verification = await protectionService.verifyAuthority(agentId, claimData);

        res.json({
            success: true,
            data: verification
        });
    } catch (error) {
        console.error('Verify authority error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to verify authority'
        });
    }
});

/**
 * GET /api/social-engineering/limits
 * Get hard limits (admin only)
 */
router.get('/limits', authMiddleware, (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const limits = Array.from(protectionService.hardLimits.entries()).map(([name, value]) => ({
            name,
            value
        }));

        res.json({
            success: true,
            data: limits
        });
    } catch (error) {
        console.error('Get limits error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get limits'
        });
    }
});

/**
 * PUT /api/social-engineering/limits/:name
 * Update a hard limit (admin only)
 */
router.put('/limits/:name', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { name } = req.params;
        const { value } = req.body;

        if (value === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Value is required'
            });
        }

        // Update in database
        await db.query(
            `INSERT INTO hard_limits (name, value, active) 
             VALUES (?, ?, 1) 
             ON DUPLICATE KEY UPDATE value = ?, updated_at = NOW()`,
            [name, JSON.stringify(value), JSON.stringify(value)]
        );

        // Update in memory
        protectionService.hardLimits.set(name, value);

        res.json({
            success: true,
            message: `Limit ${name} updated to ${value}`
        });
    } catch (error) {
        console.error('Update limit error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update limit'
        });
    }
});

/**
 * GET /api/social-engineering/stats
 * Get statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await protectionService.getStatistics();
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