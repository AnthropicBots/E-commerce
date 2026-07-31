// backend/services/cacheService.js
const crypto = require('crypto');
const Redis = require('ioredis');
const prometheus = require('prom-client');

// ============================================
// CACHE CONFIGURATION
// ============================================

const CACHE_CONFIG = {
    defaultTTL: 300, // 5 minutes
    productTTL: 600, // 10 minutes
    categoryTTL: 1800, // 30 minutes
    homepageTTL: 300, // 5 minutes
    recommendationTTL: 3600, // 1 hour
    promoTTL: 600, // 10 minutes
    settingsTTL: 3600, // 1 hour
    warmupEnabled: true,
    warmupDelay: 5000,
    metricsEnabled: true,
    maxMemorySize: 1000,
    // XFetch (#1262): higher beta → earlier probabilistic refresh
    xfetchBeta: parseFloat(process.env.CACHE_XFETCH_BETA) || 1.0,
    // Redis distributed mutex TTL for multi-instance stampede collapse
    lockTtlMs: parseInt(process.env.CACHE_LOCK_TTL_MS, 10) || 5000,
    redisEnabled: process.env.CACHE_REDIS_ENABLED !== 'false'
};

// ============================================
// CACHE TARGETS
// ============================================

const CACHE_TARGETS = {
    PRODUCT: 'product',
    CATEGORY: 'category',
    HOMEPAGE: 'homepage',
    RECOMMENDATION: 'recommendation',
    PROMO: 'promo',
    SETTINGS: 'settings',
    USER: 'user',
    ORDER: 'order',
    CART: 'cart'
};

// ============================================
// PROMETHEUS METRICS (#1262)
// ============================================

const cacheRegister = new prometheus.Registry();

const cacheHitsCounter = new prometheus.Counter({
    name: 'cache_hits',
    help: 'Total cache hits (including soft-valid XFetch hits)',
    labelNames: ['target'],
    registers: [cacheRegister]
});

const cacheMissesCounter = new prometheus.Counter({
    name: 'cache_misses',
    help: 'Total hard cache misses that triggered a fetch',
    labelNames: ['target'],
    registers: [cacheRegister]
});

const stampedePreventedCounter = new prometheus.Counter({
    name: 'stampede_prevented_count',
    help: 'Concurrent requests coalesced via singleflight / mutex',
    labelNames: ['target'],
    registers: [cacheRegister]
});

const xfetchRecomputeCounter = new prometheus.Counter({
    name: 'cache_xfetch_recomputes_total',
    help: 'Probabilistic early recomputations (XFetch)',
    labelNames: ['target'],
    registers: [cacheRegister]
});

