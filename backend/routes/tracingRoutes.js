// backend/routes/tracingRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { tracingService } = require('../services/tracingService');

/**
 * GET /api/tracing/status
 * Get tracing status
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        data: {
            initialized: tracingService.initialized,
            serviceName: TRACING_CONFIG.serviceName,
            environment: TRACING_CONFIG.environment,
            exporterEndpoint: TRACING_CONFIG.exporterEndpoint,
            samplingRatio: TRACING_CONFIG.samplingRatio
        }
    });
});

/**
 * GET /api/tracing/test
 * Test tracing with a sample span
 */
router.get('/test', authMiddleware, async (req, res) => {
    try {
        const result = await tracingService.startSpan('test-span', async (span) => {
            // Simulate work
            await new Promise(resolve => setTimeout(resolve, 100));

            tracingService.addEvent(span, 'test-event', {
                'test.attribute': 'test-value'
            });

            return {
                message: 'Trace test completed',
                traceId: tracingService.getTraceId(),
                spanId: tracingService.getSpanId()
            };
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Trace test error:', error);
        res.status(500).json({
            success: false,
            error: 'Trace test failed'
        });
    }
});

/**
 * GET /api/tracing/trace/:traceId
 * Get trace details (admin only)
 */
router.get('/trace/:traceId', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { traceId } = req.params;

        // In production, fetch from trace store (Jaeger, Tempo, etc.)
        res.json({
            success: true,
            data: {
                traceId,
                message: 'Trace details would be fetched from trace store',
                note: 'Configure Jaeger/Tempo for full trace storage'
            }
        });
    } catch (error) {
        console.error('Get trace error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get trace'
        });
    }
});

/**
 * GET /api/tracing/config
 * Get tracing configuration (admin only)
 */
router.get('/config', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        res.json({
            success: true,
            data: TRACING_CONFIG
        });
    } catch (error) {
        console.error('Config error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get config'
        });
    }
});

module.exports = router;