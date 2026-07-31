// backend/services/fallbackManagerService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// FALLBACK CONFIGURATION
// ============================================

const SERVICE_TYPES = {
    RECOMMENDATIONS: 'recommendations',
    SEARCH: 'search',
    PROMOTIONS: 'promotions',
    ANALYTICS: 'analytics',
    NOTIFICATIONS: 'notifications',
    INVENTORY: 'inventory',
    AI_SERVICES: 'ai_services',
    PAYMENT: 'payment'
};

const DEGRADATION_LEVELS = {
    NORMAL: 'normal',
    DEGRADED: 'degraded',
    FALLBACK: 'fallback',
    MINIMAL: 'minimal',
    OFFLINE: 'offline'
};

const FALLBACK_STRATEGIES = {
    CACHE: 'cache',
    SECONDARY_SOURCE: 'secondary_source',
    DEFAULT_RESPONSE: 'default_response',
    QUEUE: 'queue',
    RETRY: 'retry',
    CIRCUIT_BREAKER: 'circuit_breaker'
};

// ============================================
// FALLBACK MANAGER SERVICE
// ============================================

class FallbackManagerService extends EventEmitter {
    constructor() {
        super();
        this.fallbackPolicies = new Map();
        this.serviceHealth = new Map();
        this.degradationHistory = [];
        this.circuitBreakers = new Map();
        this.retryQueues = new Map();
        this.fallbackCache = new Map();
        this.isInitialized = false;
        this.policiesPath = path.join(__dirname, '../config/fallbackPolicies.json');
    }

    /**
     * Initialize fallback manager
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load policies from file
        await this.loadPolicies();

        // Set default health status
        this.initializeServiceHealth();

        // Start health monitoring
        this.startHealthMonitoring();

        this.isInitialized = true;
        console.log('✅ Fallback Manager Service initialized');
        return this;
    }

    /**
     * Load fallback policies
     */
    async loadPolicies() {
        try {
            if (fs.existsSync(this.policiesPath)) {
                const content = fs.readFileSync(this.policiesPath, 'utf8');
                const policies = JSON.parse(content);
                
                for (const [service, policy] of Object.entries(policies)) {
                    this.fallbackPolicies.set(service, policy);
                }
                
                console.log(`📋 Loaded ${this.fallbackPolicies.size} fallback policies`);
            } else {
                // Create default policies
                await this.createDefaultPolicies();
            }
        } catch (error) {
            console.error('Load policies error:', error);
            await this.createDefaultPolicies();
        }
    }

