// backend/services/businessSLAService.js
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// SLA CONFIGURATION
// ============================================

const SLA_METRICS = {
    CHECKOUT_COMPLETION: 'checkout_completion',
    RECOMMENDATION_GENERATION: 'recommendation_generation',
    INVENTORY_SYNC: 'inventory_sync',
    CART_CONVERSION: 'cart_conversion',
    PAYMENT_CONFIRMATION: 'payment_confirmation',
    ORDER_PROCESSING: 'order_processing',
    NOTIFICATION_DELIVERY: 'notification_delivery',
    ANALYTICS_UPDATE: 'analytics_update',
    PRODUCT_SEARCH: 'product_search',
    CATALOG_UPDATE: 'catalog_update'
};

const SLA_SEVERITY = {
    PASS: 'pass',
    WARNING: 'warning',
    CRITICAL: 'critical',
    FAILURE: 'failure'
};

// ============================================
// BUSINESS SLA SERVICE
// ============================================

class BusinessSLAService extends EventEmitter {
    constructor() {
        super();
        this.slaMetrics = new Map();
        this.slaHistory = [];
        this.alertHistory = [];
        this.isInitialized = false;
        this.activeTimers = new Map();
        this.thresholdConfig = new Map();
    }

    /**
     * Initialize SLA service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load SLA configuration
        await this.loadSLAConfig();

        // Load historical data
        await this.loadHistoricalData();

        this.isInitialized = true;
        console.log('✅ Business SLA Monitoring initialized');
        return this;
    }

    /**
     * Load SLA configuration
     */
    async loadSLAConfig() {
        const defaultConfig = {
            [SLA_METRICS.CHECKOUT_COMPLETION]: {
                threshold: 5000,
                warningThreshold: 3000,
                criticalThreshold: 4000,
                unit: 'ms'
            },
            [SLA_METRICS.RECOMMENDATION_GENERATION]: {
                threshold: 2000,
                warningThreshold: 1000,
                criticalThreshold: 1500,
                unit: 'ms'
            },
            [SLA_METRICS.INVENTORY_SYNC]: {
                threshold: 10000,
                warningThreshold: 5000,
                criticalThreshold: 8000,
                unit: 'ms'
            },
            [SLA_METRICS.CART_CONVERSION]: {
                threshold: 3000,
                warningThreshold: 1500,
                criticalThreshold: 2500,
                unit: 'ms'
            },
            [SLA_METRICS.PAYMENT_CONFIRMATION]: {
                threshold: 8000,
                warningThreshold: 4000,
                criticalThreshold: 6000,
                unit: 'ms'
            },
            [SLA_METRICS.ORDER_PROCESSING]: {
                threshold: 15000,
                warningThreshold: 8000,
                criticalThreshold: 12000,
                unit: 'ms'
            },
            [SLA_METRICS.NOTIFICATION_DELIVERY]: {
                threshold: 5000,
                warningThreshold: 2500,
                criticalThreshold: 4000,
                unit: 'ms'
            },
            [SLA_METRICS.ANALYTICS_UPDATE]: {
                threshold: 3000,
                warningThreshold: 1500,
                criticalThreshold: 2500,
                unit: 'ms'
            },
            [SLA_METRICS.PRODUCT_SEARCH]: {
                threshold: 1000,
                warningThreshold: 500,
                criticalThreshold: 800,
                unit: 'ms'
            },
            [SLA_METRICS.CATALOG_UPDATE]: {
                threshold: 2000,
                warningThreshold: 1000,
                criticalThreshold: 1500,
                unit: 'ms'
            }
        };

        try {
            const [config] = await db.query(
                'SELECT * FROM sla_config WHERE active = 1'
            );

            if (config.length > 0) {
                for (const row of config) {
                    this.thresholdConfig.set(row.metric_name, {
                        threshold: row.threshold,
                        warningThreshold: row.warning_threshold,
                        criticalThreshold: row.critical_threshold,
                        unit: row.unit || 'ms'
                    });
                }
            } else {
                // Use default config
                for (const [key, value] of Object.entries(defaultConfig)) {
                    this.thresholdConfig.set(key, value);
                    await this.saveSLAConfig(key, value);
                }
            }

            console.log(`📋 Loaded ${this.thresholdConfig.size} SLA configurations`);
        } catch (error) {
            console.error('Load SLA config error:', error);
            // Use defaults
            for (const [key, value] of Object.entries(defaultConfig)) {
                this.thresholdConfig.set(key, value);
            }
        }
    }

