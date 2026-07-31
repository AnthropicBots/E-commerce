// backend/services/queryProfilingService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// QUERY PROFILING CONFIGURATION
// ============================================

const PROFILING_CONFIG = {
    // Thresholds (in milliseconds)
    slowQueryThreshold: 1000, // 1 second
    criticalQueryThreshold: 5000, // 5 seconds
    warningThreshold: 500, // 500ms
    
    // Sampling
    samplingRate: 0.1, // 10% of queries
    maxQueriesPerMinute: 100,
    
    // Retention
    retentionDays: 30,
    maxRecords: 10000,
    
    // Alerting
    alertEnabled: true,
    alertThreshold: 10, // Number of slow queries before alert
    alertWindow: 60, // Seconds
    alertCooldown: 300 // 5 minutes
};

// ============================================
// QUERY PROFILING SERVICE
// ============================================

class QueryProfilingService extends EventEmitter {
    constructor() {
        super();
        this.queryLogs = [];
        this.slowQueries = [];
        this.criticalQueries = [];
        this.queryStats = new Map();
        this.alertHistory = [];
        this.alertCooldown = new Map();
        this.profilingEnabled = true;
        this.metrics = {
            totalQueries: 0,
            slowQueries: 0,
            criticalQueries: 0,
            avgExecutionTime: 0,
            maxExecutionTime: 0,
            minExecutionTime: Infinity
        };
    }

    /**
     * Initialize query profiling
     */
    async initialize() {
        // Load historical data
        await this.loadHistoricalData();

        // Start periodic cleanup
        setInterval(() => this.cleanupOldRecords(), 3600000); // 1 hour

        console.log('✅ Query Profiling Service initialized');
        return this;
    }

