// backend/services/cacheService.js
const crypto = require('crypto');

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
    maxMemorySize: 1000
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
// CACHE SERVICE
// ============================================

class CacheService {
    constructor() {
        this.cache = new Map();
        this.metrics = { hits: 0, misses: 0, sets: 0, deletes: 0 };
        this.tags = new Map();
        this.warmupTasks = [];
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        if (CACHE_CONFIG.warmupEnabled) {
            setTimeout(() => this.warmupCache(), CACHE_CONFIG.warmupDelay);
        }
        
        this.initialized = true;
        console.log('✅ Cache Service initialized');
        return this;
    }

    async get(key, target = null) {
        const cacheKey = this.generateKey(key, target);
        const entry = this.cache.get(cacheKey);

        if (!entry) {
            this.metrics.misses++;
            return null;
        }

        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.cache.delete(cacheKey);
            this.metrics.misses++;
            return null;
        }

        entry.lastAccessed = Date.now();
        this.metrics.hits++;
        return entry.value;
    }

    async set(key, value, options = {}) {
        const { target, ttl, tags = [] } = options;
        const cacheKey = this.generateKey(key, target);

        if (this.cache.size >= CACHE_CONFIG.maxMemorySize) {
            this.evictOldest();
        }

        const entry = {
            value,
            target,
            tags,
            createdAt: Date.now(),
            expiresAt: Date.now() + (ttl || this.getTTL(target)) * 1000,
            lastAccessed: Date.now()
        };

        this.cache.set(cacheKey, entry);
        
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
        const entry = this.cache.get(cacheKey);

        if (entry) {
            for (const tag of entry.tags || []) {
                if (this.tags.has(tag)) {
                    this.tags.get(tag).delete(cacheKey);
                }
            }
            this.cache.delete(cacheKey);
            this.metrics.deletes++;
            return true;
        }
        return false;
    }

    async invalidateByTag(tag) {
        if (!this.tags.has(tag)) return 0;

        const keys = this.tags.get(tag);
        let count = 0;

        for (const cacheKey of keys) {
            this.cache.delete(cacheKey);
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
        }

        return count;
    }

    async remember(key, fetchFn, options = {}) {
        const cached = await this.get(key, options.target);
        if (cached !== null) return cached;

        const value = await fetchFn();
        await this.set(key, value, options);
        return value;
    }

    // ============================================
    // REDLOCK-STYLE DISTRIBUTED LOCKS (Issue #1260)
    // ============================================

    /**
     * Acquire a Redis distributed lock (SET key token NX PX ttl).
     * Retries with short backoff — used as a fast pre-gate before MySQL FOR UPDATE.
     */
    async acquireLock(lockName, options = {}) {
        const {
            ttlMs = 5000,
            retries = 25,
            retryDelayMs = 40,
            token = crypto.randomBytes(16).toString('hex')
        } = options;

        const key = `redlock:${lockName}`;
        let redis;
        try {
            redis = require('../config/redis');
        } catch (_) {
            // In-memory fallback for environments without Redis
            if (!this._localLocks) this._localLocks = new Map();
            const existing = this._localLocks.get(key);
            if (existing && existing.expiresAt > Date.now()) {
                for (let i = 0; i < retries; i++) {
                    await sleep(retryDelayMs);
                    const again = this._localLocks.get(key);
                    if (!again || again.expiresAt <= Date.now()) break;
                }
                const still = this._localLocks.get(key);
                if (still && still.expiresAt > Date.now()) {
                    return null;
                }
            }
            this._localLocks.set(key, { token, expiresAt: Date.now() + ttlMs });
            return { key, token, local: true };
        }

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
                if (result === 'OK') {
                    return { key, token, local: false };
                }
            } catch (err) {
                console.warn('Redlock acquire failed:', err.message);
                return null;
            }
            await sleep(retryDelayMs);
        }
        return null;
    }

    /**
     * Release a previously acquired Redlock (compare-and-delete).
     */
    async releaseLock(lockHandle) {
        if (!lockHandle || !lockHandle.key || !lockHandle.token) return false;

        if (lockHandle.local) {
            if (!this._localLocks) return false;
            const current = this._localLocks.get(lockHandle.key);
            if (current && current.token === lockHandle.token) {
                this._localLocks.delete(lockHandle.key);
                return true;
            }
            return false;
        }

        let redis;
        try {
            redis = require('../config/redis');
        } catch (_) {
            return false;
        }

        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        try {
            const result = await redis.eval(script, 1, lockHandle.key, lockHandle.token);
            return result === 1;
        } catch (err) {
            console.warn('Redlock release failed:', err.message);
            return false;
        }
    }

    /**
     * Run `fn` while holding a Redlock. Always releases on settle.
     */
    async withLock(lockName, fn, options = {}) {
        const handle = await this.acquireLock(lockName, options);
        if (!handle) {
            const err = new Error(`Could not acquire lock: ${lockName}`);
            err.code = 'LOCK_NOT_ACQUIRED';
            throw err;
        }
        try {
            return await fn(handle);
        } finally {
            await this.releaseLock(handle);
        }
    }

    async clear() {
        this.cache.clear();
        this.tags.clear();
        if (this._localLocks) this._localLocks.clear();
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
            tags: this.tags.size
        };
    }

    getInfo(key, target = null) {
        const cacheKey = this.generateKey(key, target);
        const entry = this.cache.get(cacheKey);
        if (!entry) return null;

        return {
            target: entry.target,
            tags: entry.tags,
            age: Math.round((Date.now() - entry.createdAt) / 1000),
            expiresIn: Math.round((entry.expiresAt - Date.now()) / 1000)
        };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

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
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    CacheService,
    CACHE_TARGETS,
    CACHE_CONFIG,
    cacheService: new CacheService()
};