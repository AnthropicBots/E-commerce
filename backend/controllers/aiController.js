// backend/controllers/aiController.js

const {
  getAIRecommendation,
  getAIProductRecommendation,
  getAIProductDescription,
  getCostSavingsAnalytics
} = require('../services/aiPromptService');

/**
 * Get AI product recommendations
 */
exports.getRecommendation = async (req, res) => {
  try {
    const { query, context } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }

    const safeContext =
      context &&
        typeof context === "object" &&
        !Array.isArray(context)
        ? context
        : {};

    const result = await getAIRecommendation(query, {
      userId: req.user.id,
      ...safeContext
    });
    res.json({
      success: true,
      data: result.data,
      usage: result.usage,
      savings: result.savings
    });
  } catch (error) {
    console.error('Recommendation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendation'
    });
  }
};

/**
 * Get AI product recommendations (specific product)
 */
exports.getProductRecommendation = async (req, res) => {
  try {
    const { productId, query } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        error: 'Product ID is required'
      });
    }

    const result = await getAIProductRecommendation(
      req.user.id,
      productId,
      query || 'Suggest similar products'
    );

    res.json({
      success: true,
      data: result.data,
      usage: result.usage,
      savings: result.savings
    });
  } catch (error) {
    console.error('Product recommendation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get product recommendation'
    });
  }
};

/**
 * Generate AI product description
 */
exports.generateProductDescription = async (req, res) => {
  try {
    const { productData, keywords } = req.body;

    if (!productData || !keywords) {
      return res.status(400).json({
        success: false,
        error: 'Product data and keywords are required'
      });
    }

    const result = await getAIProductDescription(productData, keywords);

    res.json({
      success: true,
      data: result.data,
      usage: result.usage,
      savings: result.savings
    });
  } catch (error) {
    console.error('Product description error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate product description'
    });
  }
};

/**
 * Get AI cost savings analytics (admin only)
 */
exports.getAnalytics = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { timeRange = '30d' } = req.query;
    const analytics = await getCostSavingsAnalytics(timeRange);

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
};