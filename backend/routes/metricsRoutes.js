// backend/routes/metricsRoutes.js
//
// Business metrics: revenue, conversion, churn, customer lifetime value.
//
// Every route here was `authMiddleware` and nothing else (#1529), so any
// signed-in shopper could read the store's takings -- and
// /customer-lifetime-value returns the names of the hundred highest-spending
// customers alongside what each of them has spent. `adminOnly` is applied at
// the router now, so a route added later cannot be missing it.
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/rbacMiddleware');
const { ROLES } = require('../config/policy');
const { metricsAggregationService, METRIC_TYPES, TIME_PERIODS } = require('../services/metricsAggregationService');

// What the store earns is not a fact about the shopper reading it.
router.use(authMiddleware);
router.use(authorizeRoles(ROLES.ADMIN));

/**
 * Answer with the status the error carries.
 *
 * A filter this service does not implement is the caller's mistake, not the
 * server's, and reporting it as a 500 hides which of the two it was.
 */
function fail(res, error, fallback) {
    const status = error.status || 500;

    if (status >= 500) {
        console.error(`${fallback}:`, error);
    }

    return res.status(status).json({
        success: false,
        error: status >= 500 ? fallback : error.message,
        code: error.code
    });
}

/**
 * GET /api/metrics/dashboard
 * Get metrics dashboard
 */
router.get('/dashboard', async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const dashboard = await metricsAggregationService.getDashboard(period, filters);

        res.json({
            success: true,
            data: dashboard
        });
    } catch (error) {
        return fail(res, error, 'Failed to get dashboard');
    }
});

/**
 * GET /api/metrics/conversion-rate
 * Get conversion rate
 */
router.get('/conversion-rate', async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getConversionRate(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return fail(res, error, 'Failed to get conversion rate');
    }
});

/**
 * GET /api/metrics/average-order-value
 * Get average order value
 */
router.get('/average-order-value', async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getAverageOrderValue(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return fail(res, error, 'Failed to get average order value');
    }
});

/**
 * GET /api/metrics/abandoned-cart
 * Get abandoned cart rate
 */
router.get('/abandoned-cart', async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getAbandonedCartRate(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return fail(res, error, 'Failed to get abandoned cart rate');
    }
});

/**
 * GET /api/metrics/recommendation-ctr
 * Get recommendation CTR
 */
router.get('/recommendation-ctr', async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getRecommendationCTR(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return fail(res, error, 'Failed to get recommendation CTR');
    }
});

/**
 * GET /api/metrics/coupon-effectiveness
 * Get coupon effectiveness
 */
router.get('/coupon-effectiveness', async (req, res) => {
    try {
        const { period = TIME_PERIODS.WEEK, ...filters } = req.query;
        const result = await metricsAggregationService.getCouponEffectiveness(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return fail(res, error, 'Failed to get coupon effectiveness');
    }
});

/**
 * GET /api/metrics/customer-lifetime-value
 * Get customer lifetime value
 */
router.get('/customer-lifetime-value', async (req, res) => {
    try {
        const { period = TIME_PERIODS.MONTH, ...filters } = req.query;
        const result = await metricsAggregationService.getCustomerLifetimeValue(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return fail(res, error, 'Failed to get customer lifetime value');
    }
});

/**
 * GET /api/metrics/revenue-growth
 * Get revenue growth
 */
router.get('/revenue-growth', async (req, res) => {
    try {
        const { period = TIME_PERIODS.MONTH, ...filters } = req.query;
        const result = await metricsAggregationService.getRevenueGrowth(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return fail(res, error, 'Failed to get revenue growth');
    }
});

/**
 * GET /api/metrics/churn-rate
 * Get churn rate
 */
router.get('/churn-rate', async (req, res) => {
    try {
        const { period = TIME_PERIODS.MONTH, ...filters } = req.query;
        const result = await metricsAggregationService.getChurnRate(period, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return fail(res, error, 'Failed to get churn rate');
    }
});

/**
 * GET /api/metrics/types
 * Get metric types
 */
router.get('/types', (req, res) => {
    res.json({
        success: true,
        data: METRIC_TYPES
    });
});

/**
 * GET /api/metrics/periods
 * Get time periods
 */
router.get('/periods', (req, res) => {
    res.json({
        success: true,
        data: TIME_PERIODS
    });
});

/**
 * POST /api/metrics/aggregate
 * Trigger metrics aggregation (admin only)
 */
router.post('/aggregate', async (req, res) => {
    try {
        // The router already refuses anybody who is not an admin, so the
        // inline check that used to be here said nothing extra.
        await metricsAggregationService.aggregateMetrics();

        res.json({
            success: true,
            message: 'Metrics aggregation triggered'
        });
    } catch (error) {
        return fail(res, error, 'Failed to trigger aggregation');
    }
});

/**
 * GET /api/metrics/stats
 * Get metrics service statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await metricsAggregationService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        return fail(res, error, 'Failed to get statistics');
    }
});

module.exports = router;