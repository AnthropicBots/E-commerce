// backend/services/agentPerformanceMonitorService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// PERFORMANCE MONITORING CONFIGURATION
// ============================================

const PERFORMANCE_CONFIG = {
    // Metrics weights
    weights: {
        price_optimization: 0.30,
        negotiation_success: 0.25,
        speed: 0.15,
        user_satisfaction: 0.20,
        consistency: 0.10
    },
    
    // Benchmark windows
    benchmarkWindow: 30, // days
    comparisonModels: ['haiku', 'sonnet', 'opus'],
    
    // Alert thresholds
    alertThreshold: 0.20, // 20% below benchmark
    criticalThreshold: 0.40, // 40% below benchmark
    
    // Performance tiers
    performanceTiers: {
        EXCELLENT: { label: 'Excellent', minScore: 90, color: '#4CAF50' },
        GOOD: { label: 'Good', minScore: 75, color: '#8BC34A' },
        AVERAGE: { label: 'Average', minScore: 60, color: '#FFC107' },
        BELOW_AVERAGE: { label: 'Below Average', minScore: 40, color: '#FF9800' },
        POOR: { label: 'Poor', minScore: 0, color: '#F44336' }
    }
};

// ============================================
// AGENT PERFORMANCE MONITORING SERVICE
// ============================================

class AgentPerformanceMonitorService extends EventEmitter {
    constructor() {
        super();
        this.agentScores = new Map();
        this.benchmarks = new Map();
        this.performanceHistory = new Map();
        this.userFeedback = new Map();
        this.performanceAlerts = [];
        this.comparisonData = new Map();
        this.isInitialized = false;
    }

    /**
     * Initialize service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load historical performance data
        await this.loadPerformanceData();

        // Calculate benchmarks
        await this.calculateBenchmarks();

        this.isInitialized = true;
        console.log('✅ Agent Performance Monitor Service initialized');
        return this;
    }

    /**
     * Track agent performance for a transaction
     */
    async trackPerformance(agentId, transactionData) {
        const performance = {
            agentId,
            transactionId: transactionData.transactionId,
            timestamp: new Date().toISOString(),
            metrics: this.calculateMetrics(transactionData),
            modelType: transactionData.modelType || 'unknown',
            success: transactionData.success || false,
            duration: transactionData.duration || 0
        };

        // Calculate score
        performance.score = this.calculateScore(performance.metrics);
        performance.tier = this.getPerformanceTier(performance.score);

        // Store in database
        await this.storePerformance(performance);

        // Update agent history
        this.updateAgentHistory(agentId, performance);

        // Check for performance alerts
        await this.checkPerformanceAlerts(agentId, performance);

        // Emit event
        this.emit('performance.tracked', { agentId, performance });

        return performance;
    }

    /**
     * Calculate performance metrics
     */
    calculateMetrics(transactionData) {
        const metrics = {
            price_optimization: 0,
            negotiation_success: 0,
            speed: 0,
            user_satisfaction: 0,
            consistency: 0
        };

        // Price optimization
        if (transactionData.targetPrice && transactionData.achievedPrice) {
            const priceDiff = transactionData.achievedPrice - transactionData.targetPrice;
            const priceRatio = transactionData.targetPrice > 0 
                ? (transactionData.achievedPrice / transactionData.targetPrice) 
                : 0;
            
            metrics.price_optimization = Math.max(0, Math.min(100, 
                (1 - Math.abs(priceRatio - 1)) * 100
            ));
        }

        // Negotiation success
        metrics.negotiation_success = transactionData.success ? 100 : 
            (transactionData.partialSuccess ? 50 : 0);

        // Speed (faster is better)
        if (transactionData.duration) {
            const optimalDuration = 5000; // 5 seconds
            metrics.speed = Math.max(0, Math.min(100,
                (1 - (transactionData.duration / optimalDuration)) * 100
            ));
        }

        // User satisfaction (if available)
        if (transactionData.userRating) {
            metrics.user_satisfaction = (transactionData.userRating / 5) * 100;
        } else {
            // Default to average
            metrics.user_satisfaction = 70;
        }

        // Consistency (compare to historical)
        metrics.consistency = 70; // Default, updated with history

        return metrics;
    }

