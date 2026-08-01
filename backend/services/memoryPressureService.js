// backend/services/memoryPressureService.js
const os = require('os');
const v8 = require('v8');
const EventEmitter = require('events');
const db = require('../config/db').promise;

// ============================================
// MEMORY CONFIGURATION
// ============================================

const MEMORY_CONFIG = {
    // Pressure thresholds (percentage of max heap)
    pressureThresholds: {
        LOW: 40,
        MEDIUM: 60,
        HIGH: 75,
        CRITICAL: 85
    },
    
    // GC monitoring
    gcCheckInterval: 5000, // 5 seconds
    gcThreshold: 100, // GC count per minute
    
    // Eviction strategies
    evictionStrategies: {
        LRU: 'lru',
        LFU: 'lfu',
        FIFO: 'fifo',
        ADAPTIVE: 'adaptive'
    },
    
    // Cache adaptation
    adaptationInterval: 30000, // 30 seconds
    maxCacheSize: 100 * 1024 * 1024, // 100MB
    minCacheSize: 10 * 1024 * 1024, // 10MB
    
    // Monitoring
    historySize: 1000,
    alertThreshold: 90 // percentage
};

const PRESSURE_LEVELS = {
    NORMAL: 'normal',
    MODERATE: 'moderate',
    HIGH: 'high',
    CRITICAL: 'critical'
};

// ============================================
// MEMORY PRESSURE SERVICE
// ============================================

class MemoryPressureService extends EventEmitter {
    constructor() {
        super();
        this.metrics = {
            heapUsed: 0,
            heapTotal: 0,
            heapMax: 0,
            external: 0,
            arrayBuffers: 0,
            memoryPressure: 0,
            pressureLevel: PRESSURE_LEVELS.NORMAL,
            gcCount: 0,
            gcTime: 0,
            cacheSize: 0,
            cacheItems: 0
        };
        this.history = [];
        this.pressureEvents = [];
        this.gcIntervals = [];
        this.isMonitoring = false;
        this.caches = new Map();
        this.evictionStrategies = new Map();
        this.lastGC = Date.now();
        this.gcCounter = 0;
    }

    /**
     * Initialize memory pressure monitoring
     */
    async initialize() {
        // Start monitoring
        this.startMonitoring();

        // Load cache configurations
        await this.loadCacheConfigurations();

        console.log('✅ Memory Pressure Service initialized');
        return this;
    }

    /**
     * Start monitoring memory pressure
     */
    startMonitoring() {
        if (this.isMonitoring) return;

        this.isMonitoring = true;

        // Monitor memory usage
        setInterval(() => {
            this.updateMetrics();
        }, MEMORY_CONFIG.gcCheckInterval);

        // Check pressure levels
        setInterval(() => {
            this.checkPressure();
        }, 10000);

        // Adapt caches
        setInterval(() => {
            this.adaptCaches();
        }, MEMORY_CONFIG.adaptationInterval);

        // Monitor GC
        this.monitorGC();

        console.log('📊 Memory monitoring started');
    }

    /**
     * Update memory metrics
     */
    updateMetrics() {
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();

        this.metrics.heapUsed = memUsage.heapUsed;
        this.metrics.heapTotal = memUsage.heapTotal;
        this.metrics.heapMax = heapStats.heap_size_limit || 0;
        this.metrics.external = memUsage.external;
        this.metrics.arrayBuffers = memUsage.arrayBuffers || 0;

        // Calculate memory pressure (percentage of max heap)
        if (this.metrics.heapMax > 0) {
            this.metrics.memoryPressure = (this.metrics.heapUsed / this.metrics.heapMax) * 100;
        } else {
            // Fallback: use total system memory
            const totalMem = os.totalmem();
            this.metrics.memoryPressure = (this.metrics.heapUsed / totalMem) * 100;
        }

        // Update pressure level
        this.metrics.pressureLevel = this.getPressureLevel(this.metrics.memoryPressure);

        // Store history
        this.history.push({
            timestamp: new Date().toISOString(),
            ...this.metrics
        });

        // Keep only recent history
        if (this.history.length > MEMORY_CONFIG.historySize) {
            this.history.shift();
        }

        // Emit metrics update
        this.emit('metrics.updated', this.metrics);
    }

    /**
     * Get pressure level
     */
    getPressureLevel(percentage) {
        const { LOW, MEDIUM, HIGH, CRITICAL } = MEMORY_CONFIG.pressureThresholds;

        if (percentage >= CRITICAL) return PRESSURE_LEVELS.CRITICAL;
        if (percentage >= HIGH) return PRESSURE_LEVELS.HIGH;
        if (percentage >= MEDIUM) return PRESSURE_LEVELS.MODERATE;
        if (percentage >= LOW) return PRESSURE_LEVELS.NORMAL;
        return PRESSURE_LEVELS.NORMAL;
    }

