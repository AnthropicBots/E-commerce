// backend/routes/slaRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { slaService, SLA_METRICS, SLA_SEVERITY } = require('../services/businessSLAService');

/**
 * GET /api/sla/metrics
 * Get all SLA metrics
 */
router.get('/metrics', authMiddleware, async (req, res) => {
    try {
        const metrics = Array.from(slaService.thresholdConfig.entries()).map(([name, config]) => ({
            name,
            ...config
        }));

        res.json({
            success: true,
            data: metrics
        });
    } catch (error) {
        console.error('Get metrics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get metrics'
        });
    }
});

/**
 * GET /api/sla/metrics/:metric/summary
 * Get metrics summary
 */
router.get('/metrics/:metric/summary', authMiddleware, async (req, res) => {
    try {
        const { metric } = req.params;
        const { period = '24h' } = req.query;

        const summary = await slaService.getMetricsSummary(metric, period);

        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        console.error('Get summary error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get summary'
        });
    }
});

/**
 * GET /api/sla/dashboard
 * Get SLA dashboard
 */
router.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const [metrics, health, stats] = await Promise.all([
            slaService.getMetricsSummary(),
            slaService.getHealthStatus(),
            slaService.getStatistics()
        ]);

        res.json({
            success: true,
            data: {
                metrics,
                health,
                stats
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dashboard'
        });
    }
});

/**
 * GET /api/sla/alerts
 * Get SLA alerts
 */
router.get('/alerts', authMiddleware, async (req, res) => {
    try {
        const { resolved = false, limit = 50 } = req.query;
        const alerts = slaService.getAlerts(resolved === 'true', parseInt(limit));

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
 * POST /api/sla/alerts/:id/resolve
 * Resolve SLA alert (admin only)
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
        const alert = await slaService.resolveAlert(req.params.id, resolution);

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
 * PUT /api/sla/metrics/:metric/config
 * Update SLA configuration (admin only)
 */
router.put('/metrics/:metric/config', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { metric } = req.params;
        const { threshold, warningThreshold, criticalThreshold, unit } = req.body;

        if (!threshold) {
            return res.status(400).json({
                success: false,
                error: 'Threshold is required'
            });
        }

        const config = { threshold, warningThreshold, criticalThreshold, unit };
        await slaService.saveSLAConfig(metric, config);
        slaService.thresholdConfig.set(metric, config);

        res.json({
            success: true,
            message: 'SLA configuration updated',
            data: config
        });
    } catch (error) {
        console.error('Update config error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update configuration'
        });
    }
});

/**
 * GET /api/sla/status
 * Get SLA service status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = slaService.getStatus();

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
 * GET /api/sla/types
 * Get SLA metric types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: SLA_METRICS
    });
});

/**
 * GET /api/sla/severities
 * Get SLA severity levels
 */
router.get('/severities', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: SLA_SEVERITY
    });
});

module.exports = router;