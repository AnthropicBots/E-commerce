// backend/services/agentPerformanceService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const PERFORMANCE_CONFIG = {
    // Benchmarking
    benchmarkWindow: 30, // days
    comparisonModels: ['haiku', 'sonnet', 'opus'],
    
    // Performance metrics
    metrics: {
        NEGOTIATION_EFFECTIVENESS: 'negotiation_effectiveness',
        PRICE_OPTIMIZATION: 'price_optimization',
        SPEED: 'speed',
        USER_SATISFACTION: 'user_satisfaction',
        ECONOMIC_IMPACT: 'economic_impact'
    },
    
    // Alert thresholds
    alertThreshold: 20, // percentage below benchmark
    criticalThreshold: 40,
    
    // Feedback
    feedbackTypes: ['satisfaction', 'fairness', 'effectiveness', 'speed']
};

// ============================================
// AGENT PERFORMANCE CLASS
// ============================================

class AgentPerformanceService {
    constructor() {
        this.performanceData = new Map();
        this.benchmarks = new Map();
        this.alerts = [];
        this.feedbackHistory = new Map();
    }

    /**
     * Track agent negotiation performance
     */
    async trackPerformance(agentId, negotiationData) {
        const performance = {
            agentId,
            timestamp: new Date().toISOString(),
            transactionId: negotiationData.transactionId,
            itemId: negotiationData.itemId,
            targetPrice: negotiationData.targetPrice,
            achievedPrice: negotiationData.achievedPrice,
            modelType: negotiationData.modelType || 'unknown',
            duration: negotiationData.duration || 0,
            success: negotiationData.success || false,
            metrics: {}
        };

        // Calculate performance metrics
        performance.metrics = this.calculateMetrics(performance);

        // Store in database
        await this.storePerformance(performance);

        // Update agent performance history
        this.updateAgentHistory(agentId, performance);

        // Check for poor performance
        await this.checkPerformanceAlerts(agentId, performance);

        return performance;
    }

    /**
     * Calculate performance metrics
     */
    calculateMetrics(performance) {
        const metrics = {};

        // Price optimization
        if (performance.targetPrice && performance.achievedPrice) {
            const priceDiff = performance.achievedPrice - performance.targetPrice;
            const priceRatio = performance.targetPrice > 0 
                ? (performance.achievedPrice / performance.targetPrice) 
                : 0;
            
            metrics.price_optimization = {
                difference: priceDiff,
                ratio: priceRatio,
                percentage: (priceRatio - 1) * 100,
                isBetter: priceRatio < 1 // Buying: lower is better
            };
        }

        // Negotiation effectiveness
        metrics.negotiation_effectiveness = {
            success: performance.success,
            duration: performance.duration,
            modelType: performance.modelType
        };

        // Speed
        metrics.speed = {
            duration: performance.duration,
            rating: performance.duration < 5000 ? 'fast' : 
                    performance.duration < 15000 ? 'medium' : 'slow'
        };

        return metrics;
    }

