// backend/tests/otpRequestLimiter.test.js
//
// The per-address code-sending budget (#1455): the arithmetic, the key it
// counts against, and what it does when Redis is not there.
//
// The behaviour this replaced lived in a module-scope `Map` in authController
// and had no tests at all, which is how it stayed per-process and unbounded
// through several rounds of work on that file.

const REDIS_KEY_PATTERN = /^auth:otp-budget:[0-9a-f]{64}$/;

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

const crypto = require('crypto');
const redis = require('../config/redis');
const logger = require('../config/logger');
const limiter = require('../services/otpRequestLimiter');

const EMAIL = 'shopper@example.com';
const EXPECTED_KEY =
    `auth:otp-budget:${crypto.createHash('sha256').update(EMAIL).digest('hex')}`;

/**
 * Make Redis behave like a real counter for the duration of one test.
 *
 * The service's contract with the script is "give me back [count, ttl]", so the
 * double implements exactly that and nothing else.
 *
 * @returns {Map<string, number>} the counts, for assertions.
 */
const withCountingRedis = () => {
    const counts = new Map();

    redis.eval.mockImplementation(async (_script, _numKeys, key, windowMs) => {
        const next = (counts.get(key) || 0) + 1;
        counts.set(key, next);
        return [next, Number(windowMs)];
    });

    return counts;
};

beforeEach(async () => {
    jest.clearAllMocks();
    redis.del.mockResolvedValue(1);
    redis.scan.mockResolvedValue(['0', []]);
    // Clear the in-process fallback so an outage test does not leak counts into
    // the next one.
    redis.eval.mockResolvedValue([1, limiter.OTP_REQUEST_WINDOW_MS]);
    await limiter.clear();
    jest.clearAllMocks();
});

describe('key derivation', () => {
    test('one account, one budget, whatever the caller capitalises', () => {
        // Sign-in resolves the account on a lowercased address. If the budget
        // keyed on the raw string, holding down shift would mint a fresh one.
        expect(limiter.budgetKey('Shopper@Example.com')).toBe(EXPECTED_KEY);
        expect(limiter.budgetKey('  SHOPPER@EXAMPLE.COM  ')).toBe(EXPECTED_KEY);
    });

    test('keeps caller-supplied text out of the keyspace', () => {
        // The value arrives on an unauthenticated endpoint. Hashing stops
        // arbitrary input becoming a Redis key name, and stops a
        // `SCAN auth:otp-budget:*` returning a list of customer addresses.
        expect(limiter.budgetKey(EMAIL)).not.toContain(EMAIL);
        expect(limiter.budgetKey(EMAIL)).toMatch(REDIS_KEY_PATTERN);
    });

    test('distinct addresses do not share a budget', () => {
        expect(limiter.budgetKey('a@example.com'))
            .not.toBe(limiter.budgetKey('b@example.com'));
    });

    test('a missing address still produces a usable key', () => {
        expect(limiter.budgetKey(undefined)).toMatch(REDIS_KEY_PATTERN);
        expect(limiter.budgetKey(null)).toMatch(REDIS_KEY_PATTERN);
    });
});

describe('consuming the budget', () => {
    test('allows exactly OTP_REQUEST_MAX requests, then refuses', async () => {
        withCountingRedis();

        for (let attempt = 1; attempt <= limiter.OTP_REQUEST_MAX; attempt++) {
            const result = await limiter.consume(EMAIL);
            expect(result.allowed).toBe(true);
            expect(result.count).toBe(attempt);
        }

        const refused = await limiter.consume(EMAIL);
        expect(refused.allowed).toBe(false);
        expect(refused.count).toBe(limiter.OTP_REQUEST_MAX + 1);
    });

    test('keeps counting past the limit', async () => {
        // Consuming on the refused request too is deliberate: if the counter
        // stopped moving, a caller parked on a refused address would get a free
        // attempt on every window boundary.
        withCountingRedis();

        for (let i = 0; i < limiter.OTP_REQUEST_MAX + 3; i++) {
            await limiter.consume(EMAIL);
        }

        const result = await limiter.consume(EMAIL);
        expect(result.count).toBe(limiter.OTP_REQUEST_MAX + 4);
        expect(result.allowed).toBe(false);
    });

    test('budgets are per address', async () => {
        const counts = withCountingRedis();

        for (let i = 0; i <= limiter.OTP_REQUEST_MAX; i++) {
            await limiter.consume('victim@example.com');
        }

        // Exhausting one address must not touch another's.
        const other = await limiter.consume('bystander@example.com');
        expect(other.allowed).toBe(true);
        expect(other.count).toBe(1);
        expect(counts.size).toBe(2);
    });

    test('passes the window to Redis so the counter can expire itself', async () => {
        withCountingRedis();

        await limiter.consume(EMAIL);

        expect(redis.eval).toHaveBeenCalledWith(
            expect.stringContaining('PEXPIRE'),
            1,
            EXPECTED_KEY,
            limiter.OTP_REQUEST_WINDOW_MS
        );
    });

    test('reports a reset delay even when Redis returns a nonsense TTL', async () => {
        redis.eval.mockResolvedValue([1, -1]);

        const result = await limiter.consume(EMAIL);

        expect(result.resetInMs).toBe(limiter.OTP_REQUEST_WINDOW_MS);
    });
});

