// backend/services/metricsAggregationService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// METRICS CONFIGURATION
// ============================================

const METRIC_TYPES = {
    CONVERSION_RATE: 'conversion_rate',
    AVERAGE_ORDER_VALUE: 'average_order_value',
    ABANDONED_CART: 'abandoned_cart',
    RECOMMENDATION_CTR: 'recommendation_ctr',
    COUPON_EFFECTIVENESS: 'coupon_effectiveness',
    CUSTOMER_LIFETIME_VALUE: 'customer_lifetime_value',
    CHURN_RATE: 'churn_rate',
    REVENUE_GROWTH: 'revenue_growth',
    AVERAGE_RESPONSE_TIME: 'average_response_time',
    CART_CONVERSION_RATE: 'cart_conversion_rate'
};

const TIME_PERIODS = {
    TODAY: 'today',
    WEEK: 'week',
    MONTH: 'month',
    QUARTER: 'quarter',
    YEAR: 'year',
    CUSTOM: 'custom'
};

// A guest basket folded into an account's cart at sign-in is not a second
// shopping session (#1427) -- it is the same basket, seen before and after the
// shopper identified themselves. Counting both would put a cart in the
// denominator of every cart rate for each time somebody signed in, which
// depresses conversion and abandonment alike by an amount that has nothing to
// do with trading.
const EXCLUDE_MERGED_CARTS = "AND c.status <> 'merged'";

/**
 * An order that counts towards revenue (#1529).
 *
 * The money metrics filtered on `status = 'completed'`, which is not a member
 * of the `orders.status` ENUM -- pending, processing, shipped, delivered,
 * cancelled, refunded, on_hold -- so each of them matched no rows even before
 * the column they summed turned out not to exist either.
 *
 * A cancelled or refunded order is not revenue; everything else that has been
 * placed is, which is the rule `admin.service` already reads its dashboard by.
 */
const REVENUE_ORDERS = `
    o.status NOT IN ('cancelled', 'refunded') AND o.deleted_at IS NULL
`;

/**
 * The column holding what an order was worth.
 *
 * `orders.total_amount` does not exist. `total` is the figure the order path
 * writes and verifies the shopper's claimed total against (`order.service`).
 */
const ORDER_VALUE = 'o.total';

/**
 * A caller-supplied filter this service does not implement.
 *
 * Carries the status the route should answer with, so an unsupported filter is
 * a 400 rather than a 500 -- and, more to the point, rather than a whole-store
 * number quietly returned to somebody who asked for a slice of it.
 */
class MetricsError extends Error {
    constructor(message, status = 400, code = 'METRICS_ERROR') {
        super(message);
        this.name = 'MetricsError';
        this.status = status;
        this.code = code;
    }
}

/**
 * Refuse a filter this metric does not understand.
 *
 * Several metrics appended conditions over columns that have never existed
 * (`orders.category`, `orders.user_segment`). Those queries could not run at
 * all, but the failure worth guarding against is the quiet one: a dashboard
 * that answers a filtered question with an unfiltered number.
 *
 * @param {Object} filters
 * @param {string[]} supported
 * @throws {MetricsError}
 */
function assertSupportedFilters(filters = {}, supported = []) {
    const unsupported = Object.keys(filters).filter(
        (key) =>
            filters[key] !== undefined
            && filters[key] !== ''
            && !supported.includes(key)
    );

    if (unsupported.length) {
        throw new MetricsError(
            `Unsupported filter(s): ${unsupported.join(', ')}. `
            + `This metric supports: ${supported.join(', ') || 'none'}`,
            400,
            'UNSUPPORTED_FILTER'
        );
    }
}

// ============================================
// METRICS AGGREGATION SERVICE
// ============================================

class MetricsAggregationService extends EventEmitter {
    constructor() {
        super();
        this.metricsCache = new Map();
        this.metricHistory = [];
        this.aggregationJobs = [];
        this.lastAggregation = null;
        this.isAggregating = false;
        this.cacheTTL = 300; // 5 minutes
        // Handle for the hourly aggregation, so shutdown can stop it.
        this.aggregationTimer = null;
    }

