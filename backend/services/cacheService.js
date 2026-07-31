// backend/services/cacheService.js
// Issue #1262: Cache stampede / thundering herd protection (XFetch + Singleflight)
const crypto = require('crypto');
const client = require('prom-client');

let redis = null;
try {
    redis = require('../config/redis');
} catch (err) {
    console.warn('Redis unavailable for cacheService, using in-memory only:', err.message);
}

// ============================================
// CACHE CONFIGURATION
// ============================================

const CACHE_CONFIG = {
    defaultTTL: 300,
    productTTL: 600,
    categoryTTL: 1800,
    homepageTTL: 300,
    recommendationTTL: 3600,
    promoTTL: 600,
    settingsTTL: 3600,
    warmupEnabled: true,
    warmupDelay: 5000,
    metricsEnabled: true,
    maxMemorySize: 1000,

    // XFetch: higher beta => earlier probabilistic refresh
    xfetchBeta: Number(process.env.CACHE_XFETCH_BETA) || 1.0,
    // Soft-expire window as a fraction of TTL used when delta is unknown
    xfetchMinDeltaMs: 50,
    // Redis lock TTL for cross-process singleflight (ms)
    lockTtlMs: Number(process.env.CACHE_LOCK_TTL_MS) || 5000,
    lockWaitMs: Number(process.env.CACHE_LOCK_WAIT_MS) || 80,
    lockRetries: Number(process.env.CACHE_LOCK_RETRIES) || 25,
    useRedis: process.env.CACHE_USE_REDIS !== 'false'
};

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
// PROMETHEUS METRICS
// ============================================

const cacheHits = new client.Counter({
    name: 'cache_hits',
    help: 'Number of cache hits on stampede-protected lookups',
    labelNames: ['target']
});

const cacheMisses = new client.Counter({
    name: 'cache_misses',
    help: 'Number of cache misses requiring backend fetch',
    labelNames: ['target']
});

const stampedePreventedCount = new client.Counter({
    name: 'stampede_prevented_count',
    help: 'Concurrent requests coalesced onto a single in-flight fetch',
    labelNames: ['target']
});

const softExpireRecomputes = new client.Counter({
    name: 'cache_soft_expire_recomputes',
    help: 'Probabilistic early recomputations triggered by XFetch',
    labelNames: ['target']
});

