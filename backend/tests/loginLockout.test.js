// backend/tests/loginLockout.test.js

// Requiring the controller pulls in modules that read env at import time
// (it throws if JWT_SECRET is unset) and constructs an Appwrite client / a
// MySQL pool. Set env and mock the heavy deps BEFORE requiring so the module
// loads offline without network or DB.
process.env.JWT_SECRET = 'test';
process.env.NODE_ENV = 'test';

jest.mock('node-appwrite', () => {
    class Client {
        setEndpoint() { return this; }
        setProject() { return this; }
        setSession() { return this; }
    }
    return {
        Client,
        Account: class { },
        Databases: class { },
        ID: { unique: () => 'test-id' }
    };
});

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

// The lockout counters live in Redis now (#1365). This suite pins the policy
// itself -- threshold, rolling window, lockout duration, clear on success -- and
// deliberately runs it against an unreachable Redis, because the per-process
// fallback that serves an outage has to enforce exactly the same policy as the
// shared path. The Redis path is covered in loginLockoutService.test.js.
//
// Only the three commands the fallback path touches reject; the rest of the
// client comes from the shared double. The partial mock that used to stand here
// had no `connect`, and services/refreshTokenService.js calls it at module
// scope, so requiring authController died with
// `TypeError: redis.connect is not a function` and the suite failed to run --
// never reaching a single assertion below (#1444).
jest.mock('../config/redis', () => {
    const { createRedisMock } = require('./helpers/redisMock');
    const client = createRedisMock();

    client.eval = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    client.del = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    client.scan = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    return client;
});

jest.mock('../config/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const { _loginGuard } = require('../controllers/authController');
const {
    isLoginLocked,
    recordLoginFailure,
    resetLoginAttempts,
    clearLoginAttempts,
    MAX_LOGIN_ATTEMPTS,
    LOGIN_LOCKOUT_DURATION,
    LOGIN_ATTEMPT_WINDOW
} = _loginGuard;

describe('Login lockout state machine', () => {
    const email = 'user@example.com';

    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        await clearLoginAttempts();
    });

    afterEach(async () => {
        await clearLoginAttempts();
        jest.useRealTimers();
    });

    test('exposes the guard helpers without touching the HTTP exports', () => {
        expect(typeof isLoginLocked).toBe('function');
        expect(typeof recordLoginFailure).toBe('function');
        expect(typeof resetLoginAttempts).toBe('function');
        expect(MAX_LOGIN_ATTEMPTS).toBe(5);
        expect(LOGIN_LOCKOUT_DURATION).toBe(15 * 60 * 1000);
        expect(LOGIN_ATTEMPT_WINDOW).toBe(15 * 60 * 1000);
    });

    test('MAX_LOGIN_ATTEMPTS - 1 failures do NOT lock the account', async () => {
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            await recordLoginFailure(email);
            expect(await isLoginLocked(email)).toBe(false);
        }
    });

    test('the MAX_LOGIN_ATTEMPTS-th failure locks the account', async () => {
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            await recordLoginFailure(email);
        }
        expect(await isLoginLocked(email)).toBe(false);

        await recordLoginFailure(email);
        expect(await isLoginLocked(email)).toBe(true);
    });

    test('a successful login before the threshold clears the counter', async () => {
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            await recordLoginFailure(email);
        }
        expect(await isLoginLocked(email)).toBe(false);

        // Success resets the counter, so it takes a full MAX run again to lock.
        await resetLoginAttempts(email);

        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            await recordLoginFailure(email);
            expect(await isLoginLocked(email)).toBe(false);
        }
        await recordLoginFailure(email);
        expect(await isLoginLocked(email)).toBe(true);
    });

    test('after the lockout window elapses, isLoginLocked returns false again', async () => {
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
            await recordLoginFailure(email);
        }
        expect(await isLoginLocked(email)).toBe(true);

        // Still locked one tick before expiry.
        jest.advanceTimersByTime(LOGIN_LOCKOUT_DURATION - 1);
        expect(await isLoginLocked(email)).toBe(true);

        // Lockout has now elapsed: login is allowed and the record is cleared.
        jest.advanceTimersByTime(2);
        expect(await isLoginLocked(email)).toBe(false);

        // A subsequent single failure must not re-lock.
        await recordLoginFailure(email);
        expect(await isLoginLocked(email)).toBe(false);
    });

    test('failures spread beyond the rolling window do not accumulate to a lock', async () => {
        // Four failures, then let the window roll off before the fifth.
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            await recordLoginFailure(email);
        }
        expect(await isLoginLocked(email)).toBe(false);

        jest.advanceTimersByTime(LOGIN_ATTEMPT_WINDOW + 1);

        // This failure starts a brand-new window rather than tripping the lock.
        await recordLoginFailure(email);
        expect(await isLoginLocked(email)).toBe(false);
    });

    test('a differently cased or padded address is the same account', async () => {
        // Sign-in resolves the account by lowercased email, so the counter has
        // to agree -- otherwise the threshold doubles for anyone who alternates.
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            await recordLoginFailure('User@Example.com');
        }
        await recordLoginFailure('  user@example.com  ');

        expect(await isLoginLocked(email)).toBe(true);
    });
});
