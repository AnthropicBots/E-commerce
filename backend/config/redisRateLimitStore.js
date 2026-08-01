// backend/config/redisRateLimitStore.js
//
// An `express-rate-limit` store backed by the shared Redis client.
//
// Every limiter in this backend relied on the library's default MemoryStore, so
// the counters lived in one process's heap. A restart or a redeploy handed
// every caller a fresh quota, and with N instances behind the load balancer the
// effective limit was N times the configured one. Holding the counters in Redis
// makes a limit mean what it says regardless of how many processes serve it and
// how often they restart.
//
// This implements the Store interface of express-rate-limit v8, the major
// version pinned in package.json: `init(options)`,
// `increment(key) -> { totalHits, resetTime }`, `decrement(key)`,
// `resetKey(key)` and `resetAll()`. There is no `rate-limit-redis` dependency
// on purpose -- the client we already own is enough and the interface is four
// methods wide.

const redis = require('./redis');
const logger = require('./logger');

// INCR followed by a separate PEXPIRE has two races. A concurrent request can
// observe the incremented counter before the TTL exists, and a crash between
// the two commands leaves a key that never expires, which is a permanent lock
// out for that caller. Running both inside one script makes the pair atomic and
// costs a single round trip. PTTL is re-read rather than branching on
// `hits == 1` so a key that has somehow lost its TTL is repaired instead of
// leaking forever.
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`;

// Decrementing is only meaningful while the window is still open. Recreating an
// expired key here would resurrect a window with no TTL attached to it.
const DECREMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
    return redis.call('DECR', KEYS[1])
end
return 0
`;

const DEFAULT_WINDOW_MS = 60 * 1000;
const OUTAGE_LOG_INTERVAL_MS = 60 * 1000;
const SCAN_BATCH = 100;

// A long outage must not turn the in-process fallback into a memory leak, so
// expired entries are swept once the map grows past this.
const FALLBACK_SWEEP_THRESHOLD = 10000;

class RedisRateLimitStore {
    /**
     * @param {object} config
     * @param {string} config.prefix namespace for this limiter's keys. Two
     *   limiters sharing a prefix would share a counter, so every limiter must
     *   pass its own.
     * @param {object} [config.client] ioredis client, defaults to the shared one.
     */
    constructor({ prefix, client = redis } = {}) {
        if (!prefix) {
            throw new Error(
                'RedisRateLimitStore requires a prefix so limiters do not share counters'
            );
        }

        this.prefix = prefix;
        this.client = client;
        this.windowMs = DEFAULT_WINDOW_MS;

        // The counters live in Redis and are shared by every instance, which is
        // the entire point of this store. `localKeys = false` tells
        // express-rate-limit it does not own them.
        this.localKeys = false;

        this.fallbackHits = new Map();
        this.lastOutageLogAt = 0;
    }

    /** Called by express-rate-limit once, with the limiter's resolved options. */
    init(options) {
        this.windowMs = options.windowMs;
    }

    redisKey(key) {
        return `${this.prefix}:${key}`;
    }

    async increment(key) {
        try {
            const [hits, ttl] = await this.client.eval(
                INCREMENT_SCRIPT,
                1,
                this.redisKey(key),
                this.windowMs
            );

            return {
                totalHits: Number(hits),
                resetTime: new Date(Date.now() + Number(ttl))
            };
        } catch (error) {
            this.reportOutage('increment', error);
            return this.incrementLocally(key);
        }
    }

    async decrement(key) {
        try {
            await this.client.eval(DECREMENT_SCRIPT, 1, this.redisKey(key));
        } catch (error) {
            this.reportOutage('decrement', error);

            const entry = this.fallbackHits.get(key);
            if (entry && entry.totalHits > 0) {
                entry.totalHits -= 1;
            }
        }
    }

    async resetKey(key) {
        this.fallbackHits.delete(key);

        try {
            await this.client.del(this.redisKey(key));
        } catch (error) {
            this.reportOutage('resetKey', error);
        }
    }

    async resetAll() {
        this.fallbackHits.clear();

        try {
            // SCAN rather than KEYS: this runs against a shared Redis and KEYS
            // blocks the server for the length of the keyspace.
            let cursor = '0';
            do {
                const [nextCursor, keys] = await this.client.scan(
                    cursor,
                    'MATCH',
                    `${this.prefix}:*`,
                    'COUNT',
                    SCAN_BATCH
                );
                cursor = nextCursor;

                if (keys.length > 0) {
                    await this.client.del(...keys);
                }
            } while (cursor !== '0');
        } catch (error) {
            this.reportOutage('resetAll', error);
        }
    }

    /**
     * Deliberate degradation when Redis is unreachable: count in this process
     * rather than rejecting traffic.
     *
     * Failing closed would turn a Redis outage into a total outage -- every
     * request answered with 429, including the ones that have nothing to do
     * with abuse. The rest of this backend degrades the same way (promo
     * validation falls back to the stored `used_count`, the Socket.IO adapter
     * logs and carries on), so failing closed here would also be inconsistent.
     *
     * The fallback still enforces the configured limit, just per process, which
     * is precisely the behaviour that shipped before this store existed. The
     * worst case during an outage is therefore the old weakness rather than a
     * new one. It is logged at error level so the degradation is visible, and
     * throttled so a sustained outage does not flood the log the way the
     * unthrottled Redis error handler used to.
     */
    reportOutage(operation, error) {
        const now = Date.now();
        if (now - this.lastOutageLogAt < OUTAGE_LOG_INTERVAL_MS) {
            return;
        }

        this.lastOutageLogAt = now;
        logger.error(
            `Rate limit store unavailable (${this.prefix}.${operation}): ${error.message}. `
            + 'Falling back to per-process counting; limits are no longer shared across instances.'
        );
    }

    incrementLocally(key) {
        const now = Date.now();

        if (this.fallbackHits.size > FALLBACK_SWEEP_THRESHOLD) {
            this.sweepFallback(now);
        }

        const entry = this.fallbackHits.get(key);
        if (!entry || entry.resetTime <= now) {
            const resetTime = now + this.windowMs;
            this.fallbackHits.set(key, { totalHits: 1, resetTime });
            return { totalHits: 1, resetTime: new Date(resetTime) };
        }

        entry.totalHits += 1;
        return { totalHits: entry.totalHits, resetTime: new Date(entry.resetTime) };
    }

    sweepFallback(now) {
        for (const [key, entry] of this.fallbackHits) {
            if (entry.resetTime <= now) {
                this.fallbackHits.delete(key);
            }
        }
    }
}

/**
 * Build a store for one limiter. Each limiter needs its own instance so that,
 * for example, the login and signup counters for the same address stay
 * separate.
 */
const createRateLimitStore = (prefix, client = redis) =>
    new RedisRateLimitStore({ prefix, client });

module.exports = {
    RedisRateLimitStore,
    createRateLimitStore
};