const cacheFetchDuration = new client.Histogram({
    name: 'cache_fetch_duration_seconds',
    help: 'Time spent computing values on cache miss / soft expire',
    labelNames: ['target'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
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
            softExpires: 0
        };
        this.tags = new Map();
        this.warmupTasks = [];
        this.initialized = false;
        // Singleflight: key -> Promise
        this.inFlight = new Map();
    }

    async initialize() {
        if (this.initialized) return;

        if (CACHE_CONFIG.warmupEnabled) {
            setTimeout(() => this.warmupCache(), CACHE_CONFIG.warmupDelay);
        }

        this.initialized = true;
        console.log('✅ Cache Service initialized (XFetch + Singleflight enabled)');
        return this;
    }

    /**
     * XFetch: return true when the entry should be recomputed early.
     * Formula: now - beta * delta * log(random()) >= expiry
     * See: https://blog.vividcortex.com/blog/2013/10/23/caching/
     */
    shouldEarlyRecompute(entry, beta = CACHE_CONFIG.xfetchBeta) {
        if (!entry || !entry.expiresAt) return true;

        const now = Date.now();
        if (now >= entry.expiresAt) return true;

        const delta = Math.max(
            entry.delta || CACHE_CONFIG.xfetchMinDeltaMs,
            CACHE_CONFIG.xfetchMinDeltaMs
        );
        const random = Math.random() || Number.EPSILON;
        const softExpiry = entry.expiresAt - beta * delta * Math.log(random);
        return now >= softExpiry;
    }

    async get(key, target = null) {
        const cacheKey = this.generateKey(key, target);
        const entry = await this.readEntry(cacheKey);

        if (!entry) {
            this.metrics.misses++;
            if (CACHE_CONFIG.metricsEnabled) {
                cacheMisses.inc({ target: target || 'default' });
            }
            return null;
        }

        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            await this.deleteRaw(cacheKey);
            this.metrics.misses++;
            if (CACHE_CONFIG.metricsEnabled) {
                cacheMisses.inc({ target: target || 'default' });
            }
            return null;
        }

        entry.lastAccessed = Date.now();
        this.metrics.hits++;
        if (CACHE_CONFIG.metricsEnabled) {
            cacheHits.inc({ target: target || 'default' });
        }
        return entry.value;
    }

    /**
     * Get with XFetch metadata (value + whether soft-expire recomputation is advised).
     */
    async getWithXFetch(key, target = null, beta = CACHE_CONFIG.xfetchBeta) {
        const cacheKey = this.generateKey(key, target);
        const entry = await this.readEntry(cacheKey);

        if (!entry) {
            this.metrics.misses++;
            if (CACHE_CONFIG.metricsEnabled) {
                cacheMisses.inc({ target: target || 'default' });
            }
            return { value: null, hit: false, earlyRecompute: true, entry: null };
        }

        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            await this.deleteRaw(cacheKey);
            this.metrics.misses++;
            if (CACHE_CONFIG.metricsEnabled) {
                cacheMisses.inc({ target: target || 'default' });
            }
            return { value: null, hit: false, earlyRecompute: true, entry: null };
        }

        entry.lastAccessed = Date.now();
        this.metrics.hits++;
        if (CACHE_CONFIG.metricsEnabled) {
            cacheHits.inc({ target: target || 'default' });
        }

        const earlyRecompute = this.shouldEarlyRecompute(entry, beta);
        return {
            value: entry.value,
            hit: true,
            earlyRecompute,
            entry
        };
    }

    async set(key, value, options = {}) {
        const { target, ttl, tags = [], delta = CACHE_CONFIG.xfetchMinDeltaMs } = options;
        const cacheKey = this.generateKey(key, target);
        const ttlSeconds = ttl || this.getTTL(target);

        if (this.cache.size >= CACHE_CONFIG.maxMemorySize) {
            this.evictOldest();
        }

        const entry = {
            value,
            target,
            tags,
            delta: Math.max(Number(delta) || CACHE_CONFIG.xfetchMinDeltaMs, 1),
            createdAt: Date.now(),
            expiresAt: Date.now() + ttlSeconds * 1000,
            lastAccessed: Date.now()
        };

        this.cache.set(cacheKey, entry);
        await this.writeRedis(cacheKey, entry, ttlSeconds);

        for (const tag of tags) {
            if (!this.tags.has(tag)) {
                this.tags.set(tag, new Set());
            }
            this.tags.get(tag).add(cacheKey);
        }

        this.metrics.sets++;
        return true;
    }

    async delete(key, target = null) {
        const cacheKey = this.generateKey(key, target);
        return this.deleteRaw(cacheKey);
    }

    async deleteRaw(cacheKey) {
        const entry = this.cache.get(cacheKey) || (await this.readEntry(cacheKey));

        if (entry) {
            for (const tag of entry.tags || []) {
                if (this.tags.has(tag)) {
                    this.tags.get(tag).delete(cacheKey);
                }
            }
        }

        this.cache.delete(cacheKey);
        if (redis && CACHE_CONFIG.useRedis) {
            try {
                await redis.del(cacheKey);
            } catch (_) {
                /* ignore */
            }
        }
        this.metrics.deletes++;
        return Boolean(entry);
    }

    async invalidateByTag(tag) {
        if (!this.tags.has(tag)) return 0;

        const keys = this.tags.get(tag);
        let count = 0;

        for (const cacheKey of keys) {
            await this.deleteRaw(cacheKey);
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
            }
        }

        for (const cacheKey of keysToRemove) {
            await this.deleteRaw(cacheKey);
            count++;
        }

        return count;
    }

    /**
     * Classic remember without stampede protection (kept for compatibility).
     */
    async remember(key, fetchFn, options = {}) {
        return this.getOrCompute(key, fetchFn, { ...options, stampedeProtection: false });
    }

    /**
     * Stampede-protected fetch:
     * 1) Serve cache hits
     * 2) XFetch probabilistic early refresh (recompute while still serving stale-ok value via singleflight)
     * 3) Singleflight collapse so only one DB fetch runs per key
     */
    async getOrCompute(key, fetchFn, options = {}) {
        const {
            target = null,
            ttl,
            tags = [],
            beta = CACHE_CONFIG.xfetchBeta,
            stampedeProtection = true
        } = options;

        const cacheKey = this.generateKey(key, target);
        const lookup = await this.getWithXFetch(key, target, beta);

        // Hard hit, no early recompute needed
        if (lookup.hit && !lookup.earlyRecompute) {
            return lookup.value;
        }

        // Soft expire: trigger background-style recompute via singleflight,
        // but return the still-valid cached value immediately when present.
        if (lookup.hit && lookup.earlyRecompute && stampedeProtection) {
            this.metrics.softExpires++;
            if (CACHE_CONFIG.metricsEnabled) {
                softExpireRecomputes.inc({ target: target || 'default' });
            }

            if (!this.inFlight.has(cacheKey)) {
                this.#runSingleflight(cacheKey, fetchFn, {
                    key,
                    target,
                    ttl,
                    tags
                }).catch((err) => {
                    console.error(`XFetch recompute failed for ${cacheKey}:`, err.message);
                });
            } else if (CACHE_CONFIG.metricsEnabled) {
                stampedePreventedCount.inc({ target: target || 'default' });
                this.metrics.stampedePrevented++;
            }

            return lookup.value;
        }

        // Full miss — coalesce concurrent fetches
        if (stampedeProtection && this.inFlight.has(cacheKey)) {
            this.metrics.stampedePrevented++;
            if (CACHE_CONFIG.metricsEnabled) {
                stampedePreventedCount.inc({ target: target || 'default' });
            }
            return this.inFlight.get(cacheKey);
        }

        return this.#runSingleflight(cacheKey, fetchFn, {
            key,
            target,
            ttl,
            tags
        });
    }

    /**
     * Alias used by product endpoints.
     */
    async rememberWithStampedeProtection(key, fetchFn, options = {}) {
        return this.getOrCompute(key, fetchFn, { ...options, stampedeProtection: true });
    }

    async #runSingleflight(cacheKey, fetchFn, { key, target, ttl, tags }) {
        const computePromise = (async () => {
            const lockToken = await this.acquireRedisLock(cacheKey);
            const endTimer = CACHE_CONFIG.metricsEnabled
                ? cacheFetchDuration.startTimer({ target: target || 'default' })
                : null;
            const started = Date.now();

            try {
                // Another instance may have filled the cache while we waited for the lock
                if (lockToken) {
                    const raced = await this.get(key, target);
                    if (raced !== null) {
                        return raced;
                    }
                }

                const value = await fetchFn();
                const delta = Date.now() - started;
                await this.set(key, value, { target, ttl, tags, delta });
                return value;
            } finally {
                if (endTimer) endTimer();
                if (lockToken) {
                    await this.releaseRedisLock(cacheKey, lockToken);
                }
            }
        })();

        this.inFlight.set(cacheKey, computePromise);

        try {
            return await computePromise;
        } finally {
            if (this.inFlight.get(cacheKey) === computePromise) {
                this.inFlight.delete(cacheKey);
            }
        }
    }

    async acquireRedisLock(cacheKey) {
        if (!redis || !CACHE_CONFIG.useRedis) return null;

        const lockKey = `lock:${cacheKey}`;
        const token = crypto.randomBytes(8).toString('hex');

        for (let i = 0; i < CACHE_CONFIG.lockRetries; i++) {
            try {
                const ok = await redis.set(
                    lockKey,
                    token,
                    'PX',
                    CACHE_CONFIG.lockTtlMs,
                    'NX'
                );
                if (ok === 'OK') return token;
            } catch (_) {
                return null;
            }
            await sleep(CACHE_CONFIG.lockWaitMs);
        }
        return null;
    }

    async releaseRedisLock(cacheKey, token) {
        if (!redis || !CACHE_CONFIG.useRedis || !token) return;

        const lockKey = `lock:${cacheKey}`;
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        try {
            await redis.eval(script, 1, lockKey, token);
        } catch (_) {
            /* ignore */
        }
    }

    async readEntry(cacheKey) {
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        if (!redis || !CACHE_CONFIG.useRedis) return null;

        try {
            const raw = await redis.get(cacheKey);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            this.cache.set(cacheKey, entry);
            return entry;
        } catch (err) {
            console.warn('Redis cache read failed:', err.message);
            return null;
        }
    }

    async writeRedis(cacheKey, entry, ttlSeconds) {
        if (!redis || !CACHE_CONFIG.useRedis) return;

        try {
            await redis.setex(cacheKey, ttlSeconds, JSON.stringify(entry));
        } catch (err) {
            console.warn('Redis cache write failed:', err.message);
        }
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
            xfetchBeta: CACHE_CONFIG.xfetchBeta
        };
    }

    getInfo(key, target = null) {
        const cacheKey = this.generateKey(key, target);
        const entry = this.cache.get(cacheKey);
        if (!entry) return null;

        return {
            target: entry.target,
            tags: entry.tags,
            delta: entry.delta,
            age: Math.round((Date.now() - entry.createdAt) / 1000),
            expiresIn: Math.round((entry.expiresAt - Date.now()) / 1000),
            earlyRecompute: this.shouldEarlyRecompute(entry)
        };
    }

    generateKey(key, target) {
        return target ? `${target}:${key}` : key;
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

    /**
     * Build a stable cache key for product list queries.
     */
    buildProductListKey(filters = {}, options = {}) {
        const payload = JSON.stringify({ filters, options });
        const hash = crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16);
        return `list:${hash}`;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const cacheService = new CacheService();

module.exports = {
    CacheService,
    CACHE_TARGETS,
    CACHE_CONFIG,
    cacheService,
    // exported for tests / metrics scrapers
    prometheusMetrics: {
        cacheHits,
        cacheMisses,
        stampedePreventedCount,
        softExpireRecomputes,
        cacheFetchDuration
    }
};
