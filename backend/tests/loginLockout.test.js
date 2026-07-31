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

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        clearLoginAttempts();
    });

    afterEach(() => {
        clearLoginAttempts();
        jest.useRealTimers();
    });

    test('exposes the guard helpers without touching the HTTP exports', () => {
        expect(typeof isLoginLocked).toBe('function');
        expect(typeof recordLoginFailure).toBe('function');
        expect(typeof resetLoginAttempts).toBe('function');
        expect(MAX_LOGIN_ATTEMPTS).toBe(5);
    });

    test('MAX_LOGIN_ATTEMPTS - 1 failures do NOT lock the account', () => {
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            recordLoginFailure(email);
            expect(isLoginLocked(email)).toBe(false);
        }
    });

    test('the MAX_LOGIN_ATTEMPTS-th failure locks the account', () => {
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            recordLoginFailure(email);
        }
        expect(isLoginLocked(email)).toBe(false);

        recordLoginFailure(email);
        expect(isLoginLocked(email)).toBe(true);
    });

    test('a successful login before the threshold clears the counter', () => {
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            recordLoginFailure(email);
        }
        expect(isLoginLocked(email)).toBe(false);

        // Success resets the counter, so it takes a full MAX run again to lock.
        resetLoginAttempts(email);

        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            recordLoginFailure(email);
            expect(isLoginLocked(email)).toBe(false);
        }
        recordLoginFailure(email);
        expect(isLoginLocked(email)).toBe(true);
    });

    test('after the lockout window elapses, isLoginLocked returns false again', () => {
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
            recordLoginFailure(email);
        }
        expect(isLoginLocked(email)).toBe(true);

        // Still locked one tick before expiry.
        jest.advanceTimersByTime(LOGIN_LOCKOUT_DURATION - 1);
        expect(isLoginLocked(email)).toBe(true);

        // Lockout has now elapsed: login is allowed and the record is cleared.
        jest.advanceTimersByTime(2);
        expect(isLoginLocked(email)).toBe(false);

        // A subsequent single failure must not re-lock.
        recordLoginFailure(email);
        expect(isLoginLocked(email)).toBe(false);
    });

    test('failures spread beyond the rolling window do not accumulate to a lock', () => {
        // Four failures, then let the window roll off before the fifth.
        for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
            recordLoginFailure(email);
        }
        expect(isLoginLocked(email)).toBe(false);

        jest.advanceTimersByTime(LOGIN_ATTEMPT_WINDOW + 1);

        // This failure starts a brand-new window rather than tripping the lock.
        recordLoginFailure(email);
        expect(isLoginLocked(email)).toBe(false);
    });
});
