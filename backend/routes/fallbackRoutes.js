// backend/routes/fallbackRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { fallbackManager, SERVICE_TYPES } = require('../services/fallbackManagerService');

/**
 * GET /api/fallback/status
 * Get degradation status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = fallbackManager.getDegradationStatus();

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get status'
        });
    }
});

/**
 * GET /api/fallback/history
 * Get fallback history (admin only)
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { limit = 100 } = req.query;
        const history = fallbackManager.getFallbackHistory(parseInt(limit));

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
 * GET /api/fallback/health/:service
 * Get service health
 */
router.get('/health/:service', authMiddleware, async (req, res) => {
    try {
        const health = fallbackManager.getServiceHealth(req.params.service);

        if (!health) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        res.json({
            success: true,
            data: health
        });
    } catch (error) {
        console.error('Health error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get health'
        });
    }
});

/**
 * GET /api/fallback/queues
 * Get queue status (admin only)
 */
router.get('/queues', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const queueStatus = Array.from(fallbackManager.retryQueues.entries()).map(([service, queue]) => ({
            service,
            size: queue.length,
            oldest: queue[0]?.timestamp || null
        }));

        res.json({
            success: true,
            data: queueStatus
        });
    } catch (error) {
        console.error('Queues error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get queues'
        });
    }
});

/**
 * POST /api/fallback/circuit/reset
 * Reset circuit breaker (admin only)
 */
router.post('/circuit/reset', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { service } = req.body;

        if (!service) {
            return res.status(400).json({
                success: false,
                error: 'Service name is required'
            });
        }

        const circuit = fallbackManager.circuitBreakers.get(service);
        if (circuit) {
            circuit.state = 'closed';
            circuit.failures = 0;
            fallbackManager.circuitBreakers.set(service, circuit);
        }

        res.json({
            success: true,
            message: `Circuit breaker reset for ${service}`
        });
    } catch (error) {
        console.error('Circuit reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset circuit'
        });
    }
});

/**
 * GET /api/fallback/stats
 * Get fallback statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await fallbackManager.getStatistics();

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