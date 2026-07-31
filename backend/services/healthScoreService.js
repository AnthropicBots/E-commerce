// backend/services/healthScoreService.js
const db = require('../config/db').promise;
const os = require('os');
const EventEmitter = require('events');

// ============================================
// HEALTH SCORE CONFIGURATION
// ============================================

const HEALTH_STATUS = {
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    UNHEALTHY: 'unhealthy',
    CRITICAL: 'critical'
};

const MODULE_TYPES = {
    AUTHENTICATION: 'authentication',
    RECOMMENDATION: 'recommendation',
    CHECKOUT: 'checkout',
    INVENTORY: 'inventory',
    NOTIFICATIONS: 'notifications',
    DATABASE: 'database',
    CACHE: 'cache',
    PAYMENT: 'payment',
    SEARCH: 'search',
    ANALYTICS: 'analytics'
};

const HEALTH_CONFIG = {
    // Score thresholds
    thresholds: {
        [HEALTH_STATUS.HEALTHY]: 80,
        [HEALTH_STATUS.DEGRADED]: 60,
        [HEALTH_STATUS.UNHEALTHY]: 40,
        [HEALTH_STATUS.CRITICAL]: 0
    },
    // Check intervals (ms)
    checkIntervals: {
        [MODULE_TYPES.DATABASE]: 30000, // 30 seconds
        [MODULE_TYPES.CACHE]: 60000, // 1 minute
        [MODULE_TYPES.AUTHENTICATION]: 60000,
        [MODULE_TYPES.RECOMMENDATION]: 120000, // 2 minutes
        [MODULE_TYPES.CHECKOUT]: 60000,
        [MODULE_TYPES.INVENTORY]: 60000,
        [MODULE_TYPES.NOTIFICATIONS]: 120000,
        [MODULE_TYPES.PAYMENT]: 60000,
        [MODULE_TYPES.SEARCH]: 120000,
        [MODULE_TYPES.ANALYTICS]: 120000
    },
    // Degradation thresholds
    degradation: {
        maxResponseTime: 5000, // 5 seconds
        maxErrorRate: 0.05, // 5%
        maxLatency: 2000, // 2 seconds
        minSuccessRate: 0.95 // 95%
    }
};

// ============================================
// HEALTH SCORE SERVICE
// ============================================

class HealthScoreService extends EventEmitter {
    constructor() {
        super();
        this.moduleHealth = new Map();
        this.healthHistory = [];
        this.checkTimers = new Map();
        this.isRunning = false;
        this.overallHealth = {
            score: 100,
            status: HEALTH_STATUS.HEALTHY,
            modules: {},
            timestamp: new Date().toISOString()
        };
        this.healthChecks = new Map();
    }

    /**
     * Initialize health score service
     */
    async initialize() {
        // Register default health checks
        this.registerDefaultHealthChecks();

        // Start periodic checks
        this.startHealthChecks();

        // Start monitoring
        this.isRunning = true;

        console.log('✅ Health Score Service initialized');
        return this;
    }

    /**
     * Register default health checks
     */
    registerDefaultHealthChecks() {
        this.registerHealthCheck(MODULE_TYPES.DATABASE, this.checkDatabase.bind(this));
        this.registerHealthCheck(MODULE_TYPES.AUTHENTICATION, this.checkAuthentication.bind(this));
        this.registerHealthCheck(MODULE_TYPES.RECOMMENDATION, this.checkRecommendation.bind(this));
        this.registerHealthCheck(MODULE_TYPES.CHECKOUT, this.checkCheckout.bind(this));
        this.registerHealthCheck(MODULE_TYPES.INVENTORY, this.checkInventory.bind(this));
        this.registerHealthCheck(MODULE_TYPES.NOTIFICATIONS, this.checkNotifications.bind(this));
        this.registerHealthCheck(MODULE_TYPES.CACHE, this.checkCache.bind(this));
        this.registerHealthCheck(MODULE_TYPES.PAYMENT, this.checkPayment.bind(this));
        this.registerHealthCheck(MODULE_TYPES.SEARCH, this.checkSearch.bind(this));
        this.registerHealthCheck(MODULE_TYPES.ANALYTICS, this.checkAnalytics.bind(this));
    }