    /**
     * Create default fallback policies
     */
    async createDefaultPolicies() {
        const defaultPolicies = {
            [SERVICE_TYPES.RECOMMENDATIONS]: {
                primary: 'recommendation-service',
                secondary: 'cache',
                fallback: 'trending-products',
                defaultResponse: [],
                strategies: [FALLBACK_STRATEGIES.CACHE, FALLBACK_STRATEGIES.SECONDARY_SOURCE],
                timeout: 3000,
                retryAttempts: 2,
                cacheTTL: 300,
                degradationLevel: DEGRADATION_LEVELS.DEGRADED
            },
            [SERVICE_TYPES.SEARCH]: {
                primary: 'search-service',
                secondary: 'database',
                fallback: 'category-products',
                defaultResponse: [],
                strategies: [FALLBACK_STRATEGIES.CACHE, FALLBACK_STRATEGIES.DEFAULT_RESPONSE],
                timeout: 2000,
                retryAttempts: 1,
                cacheTTL: 600,
                degradationLevel: DEGRADATION_LEVELS.DEGRADED
            },
            [SERVICE_TYPES.PROMOTIONS]: {
                primary: 'promotion-service',
                secondary: 'cache',
                fallback: 'default-promotions',
                defaultResponse: [],
                strategies: [FALLBACK_STRATEGIES.CACHE],
                timeout: 2000,
                retryAttempts: 1,
                cacheTTL: 600,
                degradationLevel: DEGRADATION_LEVELS.FALLBACK
            },
            [SERVICE_TYPES.ANALYTICS]: {
                primary: 'analytics-service',
                secondary: 'queue',
                fallback: 'local-log',
                defaultResponse: { queued: true },
                strategies: [FALLBACK_STRATEGIES.QUEUE, FALLBACK_STRATEGIES.RETRY],
                timeout: 1000,
                retryAttempts: 3,
                cacheTTL: 0,
                degradationLevel: DEGRADATION_LEVELS.MINIMAL
            },
            [SERVICE_TYPES.NOTIFICATIONS]: {
                primary: 'notification-service',
                secondary: 'queue',
                fallback: 'log-only',
                defaultResponse: { queued: true },
                strategies: [FALLBACK_STRATEGIES.QUEUE, FALLBACK_STRATEGIES.RETRY],
                timeout: 3000,
                retryAttempts: 3,
                cacheTTL: 0,
                degradationLevel: DEGRADATION_LEVELS.MINIMAL
            },
            [SERVICE_TYPES.INVENTORY]: {
                primary: 'inventory-service',
                secondary: 'cache',
                fallback: 'stock-default',
                defaultResponse: { stock: 10 },
                strategies: [FALLBACK_STRATEGIES.CACHE, FALLBACK_STRATEGIES.DEFAULT_RESPONSE],
                timeout: 1000,
                retryAttempts: 1,
                cacheTTL: 60,
                degradationLevel: DEGRADATION_LEVELS.DEGRADED
            },
            [SERVICE_TYPES.AI_SERVICES]: {
                primary: 'ai-service',
                secondary: 'cache',
                fallback: 'rule-based',
                defaultResponse: { fallback: true },
                strategies: [FALLBACK_STRATEGIES.CACHE, FALLBACK_STRATEGIES.FALLBACK],
                timeout: 5000,
                retryAttempts: 1,
                cacheTTL: 600,
                degradationLevel: DEGRADATION_LEVELS.FALLBACK
            },
            [SERVICE_TYPES.PAYMENT]: {
                primary: 'payment-service',
                secondary: 'secondary-payment',
                fallback: 'payment-fallback',
                defaultResponse: { error: 'Payment service unavailable' },
                strategies: [FALLBACK_STRATEGIES.CIRCUIT_BREAKER, FALLBACK_STRATEGIES.RETRY],
                timeout: 5000,
                retryAttempts: 2,
                cacheTTL: 0,
                degradationLevel: DEGRADATION_LEVELS.OFFLINE
            }
        };

        // Save to file
        fs.writeFileSync(
            this.policiesPath,
            JSON.stringify(defaultPolicies, null, 2)
        );

        for (const [service, policy] of Object.entries(defaultPolicies)) {
            this.fallbackPolicies.set(service, policy);
        }

        console.log('📋 Created default fallback policies');
    }

    /**
     * Initialize service health status
     */
    initializeServiceHealth() {
        for (const [service, policy] of this.fallbackPolicies) {
            this.serviceHealth.set(service, {
                status: 'healthy',
                degradationLevel: DEGRADATION_LEVELS.NORMAL,
                lastCheck: new Date().toISOString(),
                failureCount: 0,
                successCount: 0,
                errorRate: 0,
                responseTime: 0,
                circuitState: 'closed'
            });
        }
    }

    /**
     * Start health monitoring
     */
    startHealthMonitoring() {
        setInterval(() => {
            this.monitorServiceHealth();
        }, 30000); // 30 seconds
    }

    /**
     * Monitor service health
     */
    async monitorServiceHealth() {
        for (const [service, policy] of this.fallbackPolicies) {
            const health = this.serviceHealth.get(service);
            if (!health) continue;

            // Simulate health check (in production, would check actual service)
            const isHealthy = await this.checkServiceHealth(service);
            
            if (isHealthy) {
                health.status = 'healthy';
                health.failureCount = 0;
                health.degradationLevel = DEGRADATION_LEVELS.NORMAL;
            } else {
                health.failureCount++;
                health.status = health.failureCount > 3 ? 'unhealthy' : 'degraded';
                health.degradationLevel = this.getDegradationLevel(health.failureCount, policy);
            }

            health.lastCheck = new Date().toISOString();
            this.serviceHealth.set(service, health);

            // Log degradation
            if (health.degradationLevel !== DEGRADATION_LEVELS.NORMAL) {
                this.degradationHistory.push({
                    service,
                    level: health.degradationLevel,
                    timestamp: new Date().toISOString()
                });

                this.emit('service.degraded', { service, level: health.degradationLevel });
            }
        }
    }

    /**
     * Check service health
     */
    async checkServiceHealth(service) {
        // In production, would make actual health check
        // Simulate: 90% chance of being healthy
        return Math.random() > 0.1;
    }