    /**
     * Check pressure level and take action
     */
    checkPressure() {
        const { memoryPressure, pressureLevel } = this.metrics;

        // Log pressure changes
        if (pressureLevel === PRESSURE_LEVELS.CRITICAL) {
            console.warn(`⚠️ Critical memory pressure: ${memoryPressure.toFixed(1)}%`);
            this.emit('pressure.critical', { pressure: memoryPressure, metrics: this.metrics });
        } else if (pressureLevel === PRESSURE_LEVELS.HIGH) {
            console.warn(`⚠️ High memory pressure: ${memoryPressure.toFixed(1)}%`);
            this.emit('pressure.high', { pressure: memoryPressure, metrics: this.metrics });
        } else if (pressureLevel === PRESSURE_LEVELS.MODERATE) {
            console.log(`ℹ️ Moderate memory pressure: ${memoryPressure.toFixed(1)}%`);
        }

        // Alert if critical
        if (memoryPressure > MEMORY_CONFIG.alertThreshold) {
            this.emit('pressure.alert', {
                pressure: memoryPressure,
                threshold: MEMORY_CONFIG.alertThreshold,
                metrics: this.metrics
            });

            // Store alert
            this.pressureEvents.push({
                timestamp: new Date().toISOString(),
                type: 'alert',
                pressure: memoryPressure,
                threshold: MEMORY_CONFIG.alertThreshold
            });
        }

        // Force cache eviction if critical
        if (pressureLevel === PRESSURE_LEVELS.CRITICAL) {
            this.forceEviction();
        }
    }

    /**
     * Monitor garbage collection
     */
    monitorGC() {
        // Enable GC tracking if available
        if (v8.getHeapStatistics) {
            setInterval(() => {
                const heapStats = v8.getHeapStatistics();
                const gcTime = Date.now() - this.lastGC;
                
                // Estimate GC activity
                const gcActivity = (heapStats.used_heap_size || 0) / (heapStats.heap_size_limit || 1);
                
                this.metrics.gcCount = this.gcCounter;
                this.metrics.gcTime = gcTime;

                // Reset counter if GC occurred
                if (gcActivity > 0.1) {
                    this.gcCounter++;
                    this.lastGC = Date.now();
                }

                // Check if GC is too frequent
                if (this.gcCounter > MEMORY_CONFIG.gcThreshold) {
                    this.emit('gc.frequent', { count: this.gcCounter, time: gcTime });
                }
            }, MEMORY_CONFIG.gcCheckInterval);
        }
    }

    /**
     * Register a cache for adaptive eviction
     */
    registerCache(name, cacheInstance, config = {}) {
        const cacheConfig = {
            name,
            instance: cacheInstance,
            strategy: config.strategy || MEMORY_CONFIG.evictionStrategies.ADAPTIVE,
            maxSize: config.maxSize || MEMORY_CONFIG.maxCacheSize,
            minSize: config.minSize || MEMORY_CONFIG.minCacheSize,
            currentSize: 0,
            hitRate: 0,
            evictionCount: 0
        };

        this.caches.set(name, cacheConfig);
        this.evictionStrategies.set(name, {
            current: cacheConfig.strategy,
            history: [],
            performance: {}
        });

        console.log(`📦 Cache registered: ${name}`);
        return cacheConfig;
    }

    /**
     * Update cache metrics
     */
    updateCacheMetrics(name, metrics) {
        const cache = this.caches.get(name);
        if (!cache) return;

        cache.currentSize = metrics.size || 0;
        cache.hitRate = metrics.hitRate || 0;
        cache.evictionCount = metrics.evictions || 0;

        // Update total cache metrics
        this.metrics.cacheSize = Array.from(this.caches.values())
            .reduce((sum, c) => sum + c.currentSize, 0);
        this.metrics.cacheItems = Array.from(this.caches.values())
            .reduce((sum, c) => sum + (c.currentSize / 1024), 0);
    }