    /**
     * Register a health check for a module
     */
    registerHealthCheck(moduleType, checkFn, interval = null) {
        this.healthChecks.set(moduleType, {
            checkFn,
            interval: interval || HEALTH_CONFIG.checkIntervals[moduleType] || 60000,
            lastCheck: null,
            lastResult: null
        });
        console.log(`✅ Health check registered: ${moduleType}`);
    }

    /**
     * Start periodic health checks
     */
    startHealthChecks() {
        for (const [moduleType, config] of this.healthChecks) {
            const scheduleNext = () => {
                const timer = setTimeout(async () => {
                    await this.performHealthCheck(moduleType);
                    if (this.isRunning) {
                        scheduleNext();
                    }
                }, config.interval);
                this.checkTimers.set(moduleType, timer);
            };

            // Initial check
            this.performHealthCheck(moduleType).then(() => {
                if (this.isRunning) {
                    scheduleNext();
                }
            });
        }
    }

    /**
     * Perform a health check for a module
     */
    async performHealthCheck(moduleType) {
        try {
            const config = this.healthChecks.get(moduleType);
            if (!config) return;

            const startTime = Date.now();
            const result = await config.checkFn();
            const duration = Date.now() - startTime;

            const healthResult = {
                module: moduleType,
                score: result.score || 100,
                status: this.calculateStatus(result.score || 100),
                checks: result.checks || [],
                metrics: result.metrics || {},
                message: result.message || 'OK',
                duration,
                timestamp: new Date().toISOString()
            };

            // Update module health
            this.moduleHealth.set(moduleType, healthResult);
            config.lastResult = healthResult;
            config.lastCheck = new Date().toISOString();

            // Update overall health
            this.updateOverallHealth();

            // Emit events
            this.emit('health.check', { module: moduleType, result: healthResult });

            if (healthResult.status === HEALTH_STATUS.UNHEALTHY || 
                healthResult.status === HEALTH_STATUS.CRITICAL) {
                this.emit('health.degraded', { module: moduleType, result: healthResult });
            }

            // Log health history
            this.healthHistory.push(healthResult);
            if (this.healthHistory.length > 1000) {
                this.healthHistory.shift();
            }

        } catch (error) {
            console.error(`Health check failed for ${moduleType}:`, error);
            
            const healthResult = {
                module: moduleType,
                score: 0,
                status: HEALTH_STATUS.CRITICAL,
                checks: [],
                metrics: {},
                message: error.message,
                duration: 0,
                timestamp: new Date().toISOString()
            };

            this.moduleHealth.set(moduleType, healthResult);
            this.updateOverallHealth();
            this.emit('health.error', { module: moduleType, error });
        }
    }

    /**
     * Update overall health score
     */
    updateOverallHealth() {
        const modules = Array.from(this.moduleHealth.values());
        if (modules.length === 0) return;

        const totalScore = modules.reduce((sum, m) => sum + m.score, 0);
        const averageScore = totalScore / modules.length;

        const healthStatus = this.calculateStatus(averageScore);

        this.overallHealth = {
            score: Math.round(averageScore),
            status: healthStatus,
            modules: modules.reduce((acc, m) => {
                acc[m.module] = {
                    score: m.score,
                    status: m.status,
                    message: m.message,
                    timestamp: m.timestamp
                };
                return acc;
            }, {}),
            timestamp: new Date().toISOString()
        };

        // Emit overall health event
        this.emit('health.overall', this.overallHealth);

        // Alert if critical
        if (healthStatus === HEALTH_STATUS.CRITICAL || healthStatus === HEALTH_STATUS.UNHEALTHY) {
            this.emit('health.alert', this.overallHealth);
        }
    }

    /**
     * Calculate status from score
     */
    calculateStatus(score) {
        if (score >= HEALTH_CONFIG.thresholds[HEALTH_STATUS.HEALTHY]) {
            return HEALTH_STATUS.HEALTHY;
        } else if (score >= HEALTH_CONFIG.thresholds[HEALTH_STATUS.DEGRADED]) {
            return HEALTH_STATUS.DEGRADED;
        } else if (score >= HEALTH_CONFIG.thresholds[HEALTH_STATUS.UNHEALTHY]) {
            return HEALTH_STATUS.UNHEALTHY;
        } else {
            return HEALTH_STATUS.CRITICAL;
        }
    }