const cacheFetchDuration = new prometheus.Histogram({
    name: 'cache_fetch_duration_seconds',
    help: 'Duration of cache miss / XFetch recompute fetchFn',
    labelNames: ['target'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [cacheRegister]
});

// ============================================
// CACHE SERVICE
// ============================================

class CacheService {
    constructor() {
        this.cache = new Map();
        this.metrics = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            stampedePrevented: 0,
            xfetchRecomputes: 0
        };
        this.tags = new Map();
        this.warmupTasks = [];
        this.initialized = false;
        /** @type {Map<string, Promise<*>>} Singleflight in-flight map */
        this.inFlight = new Map();
        this.redis = null;
        this.redisReady = false;

        if (CACHE_CONFIG.redisEnabled) {
            this._initRedis();
        }
    }

    _initRedis() {
        try {
            this.redis = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                db: process.env.REDIS_CACHE_DB || process.env.REDIS_DB || 0,
                retryStrategy: (times) => Math.min(times * 50, 2000),
                maxRetriesPerRequest: 3,
                lazyConnect: true,
                enableOfflineQueue: false
            });

            this.redis.connect().then(() => {
                this.redisReady = true;
            }).catch(() => {
                this.redisReady = false;
            });

            this.redis.on('ready', () => { this.redisReady = true; });
            this.redis.on('error', () => { this.redisReady = false; });
        } catch (err) {
            console.warn('Cache Redis init failed, using memory only:', err.message);
            this.redis = null;
            this.redisReady = false;
        }
    }

    async initialize() {
        if (this.initialized) return;

        if (CACHE_CONFIG.warmupEnabled) {
            setTimeout(() => this.warmupCache(), CACHE_CONFIG.warmupDelay);
        }

        this.initialized = true;
        console.log('✅ Cache Service initialized (XFetch + singleflight)');
        return this;
    }

    /**
     * XFetch probabilistic early expiration.
     * Recompute when: now - β·δ·ln(U) >= expiresAt
     * (ln(U)<0 ⇒ triggers before hard TTL based on last compute delta)
     */
    shouldXFetch(entry, beta = CACHE_CONFIG.xfetchBeta) {
        if (!entry || !entry.expiresAt) return true;
        const now = Date.now();
        if (now >= entry.expiresAt) return true;

        const deltaMs = Math.max(entry.deltaMs || 50, 1);
        const u = Math.random() || Number.MIN_VALUE;
        return (now - deltaMs * beta * Math.log(u)) >= entry.expiresAt;
    }

    /**
     * Singleflight: only one fetchFn runs per key; waiters share the Promise.
     */
    async singleflight(cacheKey, fetchFn, target = 'default') {
        if (this.inFlight.has(cacheKey)) {
            this.metrics.stampedePrevented++;
            stampedePreventedCounter.inc({ target: target || 'default' });
            return this.inFlight.get(cacheKey);
        }

        const promise = (async () => {
            // Optional Redis mutex for multi-instance collapse
            const lockKey = `lock:${cacheKey}`;
            let lockHeld = false;
            if (this.redisReady) {
                try {
                    const ok = await this.redis.set(
                        lockKey,
                        String(process.pid),
                        'PX',
                        CACHE_CONFIG.lockTtlMs,
                        'NX'
                    );
                    if (ok !== 'OK') {
                        // Another instance holds the lock — brief wait then re-read cache
                        this.metrics.stampedePrevented++;
                        stampedePreventedCounter.inc({ target: target || 'default' });
                        await new Promise((r) => setTimeout(r, 50));
                        const raced = await this.getEntryRaw(cacheKey);
                        if (raced && !this.shouldXFetch(raced)) {
                            return raced.value;
                        }
                        // Fall through and fetch if still empty / soft-expired
                    } else {
                        lockHeld = true;
                    }
                } catch (_) {
                    // ignore lock errors
                }
            }

            try {
                return await fetchFn();
            } finally {
                if (lockHeld && this.redisReady) {
                    try {
                        await this.redis.del(lockKey);
                    } catch (_) { /* ignore */ }
                }
            }
        })().finally(() => {
            this.inFlight.delete(cacheKey);
        });

        this.inFlight.set(cacheKey, promise);
        return promise;
    }

    async get(key, target = null) {
        const entry = await this.getEntry(key, target);
        if (!entry) {
            this.metrics.misses++;
            cacheMissesCounter.inc({ target: target || 'default' });
            return null;
        }
        this.metrics.hits++;
        cacheHitsCounter.inc({ target: target || 'default' });
        return entry.value;
    }

    async getEntry(key, target = null) {
        const cacheKey = this.generateKey(key, target);
        return this.getEntryRaw(cacheKey);
    }

    async getEntryRaw(cacheKey) {
        // Memory first
        let entry = this.cache.get(cacheKey);

        if (!entry && this.redisReady) {
            try {
                const raw = await this.redis.get(cacheKey);
                if (raw) {
                    entry = JSON.parse(raw);
                    // hydrate L1
                    this.cache.set(cacheKey, entry);
                }
            } catch (_) {
                entry = null;
            }
        }

        if (!entry) return null;

        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.cache.delete(cacheKey);
            if (this.redisReady) {
                try { await this.redis.del(cacheKey); } catch (_) { /* ignore */ }
            }
            return null;
        }

        entry.lastAccessed = Date.now();
        return entry;
    }

    async set(key, value, options = {}) {
        const { target, ttl, tags = [], deltaMs = 50 } = options;
        const cacheKey = this.generateKey(key, target);
        const ttlSec = ttl || this.getTTL(target);

        if (this.cache.size >= CACHE_CONFIG.maxMemorySize) {
            this.evictOldest();
        }

        const entry = {
            value,
            target,
            tags,
            deltaMs,
            createdAt: Date.now(),
            expiresAt: Date.now() + ttlSec * 1000,
            lastAccessed: Date.now()
        };

        this.cache.set(cacheKey, entry);

        for (const tag of tags) {
            if (!this.tags.has(tag)) {
                this.tags.set(tag, new Set());
            }
            this.tags.get(tag).add(cacheKey);
        }

        if (this.redisReady) {
            try {
                // Store slightly past logical expiry so XFetch soft window is readable
                const redisTtl = Math.max(ttlSec + 5, ttlSec);
                await this.redis.setex(cacheKey, redisTtl, JSON.stringify(entry));
            } catch (err) {
                console.warn('Cache Redis set failed:', err.message);
            }
        }

        this.metrics.sets++;
        return true;
    }

    async delete(key, target = null) {
        const cacheKey = this.generateKey(key, target);
        const entry = this.cache.get(cacheKey);

        if (entry) {
            for (const tag of entry.tags || []) {
                if (this.tags.has(tag)) {
                    this.tags.get(tag).delete(cacheKey);
                }
            }
            this.cache.delete(cacheKey);
            this.metrics.deletes++;
        }

        if (this.redisReady) {
            try { await this.redis.del(cacheKey); } catch (_) { /* ignore */ }
        }

        return Boolean(entry);
    }

    async invalidateByTag(tag) {
        if (!this.tags.has(tag)) return 0;

        const keys = [...this.tags.get(tag)];
        let count = 0;

        for (const cacheKey of keys) {
            this.cache.delete(cacheKey);
            if (this.redisReady) {
                try { await this.redis.del(cacheKey); } catch (_) { /* ignore */ }
            }
            count++;
        }

        this.tags.delete(tag);
        return count;
    }

    async invalidateByTarget(target) {
        let count = 0;
        const keysToRemove = [];

        for (const [cacheKey, entry] of this.cache) {
            if (entry.target === target) {
                keysToRemove.push(cacheKey);
                count++;
            }
        }

        for (const cacheKey of keysToRemove) {
            const entry = this.cache.get(cacheKey);
            if (entry) {
                for (const tag of entry.tags || []) {
                    if (this.tags.has(tag)) {
                        this.tags.get(tag).delete(cacheKey);
                    }
                }
                this.cache.delete(cacheKey);
            }
            if (this.redisReady) {
                try { await this.redis.del(cacheKey); } catch (_) { /* ignore */ }
            }
        }

        if (this.redisReady && target) {
            try {
                const pattern = `${target}:*`;
                const keys = await this.redis.keys(pattern);
                if (keys.length) await this.redis.del(...keys);
                count = Math.max(count, keys.length);
            } catch (_) { /* ignore */ }
        }

        return count;
    }

    /**
     * Classic remember (no stampede protection) — kept for compatibility.
     */
    async remember(key, fetchFn, options = {}) {
        return this.getOrCompute(key, fetchFn, options);
    }

    /**
     * Stampede-safe get-or-compute: XFetch early refresh + singleflight collapse (#1262).
     */
    async getOrCompute(key, fetchFn, options = {}) {
        const target = options.target || 'default';
        const cacheKey = this.generateKey(key, target);
        const entry = await this.getEntryRaw(cacheKey);

        if (entry && !this.shouldXFetch(entry, options.beta)) {
            this.metrics.hits++;
            cacheHitsCounter.inc({ target });
            return entry.value;
        }

        if (entry && this.shouldXFetch(entry, options.beta) && Date.now() < entry.expiresAt) {
            this.metrics.xfetchRecomputes++;
            xfetchRecomputeCounter.inc({ target });
            // Soft hit path still counts as a hit for the waiter that triggers refresh;
            // concurrent waiters are counted in stampede_prevented_count.
            this.metrics.hits++;
            cacheHitsCounter.inc({ target });
        } else if (!entry) {
            this.metrics.misses++;
            cacheMissesCounter.inc({ target });
        }

        return this.singleflight(cacheKey, async () => {
            // Double-check after winning the flight (another waiter may have filled)
            const again = await this.getEntryRaw(cacheKey);
            if (again && !this.shouldXFetch(again, options.beta)) {
                return again.value;
            }

            const endTimer = cacheFetchDuration.startTimer({ target });
            const started = Date.now();
            try {
                const value = await fetchFn();
                const deltaMs = Date.now() - started;
                await this.set(key, value, { ...options, deltaMs });
                return value;
            } finally {
                endTimer();
            }
        }, target);
    }

    async clear() {
        this.cache.clear();
        this.tags.clear();
        this.inFlight.clear();
        console.log('🗑️ Cache cleared');
        return true;
    }

    getStats() {
        const total = this.metrics.hits + this.metrics.misses;
        const hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0;

        return {
            ...this.metrics,
            hitRate: hitRate.toFixed(2) + '%',
            items: this.cache.size,
            tags: this.tags.size,
            inFlight: this.inFlight.size,
            redisReady: this.redisReady,
            xfetchBeta: CACHE_CONFIG.xfetchBeta
        };
    }

    /**
     * Prometheus registry for /metrics scraping
     */
    getPrometheusRegister() {
        return cacheRegister;
    }

    async getPrometheusMetrics() {
        return cacheRegister.metrics();
    }

    getInfo(key, target = null) {
        const cacheKey = this.generateKey(key, target);
        const entry = this.cache.get(cacheKey);
        if (!entry) return null;

        return {
            target: entry.target,
            tags: entry.tags,
            deltaMs: entry.deltaMs,
            age: Math.round((Date.now() - entry.createdAt) / 1000),
            expiresIn: Math.round((entry.expiresAt - Date.now()) / 1000),
            wouldXFetch: this.shouldXFetch(entry)
        };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateKey(key, target) {
        return target ? `${target}:${key}` : key;
    }

    hashKey(parts) {
        return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
    }

    getTTL(target) {
        const ttlMap = {
            [CACHE_TARGETS.PRODUCT]: CACHE_CONFIG.productTTL,
            [CACHE_TARGETS.CATEGORY]: CACHE_CONFIG.categoryTTL,
            [CACHE_TARGETS.HOMEPAGE]: CACHE_CONFIG.homepageTTL,
            [CACHE_TARGETS.RECOMMENDATION]: CACHE_CONFIG.recommendationTTL,
            [CACHE_TARGETS.PROMO]: CACHE_CONFIG.promoTTL,
            [CACHE_TARGETS.SETTINGS]: CACHE_CONFIG.settingsTTL
        };
        return ttlMap[target] || CACHE_CONFIG.defaultTTL;
    }

    evictOldest() {
        let oldest = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache) {
            if (entry.lastAccessed < oldestTime) {
                oldestTime = entry.lastAccessed;
                oldest = key;
            }
        }

        if (oldest) {
            this.cache.delete(oldest);
        }
    }

    registerWarmupTask(task) {
        this.warmupTasks.push(task);
    }

    async warmupCache() {
        console.log('🔥 Starting cache warmup...');
        const start = Date.now();

        for (const task of this.warmupTasks) {
            try {
                await task();
            } catch (error) {
                console.error('Warmup task failed:', error);
            }
        }

        console.log(`✅ Cache warmup completed in ${Date.now() - start}ms`);
    }
}

// ============================================
// EXPORT
// ============================================

const cacheService = new CacheService();

module.exports = {
    CacheService,
    CACHE_TARGETS,
    CACHE_CONFIG,
    cacheService,
    cacheRegister
};