    /**
     * Calculate overall score
     */
    calculateScore(metrics) {
        let score = 0;
        const weights = PERFORMANCE_CONFIG.weights;

        for (const [key, value] of Object.entries(metrics)) {
            if (weights[key]) {
                score += value * weights[key];
            }
        }

        return Math.round(score);
    }

    /**
     * Get performance tier
     */
    getPerformanceTier(score) {
        const tiers = PERFORMANCE_CONFIG.performanceTiers;
        for (const [key, tier] of Object.entries(tiers)) {
            if (score >= tier.minScore) {
                return key;
            }
        }
        return 'POOR';
    }

    /**
     * Get agent performance dashboard
     */
    async getDashboard(agentId, userId) {
        try {
            // Get agent's performance history
            const history = await this.getAgentHistory(agentId);
            const recent = history.slice(-20);

            // Calculate statistics
            const stats = this.calculateStats(recent);

            // Get benchmarks
            const benchmarks = await this.getBenchmarks(agentId);

            // Get alerts
            const alerts = await this.getAgentAlerts(agentId);

            // Get model comparison
            const comparison = await this.getModelComparison(agentId);

            // Get user feedback trends
            const feedback = await this.getFeedbackTrends(agentId);

            return {
                agentId,
                userId,
                summary: stats,
                recentPerformance: recent.slice(-5),
                benchmarks,
                alerts: alerts.slice(0, 5),
                comparison,
                feedback,
                modelType: await this.getAgentModelType(agentId),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Dashboard error:', error);
            throw error;
        }
    }

    /**
     * Calculate statistics
     */
    calculateStats(history) {
        if (history.length === 0) {
            return {
                totalTransactions: 0,
                successRate: 0,
                avgScore: 0,
                avgPriceOptimization: 0,
                avgDuration: 0,
                performanceScore: 0
            };
        }

        const total = history.length;
        const successes = history.filter(h => h.success).length;
        const avgScore = history.reduce((sum, h) => sum + h.score, 0) / total;
        const avgPriceOpt = history.reduce((sum, h) => sum + h.metrics.price_optimization, 0) / total;
        const avgDuration = history.reduce((sum, h) => sum + h.duration, 0) / total;

        return {
            totalTransactions: total,
            successRate: (successes / total) * 100,
            avgScore: Math.round(avgScore),
            avgPriceOptimization: Math.round(avgPriceOpt),
            avgDuration: Math.round(avgDuration),
            performanceTier: this.getPerformanceTier(avgScore)
        };
    }

    /**
     * Get agent history
     */
    async getAgentHistory(agentId, limit = 50) {
        if (this.performanceHistory.has(agentId)) {
            const history = this.performanceHistory.get(agentId);
            return history.slice(-limit);
        }

        try {
            const [rows] = await db.query(
                `SELECT * FROM agent_performance_history 
                 WHERE agent_id = ? 
                 ORDER BY timestamp DESC 
                 LIMIT ?`,
                [agentId, limit]
            );

            const history = rows.map(row => ({
                ...row,
                metrics: JSON.parse(row.metrics),
                timestamp: row.timestamp
            }));

            this.performanceHistory.set(agentId, history);
            return history;
        } catch (error) {
            console.error('Get agent history error:', error);
            return [];
        }
    }

    /**
     * Update agent history
     */
    updateAgentHistory(agentId, performance) {
        if (!this.performanceHistory.has(agentId)) {
            this.performanceHistory.set(agentId, []);
        }
        const history = this.performanceHistory.get(agentId);
        history.push(performance);
        
        // Keep only last 100 entries
        if (history.length > 100) {
            history.shift();
        }
    }

    /**
     * Get benchmarks
     */
    async getBenchmarks(agentId) {
        try {
            const agent = await this.getAgentModelType(agentId);
            const modelType = agent || 'unknown';

            // Get benchmarks for same model type
            const [benchmarks] = await db.query(
                `SELECT 
                    DATE(timestamp) as date,
                    AVG(score) as avgScore,
                    AVG(price_optimization) as avgPriceOpt,
                    AVG(success_rate) as successRate,
                    COUNT(*) as transactionCount
                 FROM agent_performance_history 
                 WHERE model_type = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY DATE(timestamp)
                 ORDER BY date DESC`,
                [modelType, PERFORMANCE_CONFIG.benchmarkWindow]
            );

            // Calculate overall benchmark
            const overall = await this.calculateOverallBenchmark(modelType);

            return {
                modelType,
                daily: benchmarks,
                overall: overall,
                transactionCount: benchmarks.length
            };
        } catch (error) {
            console.error('Get benchmarks error:', error);
            return null;
        }
    }

    /**
     * Calculate overall benchmark
     */
    async calculateOverallBenchmark(modelType) {
        try {
            const [result] = await db.query(
                `SELECT 
                    AVG(score) as avgScore,
                    AVG(price_optimization) as avgPriceOpt,
                    AVG(success_rate) as successRate,
                    COUNT(*) as transactionCount
                 FROM agent_performance_history 
                 WHERE model_type = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [modelType, PERFORMANCE_CONFIG.benchmarkWindow]
            );

            return {
                avgScore: Math.round(result[0]?.avgScore || 0),
                avgPriceOpt: Math.round(result[0]?.avgPriceOpt || 0),
                successRate: Math.round(result[0]?.successRate || 0),
                transactionCount: result[0]?.transactionCount || 0
            };
        } catch (error) {
            console.error('Calculate benchmark error:', error);
            return null;
        }
    }

    /**
     * Get model comparison
     */
    async getModelComparison(agentId) {
        try {
            const agentModel = await this.getAgentModelType(agentId);
            const models = ['haiku', 'sonnet', 'opus'];
            const comparison = [];

            for (const model of models) {
                const stats = await this.calculateOverallBenchmark(model);
                comparison.push({
                    model,
                    ...stats,
                    isCurrent: model === agentModel
                });
            }

            return comparison;
        } catch (error) {
            console.error('Model comparison error:', error);
            return [];
        }
    }

    /**
     * Get agent model type
     */
    async getAgentModelType(agentId) {
        try {
            const [result] = await db.query(
                'SELECT model_type FROM agents WHERE agent_id = ?',
                [agentId]
            );
            return result[0]?.model_type || 'unknown';
        } catch (error) {
            console.error('Get agent model error:', error);
            return 'unknown';
        }
    }

    /**
     * Check performance alerts
     */
    async checkPerformanceAlerts(agentId, performance) {
        const benchmark = await this.calculateOverallBenchmark(
            await this.getAgentModelType(agentId)
        );

        if (!benchmark) return;

        const scoreDifference = benchmark.avgScore - performance.score;
        const percentageDifference = benchmark.avgScore > 0 
            ? (scoreDifference / benchmark.avgScore) 
            : 0;

        if (percentageDifference > PERFORMANCE_CONFIG.criticalThreshold) {
            await this.createPerformanceAlert(agentId, performance, 'critical', 
                `Performance is ${(percentageDifference * 100).toFixed(0)}% below benchmark`
            );
        } else if (percentageDifference > PERFORMANCE_CONFIG.alertThreshold) {
            await this.createPerformanceAlert(agentId, performance, 'warning',
                `Performance is ${(percentageDifference * 100).toFixed(0)}% below benchmark`
            );
        }
    }

    /**
     * Create performance alert
     */
    async createPerformanceAlert(agentId, performance, severity, message) {
        const alert = {
            id: `PERF_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            agentId,
            severity,
            message,
            performance,
            timestamp: new Date().toISOString(),
            resolved: false
        };

        this.performanceAlerts.push(alert);

        await db.query(
            `INSERT INTO performance_alerts 
             (alert_id, agent_id, severity, message, performance_data, timestamp)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [
                alert.id,
                alert.agentId,
                alert.severity,
                alert.message,
                JSON.stringify(alert.performance)
            ]
        );

        this.emit('performance.alert', alert);

        return alert;
    }

    /**
     * Get agent alerts
     */
    async getAgentAlerts(agentId) {
        return this.performanceAlerts
            .filter(a => a.agentId === agentId)
            .slice(-10);
    }

    /**
     * Submit user feedback
     */
    async submitFeedback(agentId, userId, feedback) {
        try {
            await db.query(
                `INSERT INTO agent_feedback 
                 (agent_id, user_id, rating, comment, category, timestamp)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    agentId,
                    userId,
                    feedback.rating || 0,
                    feedback.comment || null,
                    feedback.category || 'general'
                ]
            );

            // Update feedback history
            if (!this.userFeedback.has(agentId)) {
                this.userFeedback.set(agentId, []);
            }
            this.userFeedback.get(agentId).push({
                ...feedback,
                userId,
                timestamp: new Date().toISOString()
            });

            // Emit event
            this.emit('feedback.submitted', { agentId, userId, feedback });

            return { success: true };
        } catch (error) {
            console.error('Submit feedback error:', error);
            throw error;
        }
    }

