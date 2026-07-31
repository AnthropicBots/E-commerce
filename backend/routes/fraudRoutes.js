// backend/routes/fraudRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { 
    detectCheckoutFraud, 
    getFraudStats 
} = require('../middleware/fraudDetectionMiddleware');

/**
 * POST /api/fraud/checkout-check
 * Check for fraud during checkout
 */
router.post('/checkout-check', authMiddleware, detectCheckoutFraud, (req, res) => {
    res.json({
        success: true,
        message: 'Fraud check passed',
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/fraud/stats
 * Get fraud detection statistics (admin only)
 */
router.get('/stats', authMiddleware, getFraudStats);

/**
 * GET /api/fraud/health
 * Health check
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'operational',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;