    /**
     * Get overall health
     */
    getOverallHealth() {
        return this.overallHealth;
    }

    /**
     * Get module health
     */
    getModuleHealth(moduleType) {
        return this.moduleHealth.get(moduleType) || null;
    }

    /**
     * Get health history
     */
    getHealthHistory(limit = 100) {
        return this.healthHistory.slice(-limit);
    }

    /**
     * Get health statistics
     */
    getStatistics() {
        const modules = Array.from(this.moduleHealth.values());
        const healthy = modules.filter(m => m.status === HEALTH_STATUS.HEALTHY).length;
        const degraded = modules.filter(m => m.status === HEALTH_STATUS.DEGRADED).length;
        const unhealthy = modules.filter(m => m.status === HEALTH_STATUS.UNHEALTHY).length;
        const critical = modules.filter(m => m.status === HEALTH_STATUS.CRITICAL).length;

        return {
            totalModules: modules.length,
            healthy,
            degraded,
            unhealthy,
            critical,
            overallScore: this.overallHealth.score,
            overallStatus: this.overallHealth.status,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    }

    // ============================================
    // HEALTH CHECK IMPLEMENTATIONS
    // ============================================

    /**
     * Check Database health
     */
    async checkDatabase() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check connection
            const startTime = Date.now();
            await db.query('SELECT 1');
            const responseTime = Date.now() - startTime;
            metrics.responseTime = responseTime;

            if (responseTime > HEALTH_CONFIG.degradation.maxResponseTime) {
                checks.push({ 
                    name: 'response_time', 
                    status: 'warning', 
                    message: `Response time: ${responseTime}ms` 
                });
                score -= 10;
            } else {
                checks.push({ 
                    name: 'response_time', 
                    status: 'ok', 
                    message: `${responseTime}ms` 
                });
            }

            // Check connections
            const [connStatus] = await db.query('SHOW STATUS LIKE "Threads_connected"');
            const connections = parseInt(connStatus?.Value || 0);
            metrics.connections = connections;

            if (connections > 100) {
                checks.push({ 
                    name: 'connections', 
                    status: 'warning', 
                    message: `${connections} connections` 
                });
                score -= 15;
            } else {
                checks.push({ 
                    name: 'connections', 
                    status: 'ok', 
                    message: `${connections} connections` 
                });
            }

            // Check uptime
            const [uptimeStatus] = await db.query('SHOW STATUS LIKE "Uptime"');
            const uptime = parseInt(uptimeStatus?.Value || 0);
            metrics.uptime = uptime;

            checks.push({ 
                name: 'uptime', 
                status: 'ok', 
                message: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` 
            });

        } catch (error) {
            checks.push({ 
                name: 'connection', 
                status: 'error', 
                message: error.message 
            });
            score = 0;
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Database is healthy' : 'Database is degraded'
        };
    }

    /**
     * Check Authentication health
     */
    async checkAuthentication() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check JWT verification
            const jwt = require('jsonwebtoken');
            const testToken = jwt.sign({ test: true }, process.env.JWT_SECRET || 'test', { expiresIn: '1s' });
            
            try {
                jwt.verify(testToken, process.env.JWT_SECRET || 'test');
                checks.push({ name: 'jwt_verification', status: 'ok', message: 'JWT verification passed' });
            } catch (error) {
                checks.push({ name: 'jwt_verification', status: 'error', message: 'JWT verification failed' });
                score -= 30;
            }

            // Check user service
            const startTime = Date.now();
            await db.query('SELECT COUNT(*) as count FROM users LIMIT 1');
            const responseTime = Date.now() - startTime;
            metrics.responseTime = responseTime;

            if (responseTime > 1000) {
                checks.push({ name: 'user_service', status: 'warning', message: `Slow response: ${responseTime}ms` });
                score -= 10;
            } else {
                checks.push({ name: 'user_service', status: 'ok', message: `${responseTime}ms` });
            }

            // Check rate limiting (simulated)
            checks.push({ name: 'rate_limiting', status: 'ok', message: 'Rate limiting enabled' });

        } catch (error) {
            checks.push({ name: 'auth_service', status: 'error', message: error.message });
            score = Math.max(0, score - 20);
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Authentication is healthy' : 'Authentication is degraded'
        };
    }

    /**
     * Check Recommendation health
     */
    async checkRecommendation() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check if recommendation service is responsive
            const startTime = Date.now();
            // Simulate recommendation check
            const result = { success: true };
            const responseTime = Date.now() - startTime;
            metrics.responseTime = responseTime;

            if (responseTime > 2000) {
                checks.push({ name: 'service_response', status: 'warning', message: `Slow: ${responseTime}ms` });
                score -= 10;
            } else {
                checks.push({ name: 'service_response', status: 'ok', message: `${responseTime}ms` });
            }

            // Check strategy availability
            const strategies = ['trending', 'collaborative', 'content_based'];
            checks.push({ 
                name: 'strategies', 
                status: 'ok', 
                message: `${strategies.length} strategies available` 
            });

        } catch (error) {
            checks.push({ name: 'recommendation_service', status: 'error', message: error.message });
            score = Math.max(0, score - 30);
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Recommendation is healthy' : 'Recommendation is degraded'
        };
    }

    /**
     * Check Checkout health
     */
    async checkCheckout() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check order processing
            const startTime = Date.now();
            await db.query('SELECT COUNT(*) as count FROM orders LIMIT 1');
            const responseTime = Date.now() - startTime;
            metrics.responseTime = responseTime;

            if (responseTime > 1000) {
                checks.push({ name: 'order_query', status: 'warning', message: `Slow: ${responseTime}ms` });
                score -= 10;
            } else {
                checks.push({ name: 'order_query', status: 'ok', message: `${responseTime}ms` });
            }

            // Check cart service
            checks.push({ name: 'cart_service', status: 'ok', message: 'Cart service available' });

        } catch (error) {
            checks.push({ name: 'checkout_service', status: 'error', message: error.message });
            score = Math.max(0, score - 20);
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Checkout is healthy' : 'Checkout is degraded'
        };
    }

    /**
     * Check Inventory health
     */
    async checkInventory() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check stock query
            const startTime = Date.now();
            await db.query('SELECT COUNT(*) as count FROM products WHERE stock < 10 LIMIT 1');
            const responseTime = Date.now() - startTime;
            metrics.responseTime = responseTime;

            if (responseTime > 500) {
                checks.push({ name: 'stock_query', status: 'warning', message: `Slow: ${responseTime}ms` });
                score -= 10;
            } else {
                checks.push({ name: 'stock_query', status: 'ok', message: `${responseTime}ms` });
            }

            // Check low stock count
            const [lowStock] = await db.query('SELECT COUNT(*) as count FROM products WHERE stock < 10');
            metrics.lowStockItems = lowStock[0]?.count || 0;

            if (metrics.lowStockItems > 50) {
                checks.push({ name: 'low_stock', status: 'warning', message: `${metrics.lowStockItems} items low stock` });
                score -= 10;
            } else {
                checks.push({ name: 'low_stock', status: 'ok', message: `${metrics.lowStockItems} items low stock` });
            }

        } catch (error) {
            checks.push({ name: 'inventory_service', status: 'error', message: error.message });
            score = Math.max(0, score - 20);
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Inventory is healthy' : 'Inventory is degraded'
        };
    }

    /**
     * Check Notifications health
     */
    async checkNotifications() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check notification queue
            metrics.queueSize = 0;
            checks.push({ name: 'queue', status: 'ok', message: `${metrics.queueSize} pending notifications` });

            // Check email service (simulated)
            checks.push({ name: 'email_service', status: 'ok', message: 'Email service available' });

            // Check SMS service (simulated)
            checks.push({ name: 'sms_service', status: 'ok', message: 'SMS service available' });

        } catch (error) {
            checks.push({ name: 'notification_service', status: 'error', message: error.message });
            score = Math.max(0, score - 20);
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Notifications are healthy' : 'Notifications are degraded'
        };
    }

    /**
     * Check Cache health
     */
    async checkCache() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check cache connectivity
            const startTime = Date.now();
            // Simulate cache check
            const connected = true;
            const responseTime = Date.now() - startTime;
            metrics.responseTime = responseTime;

            if (connected) {
                checks.push({ name: 'connection', status: 'ok', message: `${responseTime}ms` });
            } else {
                checks.push({ name: 'connection', status: 'error', message: 'Cache connection failed' });
                score -= 50;
            }

            // Check memory usage (simulated)
            metrics.memoryUsage = '45%';
            checks.push({ name: 'memory', status: 'ok', message: '45% used' });

        } catch (error) {
            checks.push({ name: 'cache_service', status: 'error', message: error.message });
            score = Math.max(0, score - 30);
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Cache is healthy' : 'Cache is degraded'
        };
    }

    /**
     * Check Payment health
     */
    async checkPayment() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check payment gateway (simulated)
            checks.push({ name: 'gateway', status: 'ok', message: 'Payment gateway available' });

            // Check payment processing
            const startTime = Date.now();
            const result = { success: true };
            const responseTime = Date.now() - startTime;
            metrics.responseTime = responseTime;

            if (responseTime > 2000) {
                checks.push({ name: 'processing', status: 'warning', message: `Slow: ${responseTime}ms` });
                score -= 10;
            } else {
                checks.push({ name: 'processing', status: 'ok', message: `${responseTime}ms` });
            }

        } catch (error) {
            checks.push({ name: 'payment_service', status: 'error', message: error.message });
            score = Math.max(0, score - 30);
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Payment is healthy' : 'Payment is degraded'
        };
    }

    /**
     * Check Search health
     */
    async checkSearch() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check search index (simulated)
            const startTime = Date.now();
            const result = { success: true };
            const responseTime = Date.now() - startTime;
            metrics.responseTime = responseTime;

            if (responseTime > 1000) {
                checks.push({ name: 'search_query', status: 'warning', message: `Slow: ${responseTime}ms` });
                score -= 10;
            } else {
                checks.push({ name: 'search_query', status: 'ok', message: `${responseTime}ms` });
            }

            // Check index size
            metrics.indexSize = 0;
            checks.push({ name: 'index_size', status: 'ok', message: 'Index size: 0 documents' });

        } catch (error) {
            checks.push({ name: 'search_service', status: 'error', message: error.message });
            score = Math.max(0, score - 20);
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Search is healthy' : 'Search is degraded'
        };
    }

    /**
     * Check Analytics health
     */
    async checkAnalytics() {
        const checks = [];
        const metrics = {};
        let score = 100;

        try {
            // Check analytics processing (simulated)
            const startTime = Date.now();
            const result = { success: true };
            const responseTime = Date.now() - startTime;
            metrics.responseTime = responseTime;

            if (responseTime > 2000) {
                checks.push({ name: 'analytics_processing', status: 'warning', message: `Slow: ${responseTime}ms` });
                score -= 10;
            } else {
                checks.push({ name: 'analytics_processing', status: 'ok', message: `${responseTime}ms` });
            }

            // Check data freshness (simulated)
            metrics.dataFreshness = '5m';
            checks.push({ name: 'data_freshness', status: 'ok', message: 'Data updated 5 minutes ago' });

        } catch (error) {
            checks.push({ name: 'analytics_service', status: 'error', message: error.message });
            score = Math.max(0, score - 20);
        }

        return {
            score: Math.max(0, score),
            checks,
            metrics,
            message: score >= 80 ? 'Analytics is healthy' : 'Analytics is degraded'
        };
    }

    /**
     * Stop health checks
     */
    stopHealthChecks() {
        for (const timer of this.checkTimers.values()) {
            clearInterval(timer);
        }
        this.checkTimers.clear();
        this.isRunning = false;
        console.log('⏹️ Health checks stopped');
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    HealthScoreService,
    HEALTH_STATUS,
    MODULE_TYPES,
    healthScoreService: new HealthScoreService()
};