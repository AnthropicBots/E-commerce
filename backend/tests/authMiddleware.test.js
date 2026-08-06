// backend/tests/authMiddleware.test.js

// authMiddleware checks each token against the revocation list, which lives in
// Redis (#1261), so this suite was reaching for a Redis that is not running.
// services/refreshTokenService.js flips a `redisReady` flag from the resolution
// of a connect() that never resolves here, and which side of that flag a given
// request landed on depended on machine load: under a full parallel run every
// valid-token case in this file would occasionally fail at once, with `next`
// uncalled and `req.user` undefined, as though a good token had been rejected
// (#1444).
//
// This suite is about JWT verification. Whether Redis is up is not part of that
// question, so it is taken out of the picture -- an empty revocation list is
// the right default, and the suites that test revocation mock the specific
// commands they need.
jest.mock('../config/redis', () => {
    const { createRedisMock } = require('./helpers/redisMock');
    return createRedisMock();
});

const { authMiddleware, optionalAuth } = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

// ============================================
// TEST FIXTURES
// ============================================

const userFixtures = {
    adminUser: {
        userId: 1,
        username: 'admin',
        role: 'admin',
        permissions: ['create', 'read', 'update', 'delete'],
        email: 'admin@example.com'
    },
    regularUser: {
        userId: 2,
        username: 'user',
        role: 'user',
        permissions: ['read'],
        email: 'user@example.com'
    },
    guestUser: {
        userId: 3,
        username: 'guest',
        role: 'guest',
        permissions: [],
        email: 'guest@example.com'
    },
    premiumUser: {
        userId: 4,
        username: 'premium',
        role: 'premium',
        permissions: ['read', 'write'],
        email: 'premium@example.com'
    }
};

// ============================================
// TEST FACTORIES
// ============================================

const createMockRequest = (headers = {}) => ({
    headers,
    params: {},
    query: {},
    body: {},
    ip: '127.0.0.1'
});

const createMockResponse = () => {
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        setHeader: jest.fn().mockReturnThis(),
        locals: {}
    };
    return res;
};

const createAuthRequest = (token, options = {}) => {
    const headers = {
        authorization: token ? `Bearer ${token}` : undefined,
        ...options.headers
    };
    return createMockRequest(headers);
};

const generateToken = (user, secret = 'test-secret', expiresIn = '1h') => {
    return jwt.sign(user, secret, { expiresIn });
};

// '-1s', not '0s'. jwt.verify refuses a token once the clock is *past* `exp`,
// so a token that expires at the instant it is issued is not yet expired when
// it is checked. The two callers each papered over that differently -- one with
// a 100ms setTimeout, the other by hand-writing an `exp` an hour in the past --
// and the first of those was a flake, not a fix (#1444).
const generateExpiredToken = (user, secret = 'test-secret') => {
    return jwt.sign(user, secret, { expiresIn: '-1s' });
};

// ============================================
// ASSERTION HELPERS
// ============================================

const expectUnauthorized = (res, message = 'Authorization header required') => {
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
        success: false,
        message
    });
};

const expectForbidden = (res, message = 'Insufficient permissions') => {
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
        success: false,
        message
    });
};

// ============================================
// TEST SUITE
// ============================================

