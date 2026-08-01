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
    }

    /**
     * Initialize metrics service
     */
    async initialize() {
        // Load historical metrics
        await this.loadHistoricalMetrics();

        // Start periodic aggregation
        setInterval(() => this.aggregateMetrics(), 3600000); // 1 hour

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

        let query = `
            SELECT 
                COUNT(DISTINCT o.id) as orders,
                COUNT(DISTINCT c.id) as carts,
                (COUNT(DISTINCT o.id) / NULLIF(COUNT(DISTINCT c.id), 0)) * 100 as conversion_rate
            FROM carts c
            LEFT JOIN orders o ON o.cart_id = c.id AND o.status = 'completed'
            WHERE c.created_at BETWEEN ? AND ?
        `;

        if (filters.category) {
            query += ' AND c.category = ?';
            params.push(filters.category);
        }

        if (filters.userSegment) {
            query += ' AND c.user_segment = ?';
            params.push(filters.userSegment);
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

        let query = `
            SELECT 
                AVG(total_amount) as avg_order_value,
                COUNT(*) as order_count,
                SUM(total_amount) as total_revenue
            FROM orders
            WHERE status = 'completed'
            AND created_at BETWEEN ? AND ?
        `;

        if (filters.category) {
            query += ' AND category = ?';
            params.push(filters.category);
        }

        if (filters.userSegment) {
            query += ' AND user_segment = ?';
            params.push(filters.userSegment);
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

        let query = `
            SELECT 
                COUNT(*) as total_carts,
                SUM(CASE WHEN abandoned = 1 THEN 1 ELSE 0 END) as abandoned_carts,
                (SUM(CASE WHEN abandoned = 1 THEN 1 ELSE 0 END) / COUNT(*)) * 100 as abandoned_rate,
                SUM(total_value) as lost_revenue
            FROM carts
            WHERE created_at BETWEEN ? AND ?
            AND status = 'abandoned'
        `;

        if (filters.category) {
            query += ' AND category = ?';
            params.push(filters.category);
        }

        if (filters.minValue) {
            query += ' AND total_value >= ?';
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

        const dateRange = this.getDateRange(period);
        const params = [dateRange.start, dateRange.end];

        let query = `
            SELECT 
                COUNT(*) as total_impressions,
                SUM(CASE WHEN clicked = 1 THEN 1 ELSE 0 END) as clicks,
                (SUM(CASE WHEN clicked = 1 THEN 1 ELSE 0 END) / COUNT(*)) * 100 as ctr,
                SUM(CASE WHEN purchased = 1 THEN 1 ELSE 0 END) as purchases
            FROM recommendation_interactions
            WHERE created_at BETWEEN ? AND ?
        `;

        if (filters.recommendationType) {
            query += ' AND recommendation_type = ?';
            params.push(filters.recommendationType);
        }

        if (filters.userSegment) {
            query += ' AND user_segment = ?';
            params.push(filters.userSegment);
        }

        const [rows] = await db.query(query, params);
        const result = {
            metric: 'recommendation_ctr',
            value: parseFloat(rows[0]?.ctr || 0),
            impressions: parseInt(rows[0]?.total_impressions || 0),
            clicks: parseInt(rows[0]?.clicks || 0),
            purchases: parseInt(rows[0]?.purchases || 0),
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

        let query = `
            SELECT 
                c.code,
                c.discount_type,
                c.discount_value,
                COUNT(o.id) as usage_count,
                SUM(o.total_amount) as revenue_generated,
                AVG(o.total_amount) as avg_order_value,
                (SUM(o.total_amount) / NULLIF(COUNT(o.id), 0)) - c.discount_value as net_value
            FROM coupons c
            LEFT JOIN orders o ON o.coupon_code = c.code AND o.status = 'completed'
            WHERE c.created_at BETWEEN ? AND ?
            AND c.usage_count > 0
            GROUP BY c.id
            ORDER BY revenue_generated DESC
        `;

        if (filters.couponType) {
            query += ' AND c.discount_type = ?';
            params.push(filters.couponType);
        }

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

        let query = `
            SELECT 
                u.id,
                u.name,
                COUNT(o.id) as order_count,
                SUM(o.total_amount) as total_spent,
                AVG(o.total_amount) as avg_order_value,
                DATEDIFF(NOW(), MAX(o.created_at)) as days_since_last_order,
                DATEDIFF(NOW(), u.created_at) as customer_age_days,
                (SUM(o.total_amount) / NULLIF(DATEDIFF(NOW(), u.created_at), 0)) * 30 as monthly_value
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'completed'
            WHERE u.created_at BETWEEN ? AND ?
            GROUP BY u.id
            HAVING order_count > 0
            ORDER BY total_spent DESC
            LIMIT 100
        `;

        if (filters.minOrders) {
            query = query.replace('ORDER BY', `HAVING order_count >= ${filters.minOrders} ORDER BY`);
        }

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

        // Get current period revenue
        const [currentRevenue] = await db.query(
            `SELECT SUM(total_amount) as revenue, COUNT(*) as orders 
             FROM orders 
             WHERE status = 'completed' 
             AND created_at BETWEEN ? AND ?`,
            params
        );

        // Get previous period revenue
        const periodDuration = dateRange.end - dateRange.start;
        const previousStart = new Date(dateRange.start - periodDuration);
        const previousEnd = new Date(dateRange.end - periodDuration);

        const [previousRevenue] = await db.query(
            `SELECT SUM(total_amount) as revenue 
             FROM orders 
             WHERE status = 'completed' 
             AND created_at BETWEEN ? AND ?`,
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

        // Get active users at start of period
        const [activeUsers] = await db.query(
            `SELECT COUNT(DISTINCT user_id) as active 
             FROM orders 
             WHERE status = 'completed' 
             AND created_at < ? 
             AND created_at > DATE_SUB(?, INTERVAL 30 DAY)`,
            [dateRange.start, dateRange.start]
        );

        // Get users who churned (no activity in period)
        const [churnedUsers] = await db.query(
            `SELECT COUNT(DISTINCT user_id) as churned 
             FROM users u
             WHERE u.created_at < ?
             AND u.id NOT IN (
                 SELECT DISTINCT user_id 
                 FROM orders 
                 WHERE created_at BETWEEN ? AND ?
             )`,
            [dateRange.start, dateRange.start, dateRange.end]
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
    METRIC_TYPES,
    TIME_PERIODS,
    metricsAggregationService: new MetricsAggregationService()
};