    /**
     * Profile a query execution
     */
    async profileQuery(query, params = [], context = {}) {
        if (!this.profilingEnabled) {
            return { result: null, profile: null };
        }

        // Sample queries (reduce overhead)
        if (Math.random() > PROFILING_CONFIG.samplingRate) {
            // Still track basic metrics without full profiling
            const startTime = Date.now();
            try {
                const result = await db.query(query, params);
                const duration = Date.now() - startTime;
                this.updateBasicMetrics(query, duration);
                return { result, profile: null };
            } catch (error) {
                throw error;
            }
        }

        const startTime = Date.now();
        const startMemory = process.memoryUsage().heapUsed;

        try {
            // Execute query with EXPLAIN
            const [explainResult] = await db.query(`EXPLAIN ${query}`, params);
            
            // Execute actual query
            const result = await db.query(query, params);
            
            const duration = Date.now() - startTime;
            const memoryUsed = process.memoryUsage().heapUsed - startMemory;

            // Create profile
            const profile = {
                query: query.substring(0, 1000),
                params: JSON.stringify(params),
                duration,
                memoryUsed,
                rowsAffected: result[0]?.affectedRows || result[0]?.length || 0,
                timestamp: new Date().toISOString(),
                context,
                explain: explainResult,
                hash: this.hashQuery(query)
            };

            // Store profile
            this.storeProfile(profile);

            // Check thresholds
            this.checkThresholds(profile);

            // Update metrics
            this.updateMetrics(profile);

            return { result, profile };
        } catch (error) {
            const duration = Date.now() - startTime;
            // Log error
            console.error('Query profiling error:', {
                query: query.substring(0, 200),
                duration,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Profile a query using callback pattern
     */
    async profileQueryCallback(query, params, callback, context = {}) {
        const startTime = Date.now();
        try {
            const result = await callback(query, params);
            const duration = Date.now() - startTime;
            
            if (duration > PROFILING_CONFIG.warningThreshold) {
                this.recordSlowQuery(query, params, duration, context);
            }
            
            return result;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Store query profile
     */
    storeProfile(profile) {
        this.queryLogs.push(profile);
        
        // Keep only max records
        if (this.queryLogs.length > PROFILING_CONFIG.maxRecords) {
            this.queryLogs = this.queryLogs.slice(-PROFILING_CONFIG.maxRecords);
        }

        // Store in database asynchronously
        this.storeProfileInDB(profile);
    }

    /**
     * Check query thresholds
     */
    checkThresholds(profile) {
        const { duration, query, hash } = profile;

        // Slow query
        if (duration > PROFILING_CONFIG.slowQueryThreshold) {
            this.slowQueries.push(profile);
            this.metrics.slowQueries++;
            this.emit('slow.query', profile);
            
            // Update stats
            const stats = this.queryStats.get(hash) || { count: 0, totalDuration: 0, maxDuration: 0 };
            stats.count++;
            stats.totalDuration += duration;
            stats.maxDuration = Math.max(stats.maxDuration, duration);
            stats.lastSeen = new Date().toISOString();
            this.queryStats.set(hash, stats);

            // Check alert conditions
            this.checkAlertConditions(profile);
        }

        // Critical query
        if (duration > PROFILING_CONFIG.criticalQueryThreshold) {
            this.criticalQueries.push(profile);
            this.metrics.criticalQueries++;
            this.emit('critical.query', profile);
        }

        // Update aggregate metrics
        this.metrics.totalQueries++;
        this.metrics.avgExecutionTime = 
            (this.metrics.avgExecutionTime * (this.metrics.totalQueries - 1) + duration) / 
            this.metrics.totalQueries;
        this.metrics.maxExecutionTime = Math.max(this.metrics.maxExecutionTime, duration);
        this.metrics.minExecutionTime = Math.min(this.metrics.minExecutionTime, duration);
    }

    /**
     * Check alert conditions
     */
    checkAlertConditions(profile) {
        const { hash, duration } = profile;
        
        // Check cooldown
        if (this.alertCooldown.has(hash)) {
            const cooldownTime = this.alertCooldown.get(hash);
            if (Date.now() - cooldownTime < PROFILING_CONFIG.alertCooldown * 1000) {
                return;
            }
        }

        // Get recent slow queries for this query hash
        const recentSlowQueries = this.slowQueries.filter(q => q.hash === hash);
        const recentCount = recentSlowQueries.length;

        if (recentCount >= PROFILING_CONFIG.alertThreshold) {
            // Generate alert
            const alert = {
                id: this.generateAlertId(),
                query: profile.query,
                hash,
                duration: duration,
                count: recentCount,
                timestamp: new Date().toISOString(),
                recommendation: this.generateRecommendation(profile)
            };

            this.alertHistory.push(alert);
            this.emit('query.alert', alert);

            // Set cooldown
            this.alertCooldown.set(hash, Date.now());
        }
    }

    /**
     * Generate optimization recommendation
     */
    generateRecommendation(profile) {
        const recommendations = [];
        
        // Check for missing indexes
        if (profile.explain && profile.explain.some(row => row.type === 'ALL')) {
            recommendations.push('Consider adding indexes for full table scans');
        }

        // Check for large row scans
        if (profile.rowsAffected > 10000) {
            recommendations.push('Consider pagination or limiting result set');
        }

        // Check for complex joins
        if (profile.query.toLowerCase().includes('join') && profile.duration > 2000) {
            recommendations.push('Consider optimizing join conditions or adding indexes');
        }

        // Check for ORDER BY without index
        if (profile.query.toLowerCase().includes('order by') && 
            profile.explain && profile.explain.some(row => row.type === 'Using filesort')) {
            recommendations.push('Consider adding index for ORDER BY columns');
        }

        // General recommendation
        if (recommendations.length === 0) {
            recommendations.push('Consider query optimization or caching');
        }

        return recommendations;
    }

    /**
     * Get slow queries
     */
    getSlowQueries(limit = 100, offset = 0) {
        return this.slowQueries
            .sort((a, b) => b.duration - a.duration)
            .slice(offset, offset + limit);
    }

    /**
     * Get query statistics
     */
    getQueryStats() {
        const stats = Array.from(this.queryStats.entries())
            .map(([hash, data]) => ({
                hash,
                ...data,
                avgDuration: data.totalDuration / data.count
            }))
            .sort((a, b) => b.avgDuration - a.avgDuration)
            .slice(0, 20);

        return {
            ...this.metrics,
            topSlowQueries: stats,
            slowQueryCount: this.slowQueries.length,
            criticalQueryCount: this.criticalQueries.length,
            totalQueryLogs: this.queryLogs.length,
            alertCount: this.alertHistory.length
        };
    }

    /**
     * Get alerts
     */
    getAlerts(limit = 50) {
        return this.alertHistory.slice(-limit).reverse();
    }

    /**
     * Get query by hash
     */
    getQueryByHash(hash) {
        const stats = this.queryStats.get(hash);
        const logs = this.queryLogs.filter(q => q.hash === hash);
        return { stats, logs: logs.slice(0, 20) };
    }

    /**
     * Clear slow queries
     */
    clearSlowQueries() {
        this.slowQueries = [];
        this.criticalQueries = [];
    }

    /**
     * Update basic metrics
     */
    updateBasicMetrics(query, duration) {
        this.metrics.totalQueries++;
        this.metrics.avgExecutionTime = 
            (this.metrics.avgExecutionTime * (this.metrics.totalQueries - 1) + duration) / 
            this.metrics.totalQueries;
        this.metrics.maxExecutionTime = Math.max(this.metrics.maxExecutionTime, duration);
        this.metrics.minExecutionTime = Math.min(this.metrics.minExecutionTime, duration);
    }

    /**
     * Update metrics with profile
     */
    updateMetrics(profile) {
        // Already updated in checkThresholds
    }

    /**
     * Record slow query without full profiling
     */
    recordSlowQuery(query, params, duration, context) {
        if (duration > PROFILING_CONFIG.slowQueryThreshold) {
            this.slowQueries.push({
                query: query.substring(0, 500),
                params: JSON.stringify(params),
                duration,
                timestamp: new Date().toISOString(),
                context,
                hash: this.hashQuery(query)
            });
        }
    }

    /**
     * Hash query for grouping
     */
    hashQuery(query) {
        // Normalize query by removing values
        const normalized = query
            .replace(/\d+/g, '?')
            .replace(/'[^']*'/g, '?')
            .replace(/\s+/g, ' ')
            .trim();
        return crypto.createHash('md5').update(normalized).digest('hex');
    }

    /**
     * Generate alert ID
     */
    generateAlertId() {
        return `ALERT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeProfileInDB(profile) {
        try {
            await db.query(
                `INSERT INTO query_profiles 
                 (query_hash, query_text, params, duration, memory_used,
                  rows_affected, explain_result, context, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    profile.hash,
                    profile.query,
                    profile.params,
                    profile.duration,
                    profile.memoryUsed || 0,
                    profile.rowsAffected || 0,
                    JSON.stringify(profile.explain || []),
                    JSON.stringify(profile.context || {}),
                    profile.timestamp
                ]
            );
        } catch (error) {
            console.error('Store profile error:', error);
        }
    }

    async loadHistoricalData() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM query_profiles 
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)
                 ORDER BY timestamp DESC LIMIT 1000`,
                [PROFILING_CONFIG.retentionDays]
            );

            for (const row of rows) {
                const profile = {
                    hash: row.query_hash,
                    query: row.query_text,
                    params: row.params,
                    duration: row.duration,
                    memoryUsed: row.memory_used,
                    rowsAffected: row.rows_affected,
                    explain: JSON.parse(row.explain_result || '[]'),
                    context: JSON.parse(row.context || '{}'),
                    timestamp: row.timestamp
                };

                this.queryLogs.push(profile);
                if (profile.duration > PROFILING_CONFIG.slowQueryThreshold) {
                    this.slowQueries.push(profile);
                }
            }

            console.log(`📊 Loaded ${rows.length} historical query profiles`);
        } catch (error) {
            console.error('Load historical data error:', error);
        }
    }

    async cleanupOldRecords() {
        try {
            await db.query(
                `DELETE FROM query_profiles 
                 WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [PROFILING_CONFIG.retentionDays]
            );
            console.log('🧹 Cleaned up old query profiles');
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            metrics: this.metrics,
            slowQueryCount: this.slowQueries.length,
            criticalQueryCount: this.criticalQueries.length,
            alertCount: this.alertHistory.length,
            uniqueQueries: this.queryStats.size,
            profilingEnabled: this.profilingEnabled,
            config: PROFILING_CONFIG,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            enabled: this.profilingEnabled,
            totalQueries: this.metrics.totalQueries,
            slowQueries: this.slowQueries.length,
            criticalQueries: this.criticalQueries.length,
            alerts: this.alertHistory.length,
            queryLogs: this.queryLogs.length
        };
    }

