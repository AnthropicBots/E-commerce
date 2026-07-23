// backend/routes/hallucinationRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { hallucinationDetectionService } = require('../services/hallucinationDetectionService');

/**
 * POST /api/hallucination/validate
 * Validate product data
 */
router.post('/validate', authMiddleware, async (req, res) => {
    try {
        const { productData, source } = req.body;

        if (!productData) {
            return res.status(400).json({
                success: false,
                error: 'Product data is required'
            });
        }

        const validation = await hallucinationDetectionService.validateProductData(productData, source);

        res.json({
            success: true,
            data: validation
        });
    } catch (error) {
        console.error('Validate product error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to validate product data'
        });
    }
});

/**
 * GET /api/hallucination/alerts
 * Get hallucination alerts
 */
router.get('/alerts', authMiddleware, (req, res) => {
    try {
        const alerts = hallucinationDetectionService.getHallucinations();
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
 * POST /api/hallucination/alerts/:id/resolve
 * Resolve an alert
 */
router.post('/alerts/:id/resolve', authMiddleware, async (req, res) => {
    try {
        const { resolution } = req.body;
        const alert = await hallucinationDetectionService.resolveHallucination(req.params.id, resolution);
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
 * GET /api/hallucination/stats
 * Get statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await hallucinationDetectionService.getStatistics();
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

/**
 * GET /api/hallucination/status
 * Get service status
 */
router.get('/status', authMiddleware, (req, res) => {
    const status = hallucinationDetectionService.getStatus();
    res.json({
        success: true,
        data: status
    });
});

module.exports = router;