    /**
     * Get degradation level based on failures
     */
    getDegradationLevel(failureCount, policy) {
        if (failureCount <= 1) return DEGRADATION_LEVELS.DEGRADED;
        if (failureCount <= 3) return DEGRADATION_LEVELS.FALLBACK;
        if (failureCount <= 5) return DEGRADATION_LEVELS.MINIMAL;
        return DEGRADATION_LEVELS.OFFLINE;
    }

    /**
     * Execute a service call with fallback
     */
    async execute(service, fn, context = {}) {
        const policy = this.fallbackPolicies.get(service);
        if (!policy) {
            throw new Error(`No fallback policy for service: ${service}`);
        }

        const health = this.serviceHealth.get(service);
        const startTime = Date.now();

        try {
            // Check if service is healthy
            if (health?.status === 'healthy') {
                try {
                    const result = await this.executeWithTimeout(fn, policy.timeout);
                    return this.wrapResult(result, service, 'primary');
                } catch (error) {
                    console.warn(`⚠️ Service ${service} failed, using fallback:`, error.message);
                    this.recordFailure(service);
                }
            }

            // Use fallback strategies
            return await this.executeFallback(service, policy, context);
        } catch (error) {
            console.error(`❌ All fallbacks failed for ${service}:`, error);
            return this.getDefaultResponse(policy);
        } finally {
            const duration = Date.now() - startTime;
            this.recordMetrics(service, duration);
        }
    }