    /**
     * Get agent performance dashboard
     */
    async getPerformanceDashboard(agentId, userId) {
        try {
            // Get performance history
            const [history] = await db.query(
                `SELECT * FROM agent_negotiation_performance 
                 WHERE agent_id = ? 
                 ORDER BY timestamp DESC 
                 LIMIT 50`,
                [agentId]
            );

            // Get benchmarks
            const benchmarks = await this.getBenchmarks(agentId);

            // Calculate statistics
            const stats = this.calculateStats(history, benchmarks);

            // Get recent alerts
            const alerts = await this.getAgentAlerts(agentId);

            // Get feedback trends
            const feedback = await this.getFeedbackTrends(agentId);

            return {
                agentId,
                userId,
                summary: stats,
                recentPerformance: history.slice(0, 10),
                benchmarks,
                alerts: alerts.slice(0, 5),
                feedback,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Dashboard error:', error);
            throw error;
        }
    }

    /**
     * Calculate performance statistics
     */
    calculateStats(history, benchmarks) {
        if (history.length === 0) {
            return {
                totalNegotiations: 0,
                successRate: 0,
                avgPriceOptimization: 0,
                avgDuration: 0,
                performanceScore: 0
            };
        }

        const successful = history.filter(h => h.success);
        const total = history.length;
        const avgOptimization = history.reduce((sum, h) => {
            const metrics = JSON.parse(h.metrics);
            return sum + (metrics.price_optimization?.percentage || 0);
        }, 0) / total;

        const avgDuration = history.reduce((sum, h) => sum + (h.duration || 0), 0) / total;

        // Calculate performance score (0-100)
        const performanceScore = this.calculatePerformanceScore(history, benchmarks);

        return {
            totalNegotiations: total,
            successRate: (successful.length / total) * 100,
            avgPriceOptimization: avgOptimization,
            avgDuration: avgDuration,
            performanceScore,
            benchmarkComparison: this.compareToBenchmark(avgOptimization, benchmarks)
        };
    }

    /**
     * Calculate performance score
     */
    calculatePerformanceScore(history, benchmarks) {
        let score = 50; // Base score

        // Success rate contribution (max 30 points)
        const successRate = history.filter(h => h.success).length / history.length;
        score += successRate * 30;

        // Price optimization contribution (max 30 points)
        let totalOptimization = 0;
        for (const h of history) {
            const metrics = JSON.parse(h.metrics);
            totalOptimization += metrics.price_optimization?.percentage || 0;
        }
        const avgOptimization = totalOptimization / history.length;
        // Normalize optimization (assume -50% to +50% range)
        const normalizedOptimization = Math.max(-50, Math.min(50, avgOptimization));
        const optimizationScore = ((normalizedOptimization + 50) / 100) * 30;
        score += optimizationScore;

        // Benchmark comparison (max 40 points)
        if (benchmarks && benchmarks.length > 0) {
            const benchmarkAvg = benchmarks.reduce((sum, b) => sum + b.averagePrice, 0) / benchmarks.length;
            const agentAvg = history.reduce((sum, h) => sum + h.achievedPrice, 0) / history.length;
            const comparison = ((benchmarkAvg - agentAvg) / benchmarkAvg) * 100;
            score += Math.max(0, Math.min(40, 40 - comparison));
        }

        return Math.round(Math.max(0, Math.min(100, score)));
    }

    /**
     * Compare to benchmarks
     */
    compareToBenchmark(agentValue, benchmarks) {
        if (!benchmarks || benchmarks.length === 0) {
            return { status: 'unknown', difference: 0 };
        }

        const benchmarkAvg = benchmarks.reduce((sum, b) => sum + b.averagePrice, 0) / benchmarks.length;
        const difference = ((benchmarkAvg - agentValue) / benchmarkAvg) * 100;

        return {
            status: difference > 10 ? 'better' : 
                    difference > -10 ? 'similar' : 'worse',
            difference: difference,
            benchmarkAvg
        };
    }

    /**
     * Get benchmarks for agent
     */
    async getBenchmarks(agentId) {
        try {
            // Get agent's model type
            const [agent] = await db.query(
                'SELECT model_type FROM agents WHERE agent_id = ?',
                [agentId]
            );

            const modelType = agent.length > 0 ? agent[0].model_type : 'unknown';

            // Get benchmarks for same model type
            const [benchmarks] = await db.query(
                `SELECT 
                    DATE(timestamp) as date,
                    AVG(achieved_price) as averagePrice,
                    COUNT(*) as transactionCount,
                    AVG(duration) as avgDuration,
                    AVG(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100 as successRate
                 FROM agent_negotiation_performance 
                 WHERE model_type = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY DATE(timestamp)
                 ORDER BY date DESC`,
                [modelType, PERFORMANCE_CONFIG.benchmarkWindow]
            );

            return benchmarks;
        } catch (error) {
            console.error('Benchmark error:', error);
            return [];
        }
    }

    /**
     * Check for performance alerts
     */
    async checkPerformanceAlerts(agentId, performance) {
        const alerts = [];

        // Check price optimization
        if (performance.metrics.price_optimization) {
            const optimization = performance.metrics.price_optimization.percentage;
            
            // Get agent's historical average
            const [history] = await db.query(
                `SELECT AVG(achieved_price - target_price) as avgOptimization
                 FROM agent_negotiation_performance 
                 WHERE agent_id = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`,
                [agentId]
            );

            const avgOptimization = history[0]?.avgOptimization || 0;
            const deviation = Math.abs(optimization - avgOptimization);

            if (deviation > PERFORMANCE_CONFIG.alertThreshold) {
                alerts.push({
                    type: 'price_optimization_alert',
                    severity: deviation > PERFORMANCE_CONFIG.criticalThreshold ? 'critical' : 'warning',
                    message: `Price optimization deviated by ${deviation.toFixed(0)}% from average`,
                    current: optimization,
                    average: avgOptimization,
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Store alerts
        for (const alert of alerts) {
            await this.storeAlert(agentId, alert);
            this.alerts.push({ agentId, ...alert });
        }

        return alerts;
    }

    /**
     * Get agent alerts
     */
    async getAgentAlerts(agentId) {
        try {
            const [alerts] = await db.query(
                `SELECT * FROM agent_performance_alerts 
                 WHERE agent_id = ? 
                 AND resolved = FALSE 
                 ORDER BY severity DESC, timestamp DESC`,
                [agentId]
            );
            return alerts;
        } catch (error) {
            console.error('Get alerts error:', error);
            return [];
        }
    }

    /**
     * Store performance data
     */
    async storePerformance(performance) {
        try {
            await db.query(
                `INSERT INTO agent_negotiation_performance 
                 (agent_id, transaction_id, item_id, target_price, achieved_price,
                  model_type, duration, success, metrics, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    performance.agentId,
                    performance.transactionId,
                    performance.itemId,
                    performance.targetPrice,
                    performance.achievedPrice,
                    performance.modelType,
                    performance.duration,
                    performance.success ? 1 : 0,
                    JSON.stringify(performance.metrics),
                    performance.timestamp
                ]
            );
        } catch (error) {
            console.error('Store performance error:', error);
        }
    }

    /**
     * Store alert
     */
    async storeAlert(agentId, alert) {
        try {
            await db.query(
                `INSERT INTO agent_performance_alerts 
                 (agent_id, type, severity, message, current, average, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    agentId,
                    alert.type,
                    alert.severity,
                    alert.message,
                    alert.current,
                    alert.average,
                    alert.timestamp
                ]
            );
        } catch (error) {
            console.error('Store alert error:', error);
        }
    }

    /**
     * Update agent history
     */
    updateAgentHistory(agentId, performance) {
        if (!this.performanceData.has(agentId)) {
            this.performanceData.set(agentId, []);
        }
        const history = this.performanceData.get(agentId);
        history.push(performance);
        
        // Keep last 100 entries
        if (history.length > 100) {
            history.shift();
        }
    }

    /**
     * Get feedback trends
     */
    async getFeedbackTrends(agentId) {
        try {
            const [feedback] = await db.query(
                `SELECT 
                    AVG(satisfaction) as avgSatisfaction,
                    AVG(fairness) as avgFairness,
                    AVG(effectiveness) as avgEffectiveness,
                    AVG(speed) as avgSpeed,
                    COUNT(*) as totalFeedback
                 FROM agent_feedback 
                 WHERE agent_id = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
                [agentId]
            );

            return feedback[0] || { totalFeedback: 0 };
        } catch (error) {
            console.error('Feedback trends error:', error);
            return { totalFeedback: 0 };
        }
    }

    /**
     * Submit feedback
     */
    async submitFeedback(agentId, userId, feedback) {
        try {
            await db.query(
                `INSERT INTO agent_feedback 
                 (agent_id, user_id, satisfaction, fairness, effectiveness, speed, comment, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    agentId,
                    userId,
                    feedback.satisfaction || 0,
                    feedback.fairness || 0,
                    feedback.effectiveness || 0,
                    feedback.speed || 0,
                    feedback.comment || null
                ]
            );

            // Update feedback history
            if (!this.feedbackHistory.has(agentId)) {
                this.feedbackHistory.set(agentId, []);
            }
            this.feedbackHistory.get(agentId).push({
                ...feedback,
                userId,
                timestamp: new Date().toISOString()
            });

            return { success: true };
        } catch (error) {
            console.error('Submit feedback error:', error);
            throw error;
        }
    }

    /**
     * Resolve alert
     */
    async resolveAlert(alertId, resolvedBy) {
        try {
            await db.query(
                `UPDATE agent_performance_alerts 
                 SET resolved = TRUE, resolved_by = ?, resolved_at = NOW()
                 WHERE id = ?`,
                [resolvedBy, alertId]
            );
            return { success: true };
        } catch (error) {
            console.error('Resolve alert error:', error);
            throw error;
        }
    }

    /**
     * Get model comparison
     */
    async getModelComparison() {
        try {
            const models = PERFORMANCE_CONFIG.comparisonModels;
            const comparisons = [];

            for (const model of models) {
                const [stats] = await db.query(
                    `SELECT 
                        AVG(achieved_price - target_price) as avgOptimization,
                        AVG(duration) as avgDuration,
                        COUNT(*) as transactionCount,
                        AVG(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100 as successRate
                     FROM agent_negotiation_performance 
                     WHERE model_type = ? 
                     AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)`,
                    [model, PERFORMANCE_CONFIG.benchmarkWindow]
                );

                if (stats[0] && stats[0].transactionCount > 0) {
                    comparisons.push({
                        model,
                        ...stats[0],
                        avgOptimization: parseFloat(stats[0].avgOptimization) || 0,
                        avgDuration: parseFloat(stats[0].avgDuration) || 0,
                        successRate: parseFloat(stats[0].successRate) || 0
                    });
                }
            }

            return comparisons;
        } catch (error) {
            console.error('Model comparison error:', error);
            return [];
        }
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_negotiations,
                    COUNT(DISTINCT agent_id) as active_agents,
                    AVG(achieved_price) as avg_price,
                    AVG(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100 as success_rate
                 FROM agent_negotiation_performance
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            const [alertStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_alerts,
                    SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_alerts,
                    SUM(CASE WHEN resolved = FALSE THEN 1 ELSE 0 END) as pending_alerts
                 FROM agent_performance_alerts
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            return {
                negotiations: stats[0],
                alerts: alertStats[0],
                modelComparison: await this.getModelComparison(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            performanceData: this.performanceData.size,
            alerts: this.alerts.length,
            feedbackHistory: this.feedbackHistory.size,
            config: PERFORMANCE_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new AgentPerformanceService();