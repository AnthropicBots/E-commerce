// backend/tests/redisRateLimitStore.test.js
//
// The Redis-backed express-rate-limit store (#1365). The client is mocked at
// the module boundary, as every other suite here does, so nothing opens a
// socket.

jest.mock('../config/redis', () => ({
    eval: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue(['0', []])
}));

jest.mock('../config/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const redis = require('../config/redis');
const logger = require('../config/logger');
const { RedisRateLimitStore, createRateLimitStore } = require('../config/redisRateLimitStore');

const WINDOW_MS = 15 * 60 * 1000;

const buildStore = (prefix = 'rl:test') => {
    const store = createRateLimitStore(prefix);
    store.init({ windowMs: WINDOW_MS });
    return store;
};

beforeEach(() => {
    jest.clearAllMocks();
    redis.del.mockResolvedValue(1);
    redis.scan.mockResolvedValue(['0', []]);
});

describe('RedisRateLimitStore key namespacing', () => {
    test('refuses to build a store without a prefix, which would share counters', () => {
        expect(() => new RedisRateLimitStore({})).toThrow(/prefix/);
    });

    test('two limiters with different prefixes address different Redis keys', async () => {
        redis.eval.mockResolvedValue([1, WINDOW_MS]);

        await buildStore('rl:auth:login').increment('ip:203.0.113.7');
        await buildStore('rl:auth:signup').increment('ip:203.0.113.7');

        const [loginCall, signupCall] = redis.eval.mock.calls;
        expect(loginCall[2]).toBe('rl:auth:login:ip:203.0.113.7');
        expect(signupCall[2]).toBe('rl:auth:signup:ip:203.0.113.7');
        expect(loginCall[2]).not.toBe(signupCall[2]);
    });
});

describe('RedisRateLimitStore.increment', () => {
    test('reports the shared counter and the window end from a single round trip', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
        redis.eval.mockResolvedValue([3, 120000]);

        const result = await buildStore().increment('ip:203.0.113.7');

        expect(redis.eval).toHaveBeenCalledTimes(1);
        expect(result.totalHits).toBe(3);
        expect(result.resetTime).toEqual(new Date(Date.now() + 120000));

        jest.useRealTimers();
    });

    test('applies the window the limiter was initialised with as the key TTL', async () => {
        redis.eval.mockResolvedValue([1, WINDOW_MS]);

        await buildStore().increment('ip:203.0.113.7');

        const [script, keyCount, , windowArg] = redis.eval.mock.calls[0];
        expect(keyCount).toBe(1);
        expect(windowArg).toBe(WINDOW_MS);
        // The increment and the expiry have to be one atomic unit; a key that
        // misses its TTL never lets its caller back in.
        expect(script).toMatch(/INCR/);
        expect(script).toMatch(/PEXPIRE/);
    });

    test('counts hits from every instance, so the count is not per process', async () => {
        redis.eval.mockResolvedValueOnce([7, WINDOW_MS]);

        // A freshly started process sees the total accumulated elsewhere rather
        // than starting from one.
        const result = await buildStore().increment('ip:203.0.113.7');

        expect(result.totalHits).toBe(7);
    });
});

describe('RedisRateLimitStore reset behaviour', () => {
    test('resetKey drops only this limiter\'s namespaced key', async () => {
        await buildStore('rl:auth:login').resetKey('ip:203.0.113.7');

        expect(redis.del).toHaveBeenCalledWith('rl:auth:login:ip:203.0.113.7');
    });

    test('decrement gives a hit back without recreating an expired window', async () => {
        redis.eval.mockResolvedValue(2);

        await buildStore().decrement('ip:203.0.113.7');

        const [script] = redis.eval.mock.calls[0];
        expect(script).toMatch(/EXISTS/);
        expect(script).toMatch(/DECR/);
    });

    test('resetAll walks the namespace with SCAN and deletes what it finds', async () => {
        redis.scan
            .mockResolvedValueOnce(['12', ['rl:test:a', 'rl:test:b']])
            .mockResolvedValueOnce(['0', ['rl:test:c']]);

        await buildStore().resetAll();

        expect(redis.scan).toHaveBeenCalledTimes(2);
        expect(redis.del).toHaveBeenCalledWith('rl:test:a', 'rl:test:b');
        expect(redis.del).toHaveBeenCalledWith('rl:test:c');
    });
});

describe('RedisRateLimitStore when Redis is unavailable', () => {
    // The deliberate choice is to degrade to per-process counting rather than
    // reject traffic: failing closed would answer every request with 429 for the
    // duration of a cache outage.
    const outage = new Error('ECONNREFUSED');

    test('still enforces the limit, counting within this process', async () => {
        redis.eval.mockRejectedValue(outage);
        const store = buildStore();

        const first = await store.increment('ip:203.0.113.7');
        const second = await store.increment('ip:203.0.113.7');

        expect(first.totalHits).toBe(1);
        expect(second.totalHits).toBe(2);
    });

    test('does not reject the request', async () => {
        redis.eval.mockRejectedValue(outage);

        await expect(buildStore().increment('ip:203.0.113.7')).resolves.toBeDefined();
    });

    test('keeps separate callers in separate buckets while degraded', async () => {
        redis.eval.mockRejectedValue(outage);
        const store = buildStore();

        await store.increment('ip:203.0.113.7');
        const other = await store.increment('ip:198.51.100.4');

        expect(other.totalHits).toBe(1);
    });

    test('expires the local window so a caller is not held past it', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
        redis.eval.mockRejectedValue(outage);
        const store = buildStore();

        await store.increment('ip:203.0.113.7');
        jest.advanceTimersByTime(WINDOW_MS + 1);
        const afterWindow = await store.increment('ip:203.0.113.7');

        expect(afterWindow.totalHits).toBe(1);

        jest.useRealTimers();
    });

    test('says so loudly, but only once per outage interval', async () => {
        redis.eval.mockRejectedValue(outage);
        const store = buildStore();

        await store.increment('ip:203.0.113.7');
        await store.increment('ip:203.0.113.7');
        await store.increment('ip:198.51.100.4');

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toMatch(/per-process/);
    });

    test('a successful sign-in still clears the local counter', async () => {
        redis.eval.mockRejectedValue(outage);
        redis.del.mockRejectedValue(outage);
        const store = buildStore();

        await store.increment('ip:203.0.113.7');
        await store.resetKey('ip:203.0.113.7');
        const afterReset = await store.increment('ip:203.0.113.7');

        expect(afterReset.totalHits).toBe(1);
    });
});