    /**
     * Enable profiling
     */
    enable() {
        this.profilingEnabled = true;
        console.log('✅ Query profiling enabled');
    }

    /**
     * Disable profiling
     */
    disable() {
        this.profilingEnabled = false;
        console.log('⏸️ Query profiling disabled');
    }
}

// ============================================
// QUERY PROFILING MIDDLEWARE
// ============================================

/**
 * Middleware to profile database queries
 */
function createQueryProfiler() {
    return async (req, res, next) => {
        // Add profiling to request
        req.profile = {
            startTime: Date.now(),
            queries: [],
            slowQueries: []
        };

        // Store original db.query
        const originalQuery = db.query;
        
        // Override db.query for this request
        db.query = async function(query, params) {
            const start = Date.now();
            try {
                const result = await originalQuery.call(db, query, params);
                const duration = Date.now() - start;
                
                // Store in request profile
                req.profile.queries.push({
                    query: query.substring(0, 200),
                    duration,
                    timestamp: new Date().toISOString()
                });

                if (duration > PROFILING_CONFIG.slowQueryThreshold) {
                    req.profile.slowQueries.push({
                        query: query.substring(0, 500),
                        duration
                    });
                }

                // Record in profiling service
                queryProfilingService.profileQuery(query, params, {
                    requestId: req.requestId,
                    path: req.path,
                    userId: req.user?.id
                });

                return result;
            } catch (error) {
                throw error;
            }
        };

        // Restore after request
        res.on('finish', () => {
            db.query = originalQuery;
        });

        next();
    };
}

// ============================================
// EXPORT
// ============================================

const queryProfilingService = new QueryProfilingService();

module.exports = {
    QueryProfilingService,
    queryProfilingService,
    createQueryProfiler,
    PROFILING_CONFIG
};