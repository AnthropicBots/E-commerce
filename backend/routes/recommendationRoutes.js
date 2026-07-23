// backend/routes/recommendationRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  recordInteraction,
  getRecommendations
} = require('../controllers/recommendationController');
const { RecommendationStrategyFactory, STRATEGY_TYPES } = require('../services/recommendationStrategyService');

// All recommendation routes require authentication
router.use(authMiddleware);

/**
 * POST /api/recommendations/interaction
 * Record user interaction for recommendations
 */
router.post("/interaction", recordInteraction);

/**
 * GET /api/recommendations
 * Get recommendations using strategy pattern
 * Query params:
 *   - strategy: trending | recently_viewed | collaborative | content_based | hybrid | promotional | personalized
 *   - limit: number (default: 10)
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { strategy = 'hybrid', limit = 10 } = req.query;

    // Create strategy instance
    const strategyInstance = RecommendationStrategyFactory.createStrategy(strategy);
    
    // Get recommendations
    const recommendations = await strategyInstance.getRecommendations(userId, parseInt(limit));

    // Return response matching existing format
    res.json({
      success: true,
      data: {
        userId,
        strategy: strategyInstance.name,
        strategyType: strategy,
        count: recommendations.length,
        recommendations
      }
    });
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendations'
    });
  }
});

/**
 * GET /api/recommendations/strategies
 * Get all available strategies (for frontend)
 */
router.get("/strategies", async (req, res) => {
  try {
    const strategies = RecommendationStrategyFactory.getAllStrategies();
    
    res.json({
      success: true,
      data: strategies.map(s => ({
        name: s.name,
        type: s.type,
        description: `Recommendation strategy using ${s.name} algorithm`
      }))
    });
  } catch (error) {
    console.error('Strategies error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get strategies'
    });
  }
});

/**
 * POST /api/recommendations/compare
 * Compare multiple strategies for a user
 */
router.post("/compare", async (req, res) => {
  try {
    const userId = req.user.id;
    const { strategies = ['trending', 'recently_viewed', 'collaborative', 'content_based', 'hybrid'], limit = 5 } = req.body;

    const results = {};

    for (const strategyType of strategies) {
      const strategy = RecommendationStrategyFactory.createStrategy(strategyType);
      const recommendations = await strategy.getRecommendations(userId, parseInt(limit));
      results[strategyType] = {
        name: strategy.name,
        type: strategy.type,
        count: recommendations.length,
        recommendations
      };
    }

    res.json({
      success: true,
      data: {
        userId,
        strategies: results
      }
    });
  } catch (error) {
    console.error('Compare strategies error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to compare strategies'
    });
  }
});

module.exports = router;