describe('Auth Middleware Tests', () => {
    const secret = 'test-secret';
    let mockReq, mockRes, mockNext;

    // ============================================
    // TEST HOOKS
    // ============================================

    beforeAll(() => {
        console.log('Starting Auth Middleware Tests...');
    });

    beforeEach(() => {
        mockReq = { headers: {} };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        mockNext = jest.fn();
        // Set JWT secret for tests
        process.env.JWT_SECRET = secret;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        console.log('Auth Middleware Tests completed.');
    });

    // ============================================
    // VALID TOKENS
    // ============================================

    describe('Valid Tokens', () => {
        test('should accept valid Bearer token', async () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            await authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeDefined();
            expect(mockReq.user.userId).toBe(userFixtures.regularUser.userId);
        });

        test('should attach user data to request', async () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            await authMiddleware(mockReq, mockRes, mockNext);
            expect(mockReq.user).toEqual(expect.objectContaining({
                userId: userFixtures.regularUser.userId,
                username: userFixtures.regularUser.username,
                role: userFixtures.regularUser.role
            }));
        });

        test('should handle admin user token', async () => {
            const token = generateToken(userFixtures.adminUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            await authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user.role).toBe('admin');
        });
    });

    // ============================================
    // INVALID TOKENS
    // ============================================

    describe('Invalid Tokens', () => {
        test('should reject request without authorization header', async () => {
            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('should reject invalid token', async () => {
            mockReq.headers.authorization = 'Bearer invalid-token';
            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Invalid or expired token');
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('should reject malformed token', async () => {
            mockReq.headers.authorization = 'Bearer malformed.token.here';
            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Invalid or expired token');
        });

        test('should reject token with invalid signature', async () => {
            const token = jwt.sign({ userId: 1 }, 'wrong-secret');
            mockReq.headers.authorization = `Bearer ${token}`;
            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Invalid or expired token');
        });

        test('should reject empty authorization header', async () => {
            mockReq.headers.authorization = 'Bearer ';
            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Authorization header required');
        });

        test('should reject malformed authorization header (no Bearer)', async () => {
            mockReq.headers.authorization = 'Token invalid';
            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Authorization header required');
        });
    });

    // ============================================
    // EXPIRED TOKENS
    // ============================================

    describe('Expired Tokens', () => {
        test('should reject expired token', async () => {
            const expiredToken = generateExpiredToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${expiredToken}`;

            // Was a setTimeout + done() waiting 100ms for a token minted with
            // `expiresIn: '0s'` to become expired. Awaiting the middleware is
            // what this actually needed, and the token is now unambiguously in
            // the past, so there is nothing left to wait for.
            await authMiddleware(mockReq, mockRes, mockNext);

            expectUnauthorized(mockRes, 'Invalid or expired token');
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('should reject token with expired claim', async () => {
            const token = jwt.sign(
                { userId: 1, exp: Math.floor(Date.now() / 1000) - 3600 },
                secret
            );
            mockReq.headers.authorization = `Bearer ${token}`;
            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Invalid or expired token');
        });
    });

    // ============================================
    // ROLE-BASED ACCESS
    // ============================================

    describe('Role-Based Access', () => {
        test('should allow admin to access admin routes', async () => {
            const token = generateToken(userFixtures.adminUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;
            mockReq.role = 'admin';

            await authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user.role).toBe('admin');
        });

        test('should allow regular user to access user routes', async () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;
            mockReq.role = 'user';

            await authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user.role).toBe('user');
        });

        test('should reject user without required role', async () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;
            mockReq.requiredRole = 'admin';

            // Assuming middleware checks role
            // This test would pass if middleware has role checking
            // If not, this test might need adjustment
            await authMiddleware(mockReq, mockRes, mockNext);
            // Expect next or unauthorized depending on implementation
        });
    });

    // ============================================
    // ENVIRONMENT VARIABLE TESTS
    // ============================================

    describe('Environment Variable Tests', () => {
        // Restore by key rather than by reassigning `process.env`.
        //
        // `process.env = { ...originalEnv }` followed by
        // `process.env = originalEnv` looks symmetrical and is not: assigning
        // to process.env replaces Node's env store, and the saved reference no
        // longer restores what was there. JWT_SECRET therefore stayed deleted
        // after this block, and the next suite to call the middleware failed
        // with "JWT_SECRET environment variable is required" -- a failure two
        // describes away from its cause (#1444).
        let savedSecret;

        beforeEach(() => {
            savedSecret = process.env.JWT_SECRET;
        });

        afterEach(() => {
            if (savedSecret === undefined) {
                delete process.env.JWT_SECRET;
            } else {
                process.env.JWT_SECRET = savedSecret;
            }
        });

        test('should use JWT secret from environment', async () => {
            process.env.JWT_SECRET = 'env_secret_1234567890';
            const token = jwt.sign(
                { userId: 1 },
                process.env.JWT_SECRET
            );
            mockReq.headers.authorization = `Bearer ${token}`;

            await authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
        });

        test('should handle missing JWT secret', async () => {
            delete process.env.JWT_SECRET;

            // `authMiddleware` is async, so it returns a rejected promise
            // rather than throwing synchronously. The old `expect(fn).toThrow()`
            // could never see that: it reported "did not throw" and left the
            // rejection unhandled, which crashed the worker outright when this
            // test was run on its own.
            await expect(
                authMiddleware(mockReq, mockRes, mockNext)
            ).rejects.toThrow('JWT_SECRET environment variable is required');

            expect(mockNext).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // PERFORMANCE TESTS
    // ============================================

    describe('Performance Tests', () => {
        test('should verify token within 10ms', async () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            // Awaited, because authMiddleware is async: the loop below used to
            // fire and forget, so `duration` measured how long it takes to
            // *start* a hundred verifications, not to finish them, and the
            // assertion passed no matter how slow verification actually was.
            //
            // The hundred stray promises then resolved during whichever tests
            // happened to be running next, which is where the intermittent
            // failures in this file came from (#1444).
            const start = performance.now();
            for (let i = 0; i < 100; i++) {
                const req = createMockRequest({ authorization: `Bearer ${token}` });
                const res = createMockResponse();
                const next = jest.fn();
                await authMiddleware(req, res, next);
            }
            const duration = performance.now() - start;

            expect(duration / 100).toBeLessThan(10);
        });

        test('should handle 100 concurrent auth requests', async () => {
            const token = generateToken(userFixtures.regularUser, secret);

            // The middleware's own promises, not a hundred already-resolved
            // stand-ins. `Promise.resolve()` could never have failed, so this
            // case asserted nothing about concurrency.
            const results = Array(100).fill().map(() => {
                const req = createMockRequest({ authorization: `Bearer ${token}` });
                const res = createMockResponse();
                const next = jest.fn();
                return authMiddleware(req, res, next).then(() => next);
            });

            const nexts = await Promise.all(results);

            expect(nexts).toHaveLength(100);
            expect(nexts.every((next) => next.mock.calls.length === 1)).toBe(true);
        });
    });

    // ============================================
    // SECURITY TESTS
    // ============================================

    describe('Security Tests', () => {
        test('should be resistant to timing attacks', async () => {
            const validToken = generateToken(userFixtures.regularUser, secret);
            const invalidToken = 'malformed.token.here';

            // Awaited for the same reason as the performance case above:
            // unawaited, both timings measured the synchronous prologue of an
            // async function and were always within a hair of each other, so
            // the comparison could not have detected a timing leak.
            const start1 = performance.now();
            const req1 = createMockRequest({ authorization: `Bearer ${validToken}` });
            const res1 = createMockResponse();
            const next1 = jest.fn();
            await authMiddleware(req1, res1, next1);
            const time1 = performance.now() - start1;

            const start2 = performance.now();
            const req2 = createMockRequest({ authorization: `Bearer ${invalidToken}` });
            const res2 = createMockResponse();
            const next2 = jest.fn();
            await authMiddleware(req2, res2, next2);
            const time2 = performance.now() - start2;

            expect(Math.abs(time1 - time2)).toBeLessThan(50);
        });

        test('should handle SQL injection attempts in token', async () => {
            const injectionToken = "Bearer ' OR '1'='1";
            mockReq.headers.authorization = injectionToken;

            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
            expect(mockNext).not.toHaveBeenCalled();
        });

        // #1444. The injection heuristic also matched `--`, which is a SQL
        // comment and is equally a pair of ordinary base64url characters. Just
        // under 1% of tokens contain it somewhere, and every one of those was
        // answered "Authorization header required" -- indistinguishable from
        // sending no token at all.
        //
        // This is why the suite failed intermittently: `jwt.sign` produces a
        // fresh signature each run, so which run happened to mint a token
        // containing `--` was luck. Pinned deterministically here rather than
        // left to a random draw.
        test('accepts a valid token whose base64url contains a double hyphen', async () => {
            // Mint until the encoding contains `--`. Signature bytes are
            // effectively random, so this finds one in a few dozen attempts.
            let token = null;
            for (let i = 0; i < 5000 && token === null; i++) {
                const candidate = jwt.sign({ userId: 1, seq: i }, secret);
                if (candidate.includes('--')) token = candidate;
            }

            expect(token).not.toBeNull();

            mockReq.headers.authorization = `Bearer ${token}`;
            await authMiddleware(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(mockReq.user.userId).toBe(1);
        });

        test('rejects an invalid-signature token containing a double hyphen for the right reason', async () => {
            let token = null;
            for (let i = 0; i < 5000 && token === null; i++) {
                const candidate = jwt.sign({ userId: 1, seq: i }, 'wrong-secret');
                if (candidate.includes('--')) token = candidate;
            }

            expect(token).not.toBeNull();

            mockReq.headers.authorization = `Bearer ${token}`;
            await authMiddleware(mockReq, mockRes, mockNext);

            // "Invalid or expired token" -- the signature failed. Not
            // "Authorization header required", which claims nothing was sent.
            expectUnauthorized(mockRes, 'Invalid or expired token');
        });
    });

    // ============================================
    // OPTIONAL AUTH TESTS
    // ============================================

    describe('optionalAuth', () => {
        let mockReq, mockRes, mockNext;

        beforeEach(() => {
            mockReq = { headers: {} };
            mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            mockNext = jest.fn();
        });

        test('should call next without token', async () => {
            await optionalAuth(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeUndefined();
        });

        test('should attach user with valid token', async () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            await optionalAuth(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeDefined();
            expect(mockReq.user.userId).toBe(userFixtures.regularUser.userId);
        });

        test('should handle expired token gracefully', async () => {
            const expiredToken = generateExpiredToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${expiredToken}`;

            await optionalAuth(mockReq, mockRes, mockNext);

            // optionalAuth should still call next even with expired token
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeUndefined();
        });

        test('should handle invalid token gracefully', async () => {
            mockReq.headers.authorization = 'Bearer invalid-token';

            await optionalAuth(mockReq, mockRes, mockNext);
            // optionalAuth should still call next even with invalid token
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeUndefined();
        });

        test('should attach user with admin role', async () => {
            const token = generateToken(userFixtures.adminUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            await optionalAuth(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeDefined();
            expect(mockReq.user.role).toBe('admin');
        });
    });

    // ============================================
    // INTEGRATION TESTS WITH EXPRESS
    // ============================================

    describe('Integration Tests with Express', () => {
        let app;
        let server;

        beforeAll(() => {
            app = express();
            app.use(express.json());

            app.get('/protected', authMiddleware, (req, res) => {
                res.json({ success: true, user: req.user });
            });

            app.get('/optional', optionalAuth, (req, res) => {
                res.json({ success: true, user: req.user || null });
            });

            app.get('/admin', authMiddleware, (req, res) => {
                if (req.user.role !== 'admin') {
                    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
                }
                res.json({ success: true, user: req.user });
            });

            server = app.listen(0);
        });

        afterAll(() => {
            server.close();
        });

        test('should protect routes with valid token', async () => {
            const token = generateToken(userFixtures.regularUser, secret);

            const response = await request(app)
                .get('/protected')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.user).toBeDefined();
        });

        test('should reject requests without token', async () => {
            const response = await request(app)
                .get('/protected');

            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
        });

        test('should allow optional auth without token', async () => {
            const response = await request(app)
                .get('/optional');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.user).toBeNull();
        });

        test('should attach user in optional auth', async () => {
            const token = generateToken(userFixtures.regularUser, secret);

            const response = await request(app)
                .get('/optional')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.user).toBeDefined();
        });

        test('should allow admin access to admin routes', async () => {
            const token = generateToken(userFixtures.adminUser, secret);

            const response = await request(app)
                .get('/admin')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        test('should reject non-admin access to admin routes', async () => {
            const token = generateToken(userFixtures.regularUser, secret);

            const response = await request(app)
                .get('/admin')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
        });
    });

    // ============================================
    // NEGATIVE TEST CASES
    // ============================================

    describe('Negative Test Cases', () => {
        test('should reject token with missing userId', async () => {
            const token = jwt.sign(
                { username: 'testuser' },
                secret
            );
            mockReq.headers.authorization = `Bearer ${token}`;

            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
        });

        test('should reject token with empty payload', async () => {
            const token = jwt.sign({}, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
        });

        test('should reject XSS attempt in token', async () => {
            const xssToken = 'Bearer <script>alert("xss")</script>';
            mockReq.headers.authorization = xssToken;

            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
        });

        test('should reject excessively long token', async () => {
            const longToken = 'Bearer ' + 'a'.repeat(10000);
            mockReq.headers.authorization = longToken;

            await authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
        });
    });
});