    /**
     * Execute with timeout
     */
    async executeWithTimeout(fn, timeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Service timeout'));
            }, timeout);

            Promise.resolve(fn()).then(
                result => {
                    clearTimeout(timer);
                    resolve(result);
                },
                error => {
                    clearTimeout(timer);
                    reject(error);
                }
            );
        });
    }

    /**
     * Execute fallback strategies
     */
    async executeFallback(service, policy, context) {
        const health = this.serviceHealth.get(service);
        const strategy = this.selectFallbackStrategy(policy, health);

        switch (strategy) {
            case FALLBACK_STRATEGIES.CACHE:
                return await this.getCachedResponse(service, context);
            case FALLBACK_STRATEGIES.SECONDARY_SOURCE:
                return await this.getSecondarySource(service, policy, context);
            case FALLBACK_STRATEGIES.DEFAULT_RESPONSE:
                return policy.defaultResponse;
            case FALLBACK_STRATEGIES.QUEUE:
                return await this.queueRequest(service, context);
            case FALLBACK_STRATEGIES.RETRY:
                return await this.retryRequest(service, policy, context);
            case FALLBACK_STRATEGIES.CIRCUIT_BREAKER:
                return await this.handleCircuitBreaker(service, policy, context);
            default:
                return policy.defaultResponse;
        }
    }

    /**
     * Select fallback strategy
     */
    selectFallbackStrategy(policy, health) {
        const strategies = policy.strategies || [];
        
        // Check circuit breaker
        if (health?.circuitState === 'open') {
            return FALLBACK_STRATEGIES.CIRCUIT_BREAKER;
        }

        // Return first available strategy
        for (const strategy of strategies) {
            if (this.isStrategyAvailable(strategy)) {
                return strategy;
            }
        }

        return FALLBACK_STRATEGIES.DEFAULT_RESPONSE;
    }

    /**
     * Check if strategy is available
     */
    isStrategyAvailable(strategy) {
        switch (strategy) {
            case FALLBACK_STRATEGIES.CACHE:
                return true;
            case FALLBACK_STRATEGIES.SECONDARY_SOURCE:
                return true;
            case FALLBACK_STRATEGIES.DEFAULT_RESPONSE:
                return true;
            case FALLBACK_STRATEGIES.QUEUE:
                return true;
            case FALLBACK_STRATEGIES.RETRY:
                return true;
            case FALLBACK_STRATEGIES.CIRCUIT_BREAKER:
                return true;
            default:
                return false;
        }
    }

    /**
     * Get cached response
     */
    async getCachedResponse(service, context) {
        const cacheKey = `${service}:${JSON.stringify(context)}`;
        const cached = this.fallbackCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            this.emit('fallback.used', { service, strategy: FALLBACK_STRATEGIES.CACHE });
            return this.wrapResult(cached.data, service, 'cache');
        }
        return null;
    }

    /**
     * Get secondary source
     */
    async getSecondarySource(service, policy, context) {
        // In production, would call secondary service
        this.emit('fallback.used', { service, strategy: FALLBACK_STRATEGIES.SECONDARY_SOURCE });
        return this.wrapResult(policy.defaultResponse, service, 'secondary');
    }

    /**
     * Queue request for later
     */
    async queueRequest(service, context) {
        if (!this.retryQueues.has(service)) {
            this.retryQueues.set(service, []);
        }

        const queue = this.retryQueues.get(service);
        queue.push({
            context,
            timestamp: new Date().toISOString(),
            attempts: 0
        });

        this.emit('fallback.used', { service, strategy: FALLBACK_STRATEGIES.QUEUE });
        return this.wrapResult({ queued: true }, service, 'queue');
    }

    /**
     * Retry request
     */
    async retryRequest(service, policy, context) {
        const maxAttempts = policy.retryAttempts || 2;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const result = await this.executeWithTimeout(
                    () => policy.primary(context),
                    policy.timeout
                );
                return this.wrapResult(result, service, 'retry');
            } catch (error) {
                if (attempt === maxAttempts) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    /**
     * Handle circuit breaker
     */
    async handleCircuitBreaker(service, policy, context) {
        const circuit = this.circuitBreakers.get(service) || {
            state: 'closed',
            failures: 0,
            lastFailure: null,
            timeout: 60000
        };

        if (circuit.state === 'open') {
            if (Date.now() - circuit.lastFailure > circuit.timeout) {
                circuit.state = 'half-open';
                this.circuitBreakers.set(service, circuit);
            } else {
                this.emit('fallback.used', { service, strategy: FALLBACK_STRATEGIES.CIRCUIT_BREAKER });
                return this.wrapResult(policy.defaultResponse, service, 'circuit_breaker');
            }
        }

        try {
            const result = await this.executeWithTimeout(
                () => policy.primary(context),
                policy.timeout
            );
            
            circuit.state = 'closed';
            circuit.failures = 0;
            this.circuitBreakers.set(service, circuit);
            
            return this.wrapResult(result, service, 'primary');
        } catch (error) {
            circuit.failures++;
            circuit.lastFailure = Date.now();
            if (circuit.failures >= 3) {
                circuit.state = 'open';
            }
            this.circuitBreakers.set(service, circuit);
            throw error;
        }
    }

    /**
     * Get default response
     */
    getDefaultResponse(policy) {
        return this.wrapResult(policy.defaultResponse || null, 'fallback', 'default');
    }

    /**
     * Wrap result with metadata
     */
    wrapResult(data, service, source) {
        return {
            data,
            source,
            service,
            fallback: source !== 'primary',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Record failure for service
     */
    recordFailure(service) {
        const health = this.serviceHealth.get(service);
        if (health) {
            health.failureCount++;
            this.serviceHealth.set(service, health);
        }
    }

    /**
     * Record metrics
     */
    recordMetrics(service, duration) {
        const health = this.serviceHealth.get(service);
        if (health) {
            health.responseTime = (health.responseTime + duration) / 2;
            this.serviceHealth.set(service, health);
        }
    }

    /**
     * Get service health status
     */
    getServiceHealth(service) {
        return this.serviceHealth.get(service) || null;
    }

    /**
     * Get degradation status
     */
    getDegradationStatus() {
        const status = {};

        for (const [service, health] of this.serviceHealth) {
            status[service] = {
                level: health.degradationLevel,
                status: health.status,
                failureCount: health.failureCount,
                responseTime: health.responseTime,
                lastCheck: health.lastCheck
            };
        }

        return status;
    }

    /**
     * Get fallback history
     */
    getFallbackHistory(limit = 100) {
        return this.degradationHistory.slice(-limit);
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        return {
            services: this.serviceHealth.size,
            degradedServices: Array.from(this.serviceHealth.values())
                .filter(h => h.degradationLevel !== DEGRADATION_LEVELS.NORMAL).length,
            queueSizes: Array.from(this.retryQueues.entries()).map(([service, queue]) => ({
                service,
                size: queue.length
            })),
            circuitStates: Array.from(this.circuitBreakers.entries()).map(([service, circuit]) => ({
                service,
                state: circuit.state
            })),
            cacheSize: this.fallbackCache.size,
            degradationHistory: this.degradationHistory.slice(-10),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            policies: this.fallbackPolicies.size,
            services: this.serviceHealth.size,
            circuits: this.circuitBreakers.size,
            cacheSize: this.fallbackCache.size
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    FallbackManagerService,
    SERVICE_TYPES,
    DEGRADATION_LEVELS,
    FALLBACK_STRATEGIES,
    fallbackManager: new FallbackManagerService()
};