    /**
     * Save SLA configuration
     */
    async saveSLAConfig(metric, config) {
        try {
            await db.query(
                `INSERT INTO sla_config 
                 (metric_name, threshold, warning_threshold, critical_threshold, unit, active, updated_at)
                 VALUES (?, ?, ?, ?, ?, 1, NOW())
                 ON DUPLICATE KEY UPDATE
                 threshold = VALUES(threshold),
                 warning_threshold = VALUES(warning_threshold),
                 critical_threshold = VALUES(critical_threshold),
                 unit = VALUES(unit),
                 updated_at = VALUES(updated_at)`,
                [
                    metric,
                    config.threshold,
                    config.warningThreshold,
                    config.criticalThreshold,
                    config.unit || 'ms'
                ]
            );
        } catch (error) {
            console.error('Save SLA config error:', error);
        }
    }

    /**
     * Start SLA measurement
     */
    startMeasurement(metric, metadata = {}) {
        const measurement = {
            id: this.generateMeasurementId(),
            metric,
            metadata,
            startTime: Date.now(),
            endTime: null,
            duration: null,
            status: 'pending',
            severity: null,
            timestamp: new Date().toISOString()
        };

        this.activeTimers.set(measurement.id, measurement);
        return measurement.id;
    }

    /**
     * End SLA measurement
     */
    async endMeasurement(measurementId, result = null) {
        const measurement = this.activeTimers.get(measurementId);
        if (!measurement) {
            console.warn(`Measurement not found: ${measurementId}`);
            return null;
        }

        measurement.endTime = Date.now();
        measurement.duration = measurement.endTime - measurement.startTime;
        measurement.result = result;
        measurement.status = 'completed';

        // Evaluate SLA
        measurement.severity = this.evaluateSLA(measurement.metric, measurement.duration);

        // Store in history
        this.slaHistory.push(measurement);

        // Store in database
        await this.storeSLAEntry(measurement);

        // Emit events
        this.emit('sla.measured', measurement);

        if (measurement.severity === SLA_SEVERITY.CRITICAL || 
            measurement.severity === SLA_SEVERITY.FAILURE) {
            this.emit('sla.alert', measurement);
            await this.createAlert(measurement);
        }

        // Clean up
        this.activeTimers.delete(measurementId);

        return measurement;
    }

    /**
     * Evaluate SLA against thresholds
     */
    evaluateSLA(metric, duration) {
        const config = this.thresholdConfig.get(metric);
        if (!config) {
            return SLA_SEVERITY.PASS;
        }

        if (duration > config.threshold) {
            return SLA_SEVERITY.FAILURE;
        } else if (duration > config.criticalThreshold) {
            return SLA_SEVERITY.CRITICAL;
        } else if (duration > config.warningThreshold) {
            return SLA_SEVERITY.WARNING;
        }

        return SLA_SEVERITY.PASS;
    }

    /**
     * Create SLA alert
     */
    async createAlert(measurement) {
        const alert = {
            id: this.generateAlertId(),
            metric: measurement.metric,
            duration: measurement.duration,
            severity: measurement.severity,
            metadata: measurement.metadata,
            threshold: this.thresholdConfig.get(measurement.metric),
            timestamp: new Date().toISOString(),
            resolved: false
        };

        this.alertHistory.push(alert);
        await this.storeAlert(alert);

        console.error(`🚨 SLA Alert: ${measurement.metric} - ${measurement.duration}ms (${measurement.severity})`);
    }

