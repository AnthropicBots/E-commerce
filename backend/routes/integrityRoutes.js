// backend/routes/integrityRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { configIntegrityService } = require('../services/configIntegrityService');

/**
 * GET /api/integrity/status
 * Get integrity status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = configIntegrityService.getStatus();

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get status'
        });
    }
});

/**
 * POST /api/integrity/verify
 * Verify configuration integrity (admin only)
 */
router.post('/verify', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const results = await configIntegrityService.verifyConfiguration();

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to verify configuration'
        });
    }
});

/**
 * POST /api/integrity/update-manifest
 * Update integrity manifest (admin only)
 */
router.post('/update-manifest', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await configIntegrityService.updateManifest();

        res.json({
            success: true,
            message: 'Manifest updated successfully'
        });
    } catch (error) {
        console.error('Update manifest error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update manifest'
        });
    }
});

/**
 * GET /api/integrity/history
 * Get verification history (admin only)
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { limit = 50 } = req.query;
        const history = configIntegrityService.getVerificationResults(parseInt(limit));

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get history'
        });
    }
});

/**
 * GET /api/integrity/alerts
 * Get integrity alerts (admin only)
 */
router.get('/alerts', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { limit = 50 } = req.query;
        const alerts = configIntegrityService.getAlerts(parseInt(limit));

        res.json({
            success: true,
            data: alerts
        });
    } catch (error) {
        console.error('Alerts error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get alerts'
        });
    }
});

/**
 * POST /api/integrity/alerts/:id/resolve
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
        const alert = await configIntegrityService.resolveAlert(req.params.id, resolution);

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
 * GET /api/integrity/stats
 * Get integrity statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await configIntegrityService.getStatistics();

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