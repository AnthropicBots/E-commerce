// routes/preservationAI.routes.js
const express = require('express');
const router = express.Router();
const PreservationAIService = require('../services/preservationAIService');

let preservationService = null;

const getService = () => {
  if (!preservationService) {
    preservationService = new PreservationAIService();
  }
  return preservationService;
};

/**
 * GET /api/preservation/items
 * Get all heritage items
 */
router.get('/items', (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      category: req.query.category,
      region: req.query.region,
      minRisk: req.query.minRisk ? parseInt(req.query.minRisk) : null
    };

    const service = getService();
    const items = service.getHeritageItems(filters);

    res.json({
      success: true,
      items,
      count: items.length,
      filters,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/preservation/item/:heritageId
 * Get heritage item
 */
router.get('/item/:heritageId', (req, res, next) => {
  try {
    const { heritageId } = req.params;
    const service = getService();
    const item = service.getHeritageItem(heritageId);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Heritage item not found'
      });
    }

    const assessment = service.getRiskAssessment(heritageId);
    const recommendations = service.getPreservationRecommendations(heritageId);
    const progress = service.getProgress(heritageId);

    res.json({
      success: true,
      item,
      assessment,
      recommendations,
      progress,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/preservation/assess
 * Assess risk for heritage item
 */
router.post('/assess', (req, res, next) => {
  try {
    const { heritageId } = req.body;

    if (!heritageId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: heritageId'
      });
    }

    const service = getService();
    const assessment = service.assessRisk(heritageId);

    res.json({
      success: true,
      assessment,
      message: 'Risk assessment completed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/preservation/assessments
 * Get all risk assessments
 */
router.get('/assessments', (req, res, next) => {
  try {
    const service = getService();
    const assessments = service.getAllRiskAssessments();

    res.json({
      success: true,
      assessments,
      count: assessments.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/preservation/recommendations
 * Get preservation recommendations
 */
router.get('/recommendations', (req, res, next) => {
  try {
    const { heritageId } = req.query;
    const service = getService();
    const recommendations = service.getPreservationRecommendations(heritageId);

    res.json({
      success: true,
      recommendations,
      count: recommendations.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/preservation/progress
 * Track preservation progress
 */
router.post('/progress', (req, res, next) => {
  try {
    const { heritageId, progressData } = req.body;

    if (!heritageId || !progressData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: heritageId, progressData'
      });
    }

    const service = getService();
    const progress = service.trackProgress(heritageId, progressData);

    res.json({
      success: true,
      progress,
      message: 'Progress tracked successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/preservation/progress/:heritageId
 * Get preservation progress
 */
router.get('/progress/:heritageId', (req, res, next) => {
  try {
    const { heritageId } = req.params;
    const service = getService();
    const progress = service.getProgress(heritageId);

    res.json({
      success: true,
      progress,
      count: progress.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/preservation/resources/allocate
 * Allocate resources
 */
router.post('/resources/allocate', (req, res, next) => {
  try {
    const { heritageId, resourceData } = req.body;

    if (!heritageId || !resourceData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: heritageId, resourceData'
      });
    }

    const service = getService();
    const allocation = service.allocateResources(heritageId, resourceData);

    res.json({
      success: true,
      allocation,
      message: 'Resources allocated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/preservation/resources
 * Get resource allocations
 */
router.get('/resources', (req, res, next) => {
  try {
    const { heritageId } = req.query;
    const service = getService();
    const allocations = service.getResourceAllocations(heritageId);

    res.json({
      success: true,
      allocations,
      count: allocations.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/preservation/engagement
 * Log community engagement
 */
router.post('/engagement', (req, res, next) => {
  try {
    const activityData = req.body;

    if (!activityData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: activityData'
      });
    }

    const service = getService();
    const activity = service.logEngagement(activityData);

    res.json({
      success: true,
      activity,
      message: 'Engagement logged successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/preservation/engagement
 * Get engagement activities
 */
router.get('/engagement', (req, res, next) => {
  try {
    const filters = {
      heritageId: req.query.heritageId,
      type: req.query.type
    };

    const service = getService();
    const activities = service.getEngagementActivities(filters);

    res.json({
      success: true,
      activities,
      count: activities.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/preservation/insights
 * Get AI insights
 */
router.get('/insights', (req, res, next) => {
  try {
    const service = getService();
    const insights = service.getAIInsights();

    res.json({
      success: true,
      insights,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/preservation/stats
 * Get preservation statistics
 */
router.get('/stats', (req, res, next) => {
  try {
    const service = getService();
    const stats = service.getPreservationStats();

    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;