    /**
     * Get SLA metrics summary
     */
    async getMetricsSummary(metric = null, period = 'DAY') {
        const VALID_PERIODS = ['HOUR', 'DAY', 'WEEK', 'MONTH'];
        const safePeriod = VALID_PERIODS.includes(period?.toUpperCase()) ? period.toUpperCase() : 'DAY';

        const query = `
            SELECT 
                metric,
                COUNT(*) as total_measurements,
                AVG(duration) as avg_duration,
                MIN(duration) as min_duration,
                MAX(duration) as max_duration,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration) as p50,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration) as p95,
                PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration) as p99,
                SUM(CASE WHEN severity = 'pass' THEN 1 ELSE 0 END) as passed,
                SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warnings,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as criticals,
                SUM(CASE WHEN severity = 'failure' THEN 1 ELSE 0 END) as failures
            FROM sla_measurements
            WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 ${safePeriod})
            ${metric ? 'AND metric = ?' : ''}
            GROUP BY metric
        `;

        const params = metric ? [metric] : [];
        const [rows] = await db.query(query, params);

        return rows.map(row => ({
            ...row,
            passRate: row.total_measurements > 0 
                ? (row.passed / row.total_measurements * 100).toFixed(2) + '%'
                : '0%',
            severity: this.getOverallSeverity(row.failures, row.total_measurements)
        }));
    }

    /**
     * Get overall severity based on failures
     */
    getOverallSeverity(failures, total) {
        const failureRate = total > 0 ? failures / total : 0;
        if (failureRate > 0.10) return SLA_SEVERITY.FAILURE;
        if (failureRate > 0.05) return SLA_SEVERITY.CRITICAL;
        if (failureRate > 0.02) return SLA_SEVERITY.WARNING;
        return SLA_SEVERITY.PASS;
    }

    /**
     * Get SLA alerts
     */
    getAlerts(resolved = false, limit = 50) {
        return this.alertHistory
            .filter(a => a.resolved === resolved)
            .slice(-limit);
    }

    /**
     * Resolve SLA alert
     */
    async resolveAlert(alertId, resolution) {
        const alert = this.alertHistory.find(a => a.id === alertId);
        if (!alert) {
            throw new Error(`Alert not found: ${alertId}`);
        }

        alert.resolved = true;
        alert.resolvedAt = new Date().toISOString();
        alert.resolution = resolution;

        await db.query(
            `UPDATE sla_alerts 
             SET resolved = 1, resolved_at = NOW(), resolution = ?
             WHERE alert_id = ?`,
            [resolution, alertId]
        );

        this.emit('alert.resolved', alert);
        return alert;
    }

    /**
     * Get SLA statistics
     */
    async getStatistics() {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_measurements,
                COUNT(DISTINCT metric) as metrics_count,
                AVG(duration) as avg_duration,
                MIN(duration) as min_duration,
                MAX(duration) as max_duration,
                SUM(CASE WHEN severity = 'failure' THEN 1 ELSE 0 END) as total_failures,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as total_critical
             FROM sla_measurements
             WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
        );