    /**
     * Get feedback trends
     */
    async getFeedbackTrends(agentId) {
        try {
            const [feedback] = await db.query(
                `SELECT 
                    AVG(rating) as avgRating,
                    COUNT(*) as totalFeedback,
                    COUNT(DISTINCT user_id) as uniqueUsers,
                    DATE(timestamp) as date
                 FROM agent_feedback 
                 WHERE agent_id = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
                 GROUP BY DATE(timestamp)
                 ORDER BY date DESC`,
                [agentId]
            );

            const [overall] = await db.query(
                `SELECT 
                    AVG(rating) as avgRating,
                    COUNT(*) as totalFeedback,
                    COUNT(DISTINCT user_id) as uniqueUsers
                 FROM agent_feedback 
                 WHERE agent_id = ?`,
                [agentId]
            );

            return {
                daily: feedback || [],
                overall: overall[0] || { avgRating: 0, totalFeedback: 0, uniqueUsers: 0 },
                trend: this.calculateFeedbackTrend(feedback)
            };
        } catch (error) {
            console.error('Feedback trends error:', error);
            return null;
        }
    }

    /**
     * Calculate feedback trend
     */
    calculateFeedbackTrend(dailyData) {
        if (!dailyData || dailyData.length < 2) return 'stable';

        const recent = dailyData.slice(0, 5);
        const older = dailyData.slice(-5);
        
        const recentAvg = recent.reduce((sum, d) => sum + d.avgRating, 0) / recent.length;
        const olderAvg = older.reduce((sum, d) => sum + d.avgRating, 0) / older.length;

        if (recentAvg > olderAvg * 1.1) return 'improving';
        if (recentAvg < olderAvg * 0.9) return 'declining';
        return 'stable';
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadPerformanceData() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM agent_performance_history 
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
                 ORDER BY timestamp DESC`
            );

            for (const row of rows) {
                const performance = {
                    ...row,
                    metrics: JSON.parse(row.metrics)
                };
                
                if (!this.performanceHistory.has(row.agent_id)) {
                    this.performanceHistory.set(row.agent_id, []);
                }
                this.performanceHistory.get(row.agent_id).push(performance);
            }

            console.log(`📊 Loaded ${rows.length} performance records`);
        } catch (error) {
            console.error('Load performance data error:', error);
        }
    }

    async calculateBenchmarks() {
        try {
            const models = PERFORMANCE_CONFIG.comparisonModels;
            for (const model of models) {
                const benchmark = await this.calculateOverallBenchmark(model);
                if (benchmark) {
                    this.benchmarks.set(model, benchmark);
                }
            }
            console.log(`📈 Calculated benchmarks for ${this.benchmarks.size} models`);
        } catch (error) {
            console.error('Calculate benchmarks error:', error);
        }
    }

    async storePerformance(performance) {
        try {
            await db.query(
                `INSERT INTO agent_performance_history 
                 (agent_id, transaction_id, model_type, success, duration,
                  score, metrics, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    performance.agentId,
                    performance.transactionId,
                    performance.modelType,
                    performance.success ? 1 : 0,
                    performance.duration,
                    performance.score,
                    JSON.stringify(performance.metrics),
                    performance.timestamp
                ]
            );
        } catch (error) {
            console.error('Store performance error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            agents: this.performanceHistory.size,
            totalTransactions: Array.from(this.performanceHistory.values())
                .reduce((sum, h) => sum + h.length, 0),
            benchmarks: this.benchmarks.size,
            alerts: this.performanceAlerts.length,
            pendingAlerts: this.performanceAlerts.filter(a => !a.resolved).length,
            feedback: Array.from(this.userFeedback.values())
                .reduce((sum, f) => sum + f.length, 0),
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            agents: this.performanceHistory.size,
            alerts: this.performanceAlerts.length,
            benchmarks: this.benchmarks.size
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    AgentPerformanceMonitorService,
    PERFORMANCE_CONFIG,
    agentPerformanceMonitor: new AgentPerformanceMonitorService()
};