// backend/routes/identityRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { identityService, VERIFICATION_STATUS } = require('../services/aiIdentityVerificationService');

/**
 * POST /api/identity/verify
 * Verify identity claims
 */
router.post('/verify', authMiddleware, async (req, res) => {
    try {
        const { agentId, claims, context } = req.body;

        if (!agentId || !claims) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID and claims are required'
            });
        }

        const verification = await identityService.verifyIdentityClaims(agentId, claims, context);

        res.json({
            success: true,
            data: verification
        });
    } catch (error) {
        console.error('Verify identity error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to verify identity'
        });
    }
});

/**
 * GET /api/identity/alerts
 * Get hallucination alerts (admin only)
 */
router.get('/alerts', authMiddleware, (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const alerts = identityService.hallucinationAlerts;
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
 * POST /api/identity/alerts/:id/resolve
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
        const alert = identityService.hallucinationAlerts.find(a => a.id === req.params.id);

        if (!alert) {
            return res.status(404).json({
                success: false,
                error: 'Alert not found'
            });
        }

        alert.resolved = true;
        alert.resolvedAt = new Date().toISOString();
        alert.resolution = resolution;

        await db.query(
            `UPDATE identity_verification_alerts 
             SET resolved = 1, resolved_at = NOW(), resolution = ?
             WHERE alert_id = ?`,
            [resolution, alert.id]
        );

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
 * GET /api/identity/entities
 * Get known entities (admin only)
 */
router.get('/entities', authMiddleware, (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const entities = Array.from(identityService.knownEntities.entries()).map(([name, data]) => ({
            name,
            ...data
        }));

        res.json({
            success: true,
            data: entities
        });
    } catch (error) {
        console.error('Get entities error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get entities'
        });
    }
});

/**
 * GET /api/identity/facts
 * Get verified facts (admin only)
 */
router.get('/facts', authMiddleware, (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const facts = Array.from(identityService.factDatabase.entries()).map(([key, data]) => ({
            key,
            ...data
        }));

        res.json({
            success: true,
            data: facts
        });
    } catch (error) {
        console.error('Get facts error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get facts'
        });
    }
});

/**
 * GET /api/identity/stats
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

        const stats = await identityService.getStatistics();
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