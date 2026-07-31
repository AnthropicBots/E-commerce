// backend/routes/aiRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const aiController = require('../controllers/aiController');

/**
 * POST /api/ai/recommend
 * Get AI product recommendations
 */
router.post('/recommend', authMiddleware, aiController.getRecommendation);

/**
 * POST /api/ai/product-recommendation
 * Get AI product recommendations for a specific product
 */
router.post('/product-recommendation', authMiddleware, aiController.getProductRecommendation);

/**
 * POST /api/ai/product-description
 * Generate AI product description
 */
router.post('/product-description', authMiddleware, aiController.generateProductDescription);

/**
 * GET /api/ai/analytics
 * Get AI cost savings analytics (admin only)
 */
router.get('/analytics', authMiddleware, aiController.getAnalytics);

module.exports = router;