        return {
            ...stats[0],
            activeAlerts: this.alertHistory.filter(a => !a.resolved).length,
            activeMeasurements: this.activeTimers.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get SLA health status
     */
    getHealthStatus() {
        const recentAlerts = this.alertHistory.filter(a => !a.resolved);
        const criticalAlerts = recentAlerts.filter(a => a.severity === SLA_SEVERITY.CRITICAL || 
                                                       a.severity === SLA_SEVERITY.FAILURE);

        if (criticalAlerts.length > 5) {
            return { status: 'critical', message: `${criticalAlerts.length} critical alerts` };
        } else if (recentAlerts.length > 10) {
            return { status: 'degraded', message: `${recentAlerts.length} pending alerts` };
        } else if (recentAlerts.length > 0) {
            return { status: 'warning', message: `${recentAlerts.length} alerts pending` };
        }

        return { status: 'healthy', message: 'All SLA metrics within thresholds' };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateMeasurementId() {
        return `SLA_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    generateAlertId() {
        return `ALERT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadHistoricalData() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM sla_measurements 
                 ORDER BY timestamp DESC 
                 LIMIT 1000`
            );

            for (const row of rows) {
                this.slaHistory.push({
                    id: row.measurement_id,
                    metric: row.metric,
                    duration: row.duration,
                    severity: row.severity,
                    metadata: JSON.parse(row.metadata || '{}'),
                    timestamp: row.timestamp
                });
            }

            const [alerts] = await db.query(
                `SELECT * FROM sla_alerts ORDER BY timestamp DESC LIMIT 100`
            );

            for (const row of alerts) {
                this.alertHistory.push({
                    id: row.alert_id,
                    metric: row.metric,
                    duration: row.duration,
                    severity: row.severity,
                    metadata: JSON.parse(row.metadata || '{}'),
                    threshold: JSON.parse(row.threshold || '{}'),
                    timestamp: row.timestamp,
                    resolved: row.resolved === 1,
                    resolvedAt: row.resolved_at,
                    resolution: row.resolution
                });
            }

            console.log(`📊 Loaded ${rows.length} measurements and ${alerts.length} alerts`);
        } catch (error) {
            console.error('Load historical data error:', error);
        }
    }

    async storeSLAEntry(measurement) {
        try {
            await db.query(
                `INSERT INTO sla_measurements 
                 (measurement_id, metric, duration, severity, metadata, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    measurement.id,
                    measurement.metric,
                    measurement.duration,
                    measurement.severity,
                    JSON.stringify(measurement.metadata),
                    measurement.timestamp
                ]
            );
        } catch (error) {
            console.error('Store SLA entry error:', error);
        }
    }

    async storeAlert(alert) {
        try {
            await db.query(
                `INSERT INTO sla_alerts 
                 (alert_id, metric, duration, severity, metadata, threshold, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    alert.id,
                    alert.metric,
                    alert.duration,
                    alert.severity,
                    JSON.stringify(alert.metadata),
                    JSON.stringify(alert.threshold),
                    alert.timestamp
                ]
            );
        } catch (error) {
            console.error('Store alert error:', error);
        }
    }

    // ============================================
    // STATUS
    // ============================================

    getStatus() {
        return {
            initialized: this.isInitialized,
            metrics: this.thresholdConfig.size,
            activeMeasurements: this.activeTimers.size,
            historyCount: this.slaHistory.length,
            alertCount: this.alertHistory.length,
            pendingAlerts: this.alertHistory.filter(a => !a.resolved).length
        };
    }
}

// ============================================
// SLA MONITORING MIDDLEWARE
// ============================================

/**
 * Middleware to monitor SLA for operations
 */
function monitorSLA(metric, metadataExtractor = null) {
    return async (req, res, next) => {
        const slaService = require('./businessSLAService').slaService;
        const measurementId = slaService.startMeasurement(metric, {
            path: req.path,
            method: req.method,
            userId: req.user?.id,
            ...(metadataExtractor ? metadataExtractor(req) : {})
        });

        // Store measurement ID in request
        req._slaMeasurementId = measurementId;

        // Override end to capture measurement
        const originalEnd = res.end;
        res.end = function(...args) {
            const result = {
                statusCode: res.statusCode,
                success: res.statusCode >= 200 && res.statusCode < 300
            };

            slaService.endMeasurement(measurementId, result);
            originalEnd.apply(this, args);
        };

        next();
    };
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    BusinessSLAService,
    SLA_METRICS,
    SLA_SEVERITY,
    monitorSLA,
    slaService: new BusinessSLAService()
};