// backend/routes/claudeRoutes.js
const express = require('express');
const router = express.Router();
const claudeOptimization = require('../services/claudeOptimizationService');

/**
 * GET /api/claude/product/:id
 * Get Claude-optimized product data
 */
router.get('/product/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [products] = await db.query(
            'SELECT * FROM products WHERE id = ?',
            [id]
        );

        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        const product = products[0];
        const claudeData = claudeOptimization.generateClaudeProductData(product);

        res.json({
            success: true,
            data: claudeData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Claude product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get Claude-optimized product'
        });
    }
});

/**
 * GET /api/claude/batch
 * Get multiple Claude-optimized products
 */
router.get('/batch', async (req, res) => {
    try {
        const { ids } = req.query;

        if (!ids) {
            return res.status(400).json({
                success: false,
                error: 'Product IDs are required'
            });
        }

        const idArray = ids.split(',').map(id => id.trim());
        const placeholders = idArray.map(() => '?').join(',');

        const [products] = await db.query(
            `SELECT * FROM products WHERE id IN (${placeholders})`,
            idArray
        );

        const claudeData = products.map(product => 
            claudeOptimization.generateClaudeProductData(product)
        );

        res.json({
            success: true,
            data: claudeData,
            count: claudeData.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Claude batch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get Claude-optimized products'
        });
    }
});

/**
 * GET /api/claude/score/:id
 * Get Claude score for a product
 */
router.get('/score/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [products] = await db.query(
            'SELECT * FROM products WHERE id = ?',
            [id]
        );

        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        const score = claudeOptimization.calculateClaudeScore(products[0]);

        res.json({
            success: true,
            data: {
                productId: id,
                score: Math.round(score * 100),
                details: {
                    completeness: '✅',
                    context: '✅',
                    citations: '✅',
                    correctness: '✅'
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Score error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to calculate score'
        });
    }
});

/**
 * POST /api/claude/referral
 * Track Claude referral
 */
router.post('/referral', async (req, res) => {
    try {
        const { productId, userId, query } = req.body;

        if (!productId) {
            return res.status(400).json({
                success: false,
                error: 'Product ID is required'
            });
        }

        const referral = await claudeOptimization.trackClaudeReferral({
            productId,
            userId,
            query
        });

        res.json({
            success: true,
            data: referral,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Referral error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to track referral'
        });
    }
});

/**
 * GET /api/claude/stats
 * Get Claude referral statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await claudeOptimization.getClaudeStats();

        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

/**
 * GET /api/claude/health
 * Health check
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'operational',
        service: 'claude-optimization',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;