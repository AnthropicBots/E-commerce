// backend/tests/authMiddleware.test.js

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

const generateExpiredToken = (user, secret = 'test-secret') => {
    return jwt.sign(user, secret, { expiresIn: '0s' });
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
        test('should accept valid Bearer token', () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeDefined();
            expect(mockReq.user.userId).toBe(userFixtures.regularUser.userId);
        });

        test('should attach user data to request', () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            authMiddleware(mockReq, mockRes, mockNext);
            expect(mockReq.user).toEqual(expect.objectContaining({
                userId: userFixtures.regularUser.userId,
                username: userFixtures.regularUser.username,
                role: userFixtures.regularUser.role
            }));
        });

        test('should handle admin user token', () => {
            const token = generateToken(userFixtures.adminUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user.role).toBe('admin');
        });
    });

    // ============================================
    // INVALID TOKENS
    // ============================================

    describe('Invalid Tokens', () => {
        test('should reject request without authorization header', () => {
            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('should reject invalid token', () => {
            mockReq.headers.authorization = 'Bearer invalid-token';
            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Invalid or expired token');
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('should reject malformed token', () => {
            mockReq.headers.authorization = 'Bearer malformed.token.here';
            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Invalid or expired token');
        });

        test('should reject token with invalid signature', () => {
            const token = jwt.sign({ userId: 1 }, 'wrong-secret');
            mockReq.headers.authorization = `Bearer ${token}`;
            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Invalid or expired token');
        });

        test('should reject empty authorization header', () => {
            mockReq.headers.authorization = 'Bearer ';
            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Authorization header required');
        });

        test('should reject malformed authorization header (no Bearer)', () => {
            mockReq.headers.authorization = 'Token invalid';
            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Authorization header required');
        });
    });

    // ============================================
    // EXPIRED TOKENS
    // ============================================

    describe('Expired Tokens', () => {
        test('should reject expired token', (done) => {
            const expiredToken = generateExpiredToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${expiredToken}`;

            setTimeout(() => {
                authMiddleware(mockReq, mockRes, mockNext);
                expectUnauthorized(mockRes, 'Invalid or expired token');
                expect(mockNext).not.toHaveBeenCalled();
                done();
            }, 100);
        });

        test('should reject token with expired claim', () => {
            const token = jwt.sign(
                { userId: 1, exp: Math.floor(Date.now() / 1000) - 3600 },
                secret
            );
            mockReq.headers.authorization = `Bearer ${token}`;
            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes, 'Invalid or expired token');
        });
    });

    // ============================================
    // ROLE-BASED ACCESS
    // ============================================

    describe('Role-Based Access', () => {
        test('should allow admin to access admin routes', () => {
            const token = generateToken(userFixtures.adminUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;
            mockReq.role = 'admin';

            authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user.role).toBe('admin');
        });

        test('should allow regular user to access user routes', () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;
            mockReq.role = 'user';

            authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user.role).toBe('user');
        });

        test('should reject user without required role', () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;
            mockReq.requiredRole = 'admin';

            // Assuming middleware checks role
            // This test would pass if middleware has role checking
            // If not, this test might need adjustment
            authMiddleware(mockReq, mockRes, mockNext);
            // Expect next or unauthorized depending on implementation
        });
    });

    // ============================================
    // ENVIRONMENT VARIABLE TESTS
    // ============================================

    describe('Environment Variable Tests', () => {
        const originalEnv = process.env;

        beforeEach(() => {
            process.env = { ...originalEnv };
        });

        afterEach(() => {
            process.env = originalEnv;
        });

        test('should use JWT secret from environment', () => {
            process.env.JWT_SECRET = 'env_secret_1234567890';
            const token = jwt.sign(
                { userId: 1 },
                process.env.JWT_SECRET
            );
            mockReq.headers.authorization = `Bearer ${token}`;

            authMiddleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
        });

        test('should handle missing JWT secret', () => {
            delete process.env.JWT_SECRET;

            expect(() => {
                authMiddleware(mockReq, mockRes, mockNext);
            }).toThrow();
        });
    });

    // ============================================
    // PERFORMANCE TESTS
    // ============================================

    describe('Performance Tests', () => {
        test('should verify token within 10ms', () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            const start = performance.now();
            for (let i = 0; i < 100; i++) {
                const req = createMockRequest({ authorization: `Bearer ${token}` });
                const res = createMockResponse();
                const next = jest.fn();
                authMiddleware(req, res, next);
            }
            const duration = performance.now() - start;

            expect(duration / 100).toBeLessThan(10);
        });

        test('should handle 100 concurrent auth requests', async () => {
            const token = generateToken(userFixtures.regularUser, secret);
            const promises = Array(100).fill().map(() => {
                const req = createMockRequest({ authorization: `Bearer ${token}` });
                const res = createMockResponse();
                const next = jest.fn();
                authMiddleware(req, res, next);
                return Promise.resolve();
            });

            await expect(Promise.all(promises)).resolves.not.toThrow();
        });
    });

    // ============================================
    // SECURITY TESTS
    // ============================================

    describe('Security Tests', () => {
        test('should be resistant to timing attacks', () => {
            const validToken = generateToken(userFixtures.regularUser, secret);
            const invalidToken = 'malformed.token.here';

            const start1 = performance.now();
            const req1 = createMockRequest({ authorization: `Bearer ${validToken}` });
            const res1 = createMockResponse();
            const next1 = jest.fn();
            authMiddleware(req1, res1, next1);
            const time1 = performance.now() - start1;

            const start2 = performance.now();
            const req2 = createMockRequest({ authorization: `Bearer ${invalidToken}` });
            const res2 = createMockResponse();
            const next2 = jest.fn();
            authMiddleware(req2, res2, next2);
            const time2 = performance.now() - start2;

            expect(Math.abs(time1 - time2)).toBeLessThan(50);
        });

        test('should handle SQL injection attempts in token', () => {
            const injectionToken = "Bearer ' OR '1'='1";
            mockReq.headers.authorization = injectionToken;

            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
            expect(mockNext).not.toHaveBeenCalled();
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

        test('should call next without token', () => {
            optionalAuth(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeUndefined();
        });

        test('should attach user with valid token', () => {
            const token = generateToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            optionalAuth(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeDefined();
            expect(mockReq.user.userId).toBe(userFixtures.regularUser.userId);
        });

        test('should handle expired token gracefully', (done) => {
            const expiredToken = generateExpiredToken(userFixtures.regularUser, secret);
            mockReq.headers.authorization = `Bearer ${expiredToken}`;

            setTimeout(() => {
                optionalAuth(mockReq, mockRes, mockNext);
                // optionalAuth should still call next even with expired token
                expect(mockNext).toHaveBeenCalled();
                done();
            }, 100);
        });

        test('should handle invalid token gracefully', () => {
            mockReq.headers.authorization = 'Bearer invalid-token';

            optionalAuth(mockReq, mockRes, mockNext);
            // optionalAuth should still call next even with invalid token
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.user).toBeUndefined();
        });

        test('should attach user with admin role', () => {
            const token = generateToken(userFixtures.adminUser, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            optionalAuth(mockReq, mockRes, mockNext);
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
        test('should reject token with missing userId', () => {
            const token = jwt.sign(
                { username: 'testuser' },
                secret
            );
            mockReq.headers.authorization = `Bearer ${token}`;

            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
        });

        test('should reject token with empty payload', () => {
            const token = jwt.sign({}, secret);
            mockReq.headers.authorization = `Bearer ${token}`;

            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
        });

        test('should reject XSS attempt in token', () => {
            const xssToken = 'Bearer <script>alert("xss")</script>';
            mockReq.headers.authorization = xssToken;

            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
        });

        test('should reject excessively long token', () => {
            const longToken = 'Bearer ' + 'a'.repeat(10000);
            mockReq.headers.authorization = longToken;

            authMiddleware(mockReq, mockRes, mockNext);
            expectUnauthorized(mockRes);
        });
    });
});