describe('releasing the budget', () => {
    test('drops the key so a redeemed code does not cost the next attempt', async () => {
        await limiter.release(EMAIL);
        expect(redis.del).toHaveBeenCalledWith(EXPECTED_KEY);
    });

    test('a failing del is logged, not thrown', async () => {
        redis.del.mockRejectedValue(new Error('connection reset'));

        await expect(limiter.release(EMAIL)).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalled();
    });
});

describe('when Redis is unreachable', () => {
    test('falls back to counting in process rather than refusing everyone', async () => {
        // Refusing every request during a cache outage would take password
        // reset down for the whole site. Counting imprecisely is the lesser
        // failure, and is what this code did before the counters moved.
        redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));

        for (let attempt = 1; attempt <= limiter.OTP_REQUEST_MAX; attempt++) {
            const result = await limiter.consume(EMAIL);
            expect(result.allowed).toBe(true);
            expect(result.count).toBe(attempt);
        }

        const refused = await limiter.consume(EMAIL);
        expect(refused.allowed).toBe(false);
    });

    test('says so in the log, once per minute rather than per request', async () => {
        redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));

        await limiter.consume(EMAIL);
        await limiter.consume('another@example.com');
        await limiter.consume('third@example.com');

        // An outage that logs on every request buries everything else in the
        // log for as long as it lasts.
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toMatch(/per-process/);
    });

    test('a non-numeric reply is treated as an outage, not as zero', async () => {
        // `Number(undefined)` is NaN, and NaN <= max is false -- so a garbled
        // reply would silently refuse the request if it were trusted.
        redis.eval.mockResolvedValue(['not-a-number', 'also-not']);

        const result = await limiter.consume(EMAIL);

        expect(result.allowed).toBe(true);
        expect(result.count).toBe(1);
    });

    test('the fallback still expires, so an address is not barred for good', async () => {
        redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));

        for (let i = 0; i <= limiter.OTP_REQUEST_MAX; i++) {
            await limiter.consume(EMAIL);
        }
        expect((await limiter.consume(EMAIL)).allowed).toBe(false);

        // Step past the window. The record is dropped on read rather than
        // waiting for a sweep, which the Map this replaced did not do.
        const realNow = Date.now;
        Date.now = () => realNow() + limiter.OTP_REQUEST_WINDOW_MS + 1;
        try {
            const afterWindow = await limiter.consume(EMAIL);
            expect(afterWindow.allowed).toBe(true);
            expect(afterWindow.count).toBe(1);
        } finally {
            Date.now = realNow;
        }
    });
});

describe('clear', () => {
    test('SCANs rather than KEYS, so it cannot block a shared Redis', async () => {
        redis.scan
            .mockResolvedValueOnce(['7', ['auth:otp-budget:aa']])
            .mockResolvedValueOnce(['0', ['auth:otp-budget:bb']]);

        await limiter.clear();

        expect(redis.scan).toHaveBeenCalledTimes(2);
        expect(redis.scan.mock.calls[0]).toEqual(
            ['0', 'MATCH', 'auth:otp-budget:*', 'COUNT', expect.any(Number)]
        );
        expect(redis.del).toHaveBeenCalledWith('auth:otp-budget:aa');
        expect(redis.del).toHaveBeenCalledWith('auth:otp-budget:bb');
    });
});
