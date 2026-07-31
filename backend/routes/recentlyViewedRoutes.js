// backend/routes/recentlyViewedRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const recentlyViewedService = require('../services/recentlyViewedService');

/**
 * GET /api/recently-viewed
 * Get recently viewed products
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const viewed = await recentlyViewedService.getRecentlyViewed(userId);

        res.json({
            success: true,
            data: viewed
        });
    } catch (error) {
        console.error('Get recently viewed error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get recently viewed'
        });
    }
});

/**
 * POST /api/recently-viewed
 * Add product to recently viewed
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { productId } = req.body;
        const userId = req.user.id;

        if (!productId) {
            return res.status(400).json({
                success: false,
                error: 'Product ID is required'
            });
        }

        const viewed = await recentlyViewedService.addViewed(userId, productId);

        res.json({
            success: true,
            data: viewed
        });
    } catch (error) {
        console.error('Add recently viewed error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add recently viewed'
        });
    }
});

module.exports = router;