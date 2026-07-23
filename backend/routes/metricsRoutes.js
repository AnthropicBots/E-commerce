// backend/routes/metricsRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { metricsAggregationService, METRIC_TYPES, TIME_PERIODS } = require('../services/metricsAggregationService');

/**
 * GET /api/metrics/dashboard
 * Get metrics dashboard
 */
router.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const dashboard = await metricsAggregationService.getDashboard(period, filters);

        res.json({
            success: true,
            data: dashboard
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dashboard'
        });
    }
});

/**
 * GET /api/metrics/conversion-rate
 * Get conversion rate
 */
router.get('/conversion-rate', authMiddleware, async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getConversionRate(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Conversion rate error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get conversion rate'
        });
    }
});

/**
 * GET /api/metrics/average-order-value
 * Get average order value
 */
router.get('/average-order-value', authMiddleware, async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getAverageOrderValue(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('AOV error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get average order value'
        });
    }
});

/**
 * GET /api/metrics/abandoned-cart
 * Get abandoned cart rate
 */
router.get('/abandoned-cart', authMiddleware, async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getAbandonedCartRate(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Abandoned cart error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get abandoned cart rate'
        });
    }
});

/**
 * GET /api/metrics/recommendation-ctr
 * Get recommendation CTR
 */
router.get('/recommendation-ctr', authMiddleware, async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getRecommendationCTR(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Recommendation CTR error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get recommendation CTR'
        });
    }
});

/**
 * GET /api/metrics/coupon-effectiveness
 * Get coupon effectiveness
 */
router.get('/coupon-effectiveness', authMiddleware, async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getCouponEffectiveness(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Coupon effectiveness error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get coupon effectiveness'
        });
    }
});

/**
 * GET /api/metrics/customer-lifetime-value
 * Get customer lifetime value
 */
router.get('/customer-lifetime-value', authMiddleware, async (req, res) => {
    try {
        const { period = TIME_PERIODS.MONTH, ...filters } = req.query;
        const result = await metricsAggregationService.getCustomerLifetimeValue(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('CLV error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get customer lifetime value'
        });
    }
});

/**
 * GET /api/metrics/revenue-growth
 * Get revenue growth
 */
router.get('/revenue-growth', authMiddleware, async (req, res) => {
    try {
        const { period = TIME_PERIODS.MONTH, ...filters } = req.query;
        const result = await metricsAggregationService.getRevenueGrowth(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Revenue growth error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get revenue growth'
        });
    }
});

/**
 * GET /api/metrics/churn-rate
 * Get churn rate
 */
router.get('/churn-rate', authMiddleware, async (req, res) => {
    try {
        const { period = TIME_PERIODS.MONTH, ...filters } = req.query;
        const result = await metricsAggregationService.getChurnRate(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Churn rate error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get churn rate'
        });
    }
});

/**
 * GET /api/metrics/types
 * Get metric types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: METRIC_TYPES
    });
});

/**
 * GET /api/metrics/periods
 * Get time periods
 */
router.get('/periods', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: TIME_PERIODS
    });
});

/**
 * POST /api/metrics/aggregate
 * Trigger metrics aggregation (admin only)
 */
router.post('/aggregate', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await metricsAggregationService.aggregateMetrics();

        res.json({
            success: true,
            message: 'Metrics aggregation triggered'
        });
    } catch (error) {
        console.error('Aggregation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to trigger aggregation'
        });
    }
});

/**
 * GET /api/metrics/stats
 * Get metrics service statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await metricsAggregationService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

module.exports = router;