    /**
     * Initialize metrics service
     */
    async initialize() {
        // Load historical metrics
        await this.loadHistoricalMetrics();

        // Start periodic aggregation. The handle is retained so shutdown can
        // stop it, and unref'd so a pending timer does not keep the process
        // alive on its own -- the interval was previously created and dropped,
        // which is the leak #1294 fixed in the recommendation service.
        this.aggregationTimer = setInterval(() => this.aggregateMetrics(), 3600000); // 1 hour
        if (typeof this.aggregationTimer.unref === 'function') {
            this.aggregationTimer.unref();
        }

        console.log('✅ Metrics Aggregation Service initialized');
        return this;
    }

    /**
     * Get conversion rate
     */
    async getConversionRate(period = TIME_PERIODS.WEEK, filters = {}) {
        const cacheKey = `conversion_rate:${period}:${JSON.stringify({ category: filters.category, userSegment: filters.userSegment })}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const dateRange = this.getDateRange(period);
        const params = [dateRange.start, dateRange.end];

        // Conversion is a property of the cart's own state (#1364), not of a
        // join to an order: `orders` has no cart_id, and the cart is what knows
        // which order it became. Carts are counted in the window they started
        // in, so a cohort's rate does not move as its carts convert later.
        let query = `
            SELECT
                COUNT(*) as carts,
                SUM(CASE WHEN c.status = 'converted' THEN 1 ELSE 0 END) as orders,
                (SUM(CASE WHEN c.status = 'converted' THEN 1 ELSE 0 END)
                    / NULLIF(COUNT(*), 0)) * 100 as conversion_rate
            FROM carts c
            WHERE c.created_at BETWEEN ? AND ?
              ${EXCLUDE_MERGED_CARTS}
        `;

        // A cart has no category of its own; the category of what is in it is
        // the question actually being asked.
        if (filters.category) {
            query += `
                AND EXISTS (
                    SELECT 1 FROM cart_items ci
                    JOIN products p ON p.id = ci.product_id
                    WHERE ci.cart_id = c.id AND p.category_id = ?
                )
            `;
            params.push(filters.category);
        }

        const [rows] = await db.query(query, params);
        const result = {
            metric: 'conversion_rate',
            value: parseFloat(rows[0]?.conversion_rate || 0),
            orders: parseInt(rows[0]?.orders || 0),
            carts: parseInt(rows[0]?.carts || 0),
            period,
            filters,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Get average order value
     */
    async getAverageOrderValue(period = TIME_PERIODS.WEEK, filters = {}) {
        const cacheKey = `aov:${period}:${JSON.stringify({ category: filters.category, userSegment: filters.userSegment })}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const dateRange = this.getDateRange(period);
        const params = [dateRange.start, dateRange.end];

        assertSupportedFilters(filters, ['category']);

        let query = `
            SELECT
                AVG(${ORDER_VALUE}) as avg_order_value,
                COUNT(*) as order_count,
                SUM(${ORDER_VALUE}) as total_revenue
            FROM orders o
            WHERE ${REVENUE_ORDERS}
            AND o.created_at BETWEEN ? AND ?
        `;

        // An order has no category of its own; the category of what was in it
        // is the question being asked. `orders.category` and
        // `orders.user_segment` were both filtered on here and neither exists.
        if (filters.category) {
            query += `
                AND EXISTS (
                    SELECT 1 FROM order_items oi
                    JOIN products p ON p.id = oi.product_id
                    WHERE oi.order_id = o.id AND p.category_id = ?
                )
            `;
            params.push(filters.category);
        }

        const [rows] = await db.query(query, params);
        const result = {
            metric: 'average_order_value',
            value: parseFloat(rows[0]?.avg_order_value || 0),
            orderCount: parseInt(rows[0]?.order_count || 0),
            totalRevenue: parseFloat(rows[0]?.total_revenue || 0),
            period,
            filters,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Get abandoned cart rate
     */
    async getAbandonedCartRate(period = TIME_PERIODS.WEEK, filters = {}) {
        const cacheKey = `abandoned:${period}:${JSON.stringify({ category: filters.category, userSegment: filters.userSegment })}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const dateRange = this.getDateRange(period);
        const params = [dateRange.start, dateRange.end];

        // The denominator is every cart in the window, not only the abandoned
        // ones -- the previous filter made the rate 100% by construction. A
        // cart carries no stored total either, so what was left behind is
        // priced from its lines.
        let query = `
            SELECT
                COUNT(*) as total_carts,
                SUM(CASE WHEN c.status = 'abandoned' THEN 1 ELSE 0 END) as abandoned_carts,
                (SUM(CASE WHEN c.status = 'abandoned' THEN 1 ELSE 0 END)
                    / NULLIF(COUNT(*), 0)) * 100 as abandoned_rate,
                SUM(CASE WHEN c.status = 'abandoned' THEN COALESCE(v.cart_value, 0) ELSE 0 END) as lost_revenue
            FROM carts c
            LEFT JOIN (
                SELECT ci.cart_id, SUM(ci.quantity * p.price) as cart_value
                FROM cart_items ci
                JOIN products p ON p.id = ci.product_id
                GROUP BY ci.cart_id
            ) v ON v.cart_id = c.id
            WHERE c.created_at BETWEEN ? AND ?
              ${EXCLUDE_MERGED_CARTS}
        `;

        if (filters.category) {
            query += `
                AND EXISTS (
                    SELECT 1 FROM cart_items ci
                    JOIN products p ON p.id = ci.product_id
                    WHERE ci.cart_id = c.id AND p.category_id = ?
                )
            `;
            params.push(filters.category);
        }

        if (filters.minValue) {
            query += ' AND COALESCE(v.cart_value, 0) >= ?';
            params.push(filters.minValue);
        }

        const [rows] = await db.query(query, params);
        const result = {
            metric: 'abandoned_cart',
            value: parseFloat(rows[0]?.abandoned_rate || 0),
            totalCarts: parseInt(rows[0]?.total_carts || 0),
            abandonedCarts: parseInt(rows[0]?.abandoned_carts || 0),
            lostRevenue: parseFloat(rows[0]?.lost_revenue || 0),
            period,
            filters,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Get recommendation CTR
     */
    async getRecommendationCTR(period = TIME_PERIODS.WEEK, filters = {}) {
        const cacheKey = `recommendation_ctr:${period}:${JSON.stringify({ category: filters.category, userSegment: filters.userSegment })}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        // Reported as unavailable rather than computed.
        //
        // This read `recommendation_interactions`, a table that appears in no
        // migration and in no other file -- so the query failed and, because
        // `getDashboard` awaits this alongside the rest, took the whole
        // dashboard down with it.
        //
        // It cannot be computed from what is recorded either: a click-through
        // rate needs impressions, and nothing logs that a recommendation was
        // *shown*. `user_interactions` holds view, cart_add, wishlist_add,
        // purchase and share, all of which are clicks or better.
        //
        // Saying so is the honest answer. Inventing a denominator out of
        // product views would produce a number that looks like a CTR, moves
        // when the catalogue changes, and means nothing. Recording impressions
        // is a feature, and belongs in its own change.
        const result = {
            metric: 'recommendation_ctr',
            available: false,
            reason:
                'Recommendation impressions are not recorded, so a '
                + 'click-through rate cannot be computed.',
            value: null,
            impressions: null,
            clicks: null,
            purchases: null,
            period,
            filters,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Get coupon effectiveness
     */
    async getCouponEffectiveness(period = TIME_PERIODS.WEEK, filters = {}) {
        const cacheKey = `coupon:${period}:${JSON.stringify({ category: filters.category, userSegment: filters.userSegment })}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const dateRange = this.getDateRange(period);
        const params = [dateRange.start, dateRange.end];

        assertSupportedFilters(filters, ['couponType']);

        // The filter is applied where a filter goes.
        //
        // It used to be appended after `GROUP BY c.id ORDER BY ...`, producing
        // `... ORDER BY revenue_generated DESC AND c.discount_type = ?`, which
        // is a syntax error -- so asking for one type of coupon was a 500, and
        // asking for none returned figures summed over a column that does not
        // exist.
        let conditions = `
            c.created_at BETWEEN ? AND ?
            AND c.usage_count > 0
        `;

        if (filters.couponType) {
            conditions += ' AND c.discount_type = ?';
            params.push(filters.couponType);
        }

        // `orders.coupon_code` does not exist. The order path writes the code
        // it applied to `promo_code` and `discount_code` (`order.service`).
        const query = `
            SELECT
                c.code,
                c.discount_type,
                c.discount_value,
                COUNT(o.id) as usage_count,
                COALESCE(SUM(${ORDER_VALUE}), 0) as revenue_generated,
                COALESCE(AVG(${ORDER_VALUE}), 0) as avg_order_value,
                (COALESCE(SUM(${ORDER_VALUE}), 0) / NULLIF(COUNT(o.id), 0))
                    - c.discount_value as net_value
            FROM coupons c
            LEFT JOIN orders o
                ON o.promo_code = c.code
                AND ${REVENUE_ORDERS}
            WHERE ${conditions}
            GROUP BY c.id
            ORDER BY revenue_generated DESC
        `;

        const [rows] = await db.query(query, params);
        const result = {
            metric: 'coupon_effectiveness',
            coupons: rows.map(row => ({
                code: row.code,
                discountType: row.discount_type,
                discountValue: parseFloat(row.discount_value),
                usageCount: parseInt(row.usage_count || 0),
                revenueGenerated: parseFloat(row.revenue_generated || 0),
                avgOrderValue: parseFloat(row.avg_order_value || 0),
                netValue: parseFloat(row.net_value || 0)
            })),
            totalCoupons: rows.length,
            totalRevenue: rows.reduce((sum, r) => sum + parseFloat(r.revenue_generated || 0), 0),
            period,
            filters,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Get customer lifetime value
     */
    async getCustomerLifetimeValue(period = TIME_PERIODS.MONTH, filters = {}) {
        const cacheKey = `clv:${period}:${JSON.stringify({ category: filters.category, userSegment: filters.userSegment })}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const dateRange = this.getDateRange(period);
        const params = [dateRange.start, dateRange.end];

        assertSupportedFilters(filters, ['minOrders']);

        // One HAVING, and the threshold is a parameter.
        //
        // The previous version bolted a second one on with
        // `query.replace('ORDER BY', 'HAVING order_count >= ${filters.minOrders} ORDER BY')`.
        // Two HAVING clauses is a syntax error, and `filters` is `req.query`
        // spread straight from the URL -- so `?minOrders=1 UNION SELECT ...`
        // was concatenated into the statement. Every other query in this
        // service parameterises; this one interpolated.
        const minOrders = Math.max(1, parseInt(filters.minOrders, 10) || 1);

        const query = `
            SELECT
                u.id,
                u.name,
                COUNT(o.id) as order_count,
                COALESCE(SUM(${ORDER_VALUE}), 0) as total_spent,
                COALESCE(AVG(${ORDER_VALUE}), 0) as avg_order_value,
                DATEDIFF(NOW(), MAX(o.created_at)) as days_since_last_order,
                DATEDIFF(NOW(), u.created_at) as customer_age_days,
                (COALESCE(SUM(${ORDER_VALUE}), 0)
                    / NULLIF(DATEDIFF(NOW(), u.created_at), 0)) * 30 as monthly_value
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id AND ${REVENUE_ORDERS}
            WHERE u.created_at BETWEEN ? AND ?
            GROUP BY u.id
            HAVING order_count >= ?
            ORDER BY total_spent DESC
            LIMIT 100
        `;

        params.push(minOrders);

        const [rows] = await db.query(query, params);
        const result = {
            metric: 'customer_lifetime_value',
            customers: rows.map(row => ({
                id: row.id,
                name: row.name,
                orderCount: parseInt(row.order_count),
                totalSpent: parseFloat(row.total_spent),
                avgOrderValue: parseFloat(row.avg_order_value || 0),
                daysSinceLastOrder: parseInt(row.days_since_last_order || 0),
                customerAgeDays: parseInt(row.customer_age_days || 0),
                monthlyValue: parseFloat(row.monthly_value || 0)
            })),
            averageCLV: rows.length > 0 ? rows.reduce((sum, r) => sum + parseFloat(r.total_spent), 0) / rows.length : 0,
            topCustomer: rows.length > 0 ? rows[0] : null,
            period,
            filters,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Get revenue growth
     */
    async getRevenueGrowth(period = TIME_PERIODS.MONTH, filters = {}) {
        const cacheKey = `revenue_growth:${period}:${JSON.stringify({ category: filters.category, userSegment: filters.userSegment })}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const dateRange = this.getDateRange(period);
        const params = [dateRange.start, dateRange.end];

        assertSupportedFilters(filters, []);

        // Get current period revenue
        const [currentRevenue] = await db.query(
            `SELECT SUM(${ORDER_VALUE}) as revenue, COUNT(*) as orders
             FROM orders o
             WHERE ${REVENUE_ORDERS}
             AND o.created_at BETWEEN ? AND ?`,
            params
        );

        // Get previous period revenue
        const periodDuration = dateRange.end - dateRange.start;
        const previousStart = new Date(dateRange.start - periodDuration);
        const previousEnd = new Date(dateRange.end - periodDuration);

        const [previousRevenue] = await db.query(
            `SELECT SUM(${ORDER_VALUE}) as revenue
             FROM orders o
             WHERE ${REVENUE_ORDERS}
             AND o.created_at BETWEEN ? AND ?`,
            [previousStart, previousEnd]
        );

        const current = parseFloat(currentRevenue[0]?.revenue || 0);
        const previous = parseFloat(previousRevenue[0]?.revenue || 0);
        const growth = previous > 0 ? ((current - previous) / previous) * 100 : 0;

        const result = {
            metric: 'revenue_growth',
            currentRevenue: current,
            previousRevenue: previous,
            growthPercentage: growth,
            orderCount: parseInt(currentRevenue[0]?.orders || 0),
            period,
            filters,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Get churn rate
     */
    async getChurnRate(period = TIME_PERIODS.MONTH, filters = {}) {
        const cacheKey = `churn:${period}:${JSON.stringify({ category: filters.category, userSegment: filters.userSegment })}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const dateRange = this.getDateRange(period);
        const params = [dateRange.start, dateRange.end];

        assertSupportedFilters(filters, []);

        // Who was buying in the thirty days before the window opened.
        const [activeUsers] = await db.query(
            `SELECT COUNT(DISTINCT o.user_id) as active
             FROM orders o
             WHERE ${REVENUE_ORDERS}
             AND o.user_id IS NOT NULL
             AND o.created_at < ?
             AND o.created_at > DATE_SUB(?, INTERVAL 30 DAY)`,
            [dateRange.start, dateRange.start]
        );

        // How many of *those* did not come back during the window.
        //
        // The previous version counted every user account older than the
        // window that had not ordered inside it -- which is almost the whole
        // register, most of whom were never active and so cannot have churned.
        // Divided by the active count it produced churn rates far above 100%.
        //
        // `NOT IN` was also unsafe against NULL: a guest order carries a null
        // `user_id`, and `id NOT IN (… NULL …)` is never true for any row, so
        // one guest order in the window made the churned count zero.
        const [churnedUsers] = await db.query(
            `SELECT COUNT(DISTINCT prior.user_id) as churned
             FROM orders prior
             WHERE prior.status NOT IN ('cancelled', 'refunded')
             AND prior.deleted_at IS NULL
             AND prior.user_id IS NOT NULL
             AND prior.created_at < ?
             AND prior.created_at > DATE_SUB(?, INTERVAL 30 DAY)
             AND NOT EXISTS (
                 SELECT 1 FROM orders during
                 WHERE during.user_id = prior.user_id
                 AND during.created_at BETWEEN ? AND ?
             )`,
            [dateRange.start, dateRange.start, dateRange.start, dateRange.end]
        );

        const active = parseInt(activeUsers[0]?.active || 0);
        const churned = parseInt(churnedUsers[0]?.churned || 0);
        const churnRate = active > 0 ? (churned / active) * 100 : 0;

        const result = {
            metric: 'churn_rate',
            churnRate,
            activeUsers: active,
            churnedUsers: churned,
            period,
            filters,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Get all metrics dashboard
     */
    async getDashboard(period = TIME_PERIODS.WEEK, filters = {}) {
        const cacheKey = `dashboard:${period}:${JSON.stringify({ category: filters.category, userSegment: filters.userSegment })}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const [conversionRate, aov, abandoned, ctr, revenueGrowth] = await Promise.all([
            this.getConversionRate(period, filters),
            this.getAverageOrderValue(period, filters),
            this.getAbandonedCartRate(period, filters),
            this.getRecommendationCTR(period, filters),
            this.getRevenueGrowth(period, filters)
        ]);

        const dashboard = {
            period,
            filters,
            metrics: {
                conversionRate,
                averageOrderValue: aov,
                abandonedCart: abandoned,
                recommendationCTR: ctr,
                revenueGrowth
            },
            summary: {
                totalRevenue: aov.totalRevenue || 0,
                averageOrderValue: aov.value,
                conversionRate: conversionRate.value,
                abandonedRate: abandoned.value,
                recommendationCTR: ctr.value,
                revenueGrowth: revenueGrowth.growthPercentage
            },
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, dashboard);
        return dashboard;
    }

    /**
     * Aggregate metrics (batch job)
     */
    async aggregateMetrics() {
        if (this.isAggregating) return;

        this.isAggregating = true;
        console.log('📊 Starting metrics aggregation...');

        try {
            const periods = [TIME_PERIODS.TODAY, TIME_PERIODS.WEEK, TIME_PERIODS.MONTH];
            const metrics = [];

            for (const period of periods) {
                const dashboard = await this.getDashboard(period);
                metrics.push({
                    period,
                    ...dashboard.metrics,
                    summary: dashboard.summary,
                    aggregatedAt: new Date().toISOString()
                });
            }

            // Store aggregated metrics
            await this.storeAggregatedMetrics(metrics);

            this.lastAggregation = new Date().toISOString();
            this.emit('metrics.aggregated', { metrics, timestamp: this.lastAggregation });

            console.log(`✅ Metrics aggregation completed for ${metrics.length} periods`);
        } catch (error) {
            console.error('Metrics aggregation error:', error);
        } finally {
            this.isAggregating = false;
        }
    }

    /**
     * Get date range for period
     */
    getDateRange(period, customStart = null, customEnd = null) {
        const end = new Date();
        let start = new Date();

        switch (period) {
            case TIME_PERIODS.TODAY:
                start = new Date(end);
                start.setHours(0, 0, 0, 0);
                break;
            case TIME_PERIODS.WEEK:
                start.setDate(start.getDate() - 7);
                break;
            case TIME_PERIODS.MONTH:
                start.setMonth(start.getMonth() - 1);
                break;
            case TIME_PERIODS.QUARTER:
                start.setMonth(start.getMonth() - 3);
                break;
            case TIME_PERIODS.YEAR:
                start.setFullYear(start.getFullYear() - 1);
                break;
            case TIME_PERIODS.CUSTOM:
                start = new Date(customStart || start);
                end = new Date(customEnd || end);
                break;
            default:
                start.setDate(start.getDate() - 7);
        }

        return { start, end };
    }

    /**
     * Cache management
     */
    getFromCache(key) {
        const cached = this.metricsCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        this.metricsCache.delete(key);
        return null;
    }

    setCache(key, data) {
        if (this.metricsCache.size >= 1000) {
            const firstKey = this.metricsCache.keys().next().value;
            this.metricsCache.delete(firstKey);
        }
        this.metricsCache.set(key, {
            data,
            expiresAt: Date.now() + this.cacheTTL * 1000
        });
    }

    clearCache() {
        this.metricsCache.clear();
    }

    /**
     * Stop the periodic aggregation.
     *
     * Every other service with a timer in this repo exposes one of these; this
     * one created an interval it kept no handle to, so nothing could.
     */
    shutdown() {
        if (this.aggregationTimer) {
            clearInterval(this.aggregationTimer);
            this.aggregationTimer = null;
        }
    }

    /**
     * Database operations
     */
    async loadHistoricalMetrics() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM aggregated_metrics 
                 ORDER BY aggregated_at DESC 
                 LIMIT 100`
            );

            for (const row of rows) {
                this.metricHistory.push({
                    period: row.period,
                    metrics: JSON.parse(row.metrics),
                    summary: JSON.parse(row.summary),
                    aggregatedAt: row.aggregated_at
                });
            }

            console.log(`📊 Loaded ${rows.length} historical metrics`);
        } catch (error) {
            console.error('Load historical metrics error:', error);
        }
    }

    async storeAggregatedMetrics(metrics) {
        try {
            for (const metric of metrics) {
                await db.query(
                    `INSERT INTO aggregated_metrics 
                     (period, metrics, summary, aggregated_at)
                     VALUES (?, ?, ?, NOW())`,
                    [
                        metric.period,
                        JSON.stringify(metric),
                        JSON.stringify(metric.summary)
                    ]
                );
            }
        } catch (error) {
            console.error('Store aggregated metrics error:', error);
        }
    }

    /**
     * Get metrics statistics
     */
    async getStatistics() {
        return {
            cacheSize: this.metricsCache.size,
            historyCount: this.metricHistory.length,
            lastAggregation: this.lastAggregation,
            isAggregating: this.isAggregating,
            metricTypes: Object.values(METRIC_TYPES),
            timePeriods: Object.values(TIME_PERIODS)
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    MetricsAggregationService,
    MetricsError,
    METRIC_TYPES,
    TIME_PERIODS,
    REVENUE_ORDERS,
    ORDER_VALUE,
    assertSupportedFilters,
    metricsAggregationService: new MetricsAggregationService()
};