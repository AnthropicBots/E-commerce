// backend/tests/loginLockoutService.test.js
//
// The shared half of the lockout (#1365): what the service actually asks Redis
// to do, and that the account identity it keys on cannot be varied by the
// caller. The policy itself is pinned in loginLockout.test.js.

jest.mock('../config/redis', () => ({
    eval: jest.fn().mockResolvedValue(0),
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
const {
    isLoginLocked,
    recordLoginFailure,
    resetLoginAttempts,
    lockoutKey,
    MAX_LOGIN_ATTEMPTS,
    LOGIN_LOCKOUT_DURATION,
    LOGIN_ATTEMPT_WINDOW
} = require('../services/loginLockoutService');

const EMAIL = 'user@example.com';
const EXPECTED_KEY =
    `auth:lockout:${crypto.createHash('sha256').update(EMAIL).digest('hex')}`;

beforeEach(() => {
    jest.clearAllMocks();
    redis.eval.mockResolvedValue(0);
    redis.del.mockResolvedValue(1);
});

describe('lockout key derivation', () => {
    test('normalises case and surrounding whitespace to one account', () => {
        expect(lockoutKey('User@Example.com')).toBe(EXPECTED_KEY);
        expect(lockoutKey('  USER@EXAMPLE.COM  ')).toBe(EXPECTED_KEY);
    });

    test('keeps the raw identifier out of the keyspace', () => {
        // The value arrives on a public endpoint, so it is hashed rather than
        // interpolated: nothing attacker-supplied lands in a key name, and a
        // SCAN of the namespace does not enumerate customer addresses.
        expect(lockoutKey(EMAIL)).not.toContain(EMAIL);
        expect(lockoutKey(EMAIL)).toMatch(/^auth:lockout:[0-9a-f]{64}$/);
    });

    test('different accounts never collide', () => {
        expect(lockoutKey('a@example.com')).not.toBe(lockoutKey('b@example.com'));
    });
});

describe('recordLoginFailure', () => {
    test('applies the configured threshold, window and lockout duration', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));

        await recordLoginFailure(EMAIL);

        const [script, keyCount, key, now, window, maxAttempts, lockoutMs] =
            redis.eval.mock.calls[0];

        expect(keyCount).toBe(1);
        expect(key).toBe(EXPECTED_KEY);
        expect(now).toBe(Date.now());
        expect(window).toBe(LOGIN_ATTEMPT_WINDOW);
        expect(maxAttempts).toBe(MAX_LOGIN_ATTEMPTS);
        expect(lockoutMs).toBe(LOGIN_LOCKOUT_DURATION);
        // The record must carry an expiry of its own; the old in-memory map
        // relied on a sweeper interval that a shared store does not have.
        expect(script).toMatch(/PEXPIRE/);

        jest.useRealTimers();
    });

    test('reads and writes the counter in a single atomic step', async () => {
        await recordLoginFailure(EMAIL);

        // Two instances racing on the same account must not each read four
        // failures and write five.
        expect(redis.eval).toHaveBeenCalledTimes(1);
    });

    test('sends no attempt count of its own, so a restart cannot reset the tally', async () => {
        await recordLoginFailure(EMAIL);
        await recordLoginFailure(EMAIL);

        // The running total is read and advanced inside Redis; this process
        // contributes only the clock and the policy constants, which is what
        // makes the count outlive the process that started it.
        const [first, second] = redis.eval.mock.calls;
        expect(first[2]).toBe(second[2]);
        expect(first.slice(4)).toEqual([
            LOGIN_ATTEMPT_WINDOW,
            MAX_LOGIN_ATTEMPTS,
            LOGIN_LOCKOUT_DURATION
        ]);
    });
});

describe('isLoginLocked', () => {
    test('reports a lock when the shared record says so', async () => {
        redis.eval.mockResolvedValue(1);

        expect(await isLoginLocked(EMAIL)).toBe(true);
        expect(redis.eval.mock.calls[0][2]).toBe(EXPECTED_KEY);
    });

    test('reports no lock otherwise', async () => {
        redis.eval.mockResolvedValue(0);

        expect(await isLoginLocked(EMAIL)).toBe(false);
    });

    test('an unknown account is not locked', async () => {
        redis.eval.mockResolvedValue(0);

        expect(await isLoginLocked('nobody@example.com')).toBe(false);
    });
});

describe('resetLoginAttempts', () => {
    test('a successful sign-in removes the shared counter', async () => {
        await resetLoginAttempts(EMAIL);

        expect(redis.del).toHaveBeenCalledWith(EXPECTED_KEY);
    });

    test('clears the counter for the normalised account, not the typed string', async () => {
        await resetLoginAttempts('  User@Example.com ');

        expect(redis.del).toHaveBeenCalledWith(EXPECTED_KEY);
    });
});

describe('when Redis is unavailable', () => {
    const outage = new Error('ECONNREFUSED');

    // The reporting assertion lives on the first case to reach the degraded
    // path, because the warning is throttled per process to keep a sustained
    // outage from flooding the log.
    test('sign-in is not blocked wholesale, and the degradation is reported', async () => {
        redis.eval.mockRejectedValue(outage);

        // Failing closed here would lock every customer out of the site for the
        // duration of a cache outage.
        await expect(isLoginLocked(EMAIL)).resolves.toBe(false);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toMatch(/per-process/);
    });

    test('failures are still counted, in this process', async () => {
        redis.eval.mockRejectedValue(outage);

        for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
            await recordLoginFailure(EMAIL);
        }

        expect(await isLoginLocked(EMAIL)).toBe(true);
    });

    test('a reset does not throw out of the sign-in path', async () => {
        redis.del.mockRejectedValue(outage);

        await expect(resetLoginAttempts(EMAIL)).resolves.toBeUndefined();
    });
});