    /**
     * Adapt caches based on memory pressure
     */
    adaptCaches() {
        const { memoryPressure, pressureLevel } = this.metrics;

        for (const [name, cache] of this.caches) {
            const strategy = this.evictionStrategies.get(name);
            
            // Determine optimal strategy based on pressure
            const optimalStrategy = this.determineOptimalStrategy(name, memoryPressure);

            if (optimalStrategy !== strategy.current) {
                console.log(`🔄 Switching cache strategy for ${name}: ${strategy.current} -> ${optimalStrategy}`);
                strategy.current = optimalStrategy;
                this.emit('cache.strategy.changed', {
                    cache: name,
                    oldStrategy: strategy.current,
                    newStrategy: optimalStrategy,
                    pressure: memoryPressure
                });
            }

            // Adjust cache size based on pressure
            const targetSize = this.calculateTargetSize(cache, memoryPressure);
            if (targetSize < cache.currentSize) {
                const reduction = cache.currentSize - targetSize;
                this.evictFromCache(name, reduction);
            }

            // Update strategy performance
            strategy.history.push({
                timestamp: new Date().toISOString(),
                pressure: memoryPressure,
                strategy: optimalStrategy,
                size: cache.currentSize,
                hitRate: cache.hitRate
            });

            // Keep only last 100 entries
            if (strategy.history.length > 100) {
                strategy.history.shift();
            }
        }

        // Emit adaptation event
        this.emit('cache.adapted', {
            pressure: memoryPressure,
            level: pressureLevel,
            caches: Array.from(this.caches.entries()).map(([name, cache]) => ({
                name,
                size: cache.currentSize,
                strategy: this.evictionStrategies.get(name)?.current,
                hitRate: cache.hitRate
            }))
        });
    }

    /**
     * Determine optimal eviction strategy
     */
    determineOptimalStrategy(cacheName, pressure) {
        const strategies = Object.values(MEMORY_CONFIG.evictionStrategies);
        
        if (pressure > 80) {
            // High pressure: use LRU (least recently used)
            return MEMORY_CONFIG.evictionStrategies.LRU;
        } else if (pressure > 60) {
            // Medium pressure: use LFU (least frequently used)
            return MEMORY_CONFIG.evictionStrategies.LFU;
        } else if (pressure > 40) {
            // Low pressure: use adaptive
            return MEMORY_CONFIG.evictionStrategies.ADAPTIVE;
        } else {
            // Normal: use FIFO
            return MEMORY_CONFIG.evictionStrategies.FIFO;
        }
    }

    /**
     * Calculate target cache size based on pressure
     */
    calculateTargetSize(cache, pressure) {
        const { maxSize, minSize } = cache;
        const pressureFactor = pressure / 100;

        // Scale size based on pressure
        const targetSize = maxSize - (maxSize - minSize) * pressureFactor;
        return Math.max(minSize, Math.min(maxSize, targetSize));
    }

    /**
     * Evict items from cache
     */
    evictFromCache(cacheName, amount) {
        const cache = this.caches.get(cacheName);
        if (!cache) return;

        // Call cache's eviction method
        if (cache.instance && typeof cache.instance.evict === 'function') {
            const evicted = cache.instance.evict(amount);
            cache.currentSize -= evicted;
            cache.evictionCount++;
            this.emit('cache.evicted', {
                cache: cacheName,
                amount: evicted,
                remaining: cache.currentSize
            });
        }
    }

    /**
     * Force cache eviction
     */
    forceEviction() {
        console.log('🗑️ Force eviction triggered');
        
        for (const [name, cache] of this.caches) {
            const targetSize = cache.currentSize * 0.5; // Reduce to 50%
            if (targetSize < cache.currentSize) {
                const reduction = cache.currentSize - targetSize;
                this.evictFromCache(name, reduction);
            }
        }

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            console.log('🧹 Manual garbage collection triggered');
        }
    }

    /**
     * Load cache configurations from database
     */
    async loadCacheConfigurations() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM cache_configurations WHERE enabled = 1'
            );

            for (const row of rows) {
                const config = {
                    name: row.cache_name,
                    strategy: row.strategy,
                    maxSize: row.max_size,
                    minSize: row.min_size,
                    hitRate: row.hit_rate || 0,
                    evictionCount: row.eviction_count || 0
                };

                this.caches.set(row.cache_name, config);
                console.log(`📦 Loaded cache config: ${row.cache_name}`);
            }
        } catch (error) {
            console.error('Load cache configurations error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            current: this.metrics,
            history: this.history.slice(-100),
            caches: Array.from(this.caches.entries()).map(([name, cache]) => ({
                name,
                size: cache.currentSize,
                strategy: this.evictionStrategies.get(name)?.current,
                hitRate: cache.hitRate,
                evictions: cache.evictionCount
            })),
            pressureEvents: this.pressureEvents.slice(-20),
            gcCount: this.gcCounter,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            monitoring: this.isMonitoring,
            pressure: this.metrics.pressureLevel,
            pressureValue: this.metrics.memoryPressure.toFixed(1),
            caches: this.caches.size,
            gcCount: this.gcCounter,
            historySize: this.history.length
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    MemoryPressureService,
    PRESSURE_LEVELS,
    memoryPressureService: new MemoryPressureService()
};