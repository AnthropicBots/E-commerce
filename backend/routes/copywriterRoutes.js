// backend/routes/copywriterRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
    generateProductCopy,
    generateMultipleVersions,
    generateMultilingualCopy,
    getCopywriterAnalytics,
    updateCopyUsage
} = require('../services/aiCopywriterService');

// ============================================
// PRODUCT COPY ENDPOINTS
// ============================================

/**
 * POST /api/copywriter/generate
 * Generate AI product copy
 */
router.post('/generate', authMiddleware, async (req, res) => {
    try {
        const { keywords, category, targetAudience, tone } = req.body;

        if (!keywords || !Array.isArray(keywords) || keywords.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Please provide at least 2 keywords for the product'
            });
        }

        const result = await generateProductCopy({
            keywords,
            category,
            targetAudience,
            tone
        });

        res.json({
            success: true,
            data: result.data,
            usage: result.usage
        });
    } catch (error) {
        console.error('Generate copy error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate product copy'
        });
    }
});

/**
 * POST /api/copywriter/multiple
 * Generate multiple versions
 */
router.post('/multiple', authMiddleware, async (req, res) => {
    try {
        const { keywords, category, count = 3 } = req.body;

        if (!keywords || !Array.isArray(keywords) || keywords.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Please provide at least 2 keywords'
            });
        }

        const result = await generateMultipleVersions({
            keywords,
            category,
            count: Math.min(count, 5)  // Max 5 versions
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Multiple versions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate multiple versions'
        });
    }
});

/**
 * POST /api/copywriter/multilingual
 * Generate multilingual copy
 */
router.post('/multilingual', authMiddleware, async (req, res) => {
    try {
        const { keywords, category, languages } = req.body;

        if (!keywords || !Array.isArray(keywords) || keywords.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Please provide at least 2 keywords'
            });
        }

        const result = await generateMultilingualCopy({
            keywords,
            category,
            languages: languages || ['en', 'hi']
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Multilingual copy error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate multilingual copy'
        });
    }
});

/**
 * POST /api/copywriter/use
 * Mark copy as used
 */
router.post('/use', authMiddleware, async (req, res) => {
    try {
        const { copyId, productId } = req.body;

        if (!copyId || !productId) {
            return res.status(400).json({
                success: false,
                error: 'Copy ID and Product ID are required'
            });
        }

        await updateCopyUsage(copyId, productId);

        res.json({
            success: true,
            message: 'Copy marked as used successfully'
        });
    } catch (error) {
        console.error('Update usage error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update copy usage'
        });
    }
});

/**
 * GET /api/copywriter/analytics
 * Get copywriter analytics (admin only)
 */
router.get('/analytics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { timeRange = '30d' } = req.query;
        const analytics = await getCopywriterAnalytics(timeRange);

        res.json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get analytics'
        });
    }
});

module.exports = router;