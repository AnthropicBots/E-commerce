// backend/tests/loyaltyRoutes.test.js

// The router pulls in authMiddleware (which throws unless JWT_SECRET is set)
// and loyaltyService (which constructs a MySQL pool at import time). Set env
// and mock both BEFORE requiring the router so it loads offline.
process.env.JWT_SECRET = 'test';
process.env.NODE_ENV = 'test';

const TEST_USER_ID = 'user-123';

// Auth passthrough that injects a fixed authenticated user.
jest.mock('../middleware/authMiddleware', () => {
    const passthrough = (req, res, next) => {
        req.user = { id: TEST_USER_ID, role: 'user' };
        next();
    };
    passthrough.authMiddleware = passthrough;
    passthrough.optionalAuth = passthrough;
    return passthrough;
});

const mockLoyaltyService = {
    getBalance: jest.fn(),
    getHistory: jest.fn(),
    redeem: jest.fn()
};

jest.mock('../services/loyaltyService', () => ({
    loyaltyService: mockLoyaltyService
}));

const express = require('express');
const request = require('supertest');
const loyaltyRoutes = require('../routes/loyaltyRoutes');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/loyalty', loyaltyRoutes);
    return app;
}

describe('loyaltyRoutes', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildApp();
    });

    describe('GET /api/loyalty/balance', () => {
        test('returns the current user balance', async () => {
            mockLoyaltyService.getBalance.mockResolvedValue({
                balance: 1500,
                lifetimePoints: 3200,
                tier: 'Silver'
            });

            const res = await request(app).get('/api/loyalty/balance');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                success: true,
                data: { balance: 1500, lifetimePoints: 3200, tier: 'Silver' }
            });
            expect(mockLoyaltyService.getBalance).toHaveBeenCalledWith(TEST_USER_ID);
        });
    });

    describe('POST /api/loyalty/redeem', () => {
        test('happy path returns the discount value', async () => {
            mockLoyaltyService.redeem.mockResolvedValue({
                pointsRedeemed: 500,
                discountValue: 5,
                balance: 1000
            });

            const res = await request(app)
                .post('/api/loyalty/redeem')
                .send({ points: 500 });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.discountValue).toBe(5);
            expect(mockLoyaltyService.redeem).toHaveBeenCalledWith(TEST_USER_ID, { points: 500 });
        });

        test('rejects non-positive-integer points with 400 before hitting the service', async () => {
            const res = await request(app)
                .post('/api/loyalty/redeem')
                .send({ points: -3 });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(mockLoyaltyService.redeem).not.toHaveBeenCalled();
        });

        test('maps insufficient-balance errors to 400 with the service message', async () => {
            const err = new Error('Insufficient points: requested 5000 but only 1000 available');
            err.code = 'INSUFFICIENT_POINTS';
            mockLoyaltyService.redeem.mockRejectedValue(err);

            const res = await request(app)
                .post('/api/loyalty/redeem')
                .send({ points: 5000 });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/Insufficient points/);
        });
    });

    describe('GET /api/loyalty/history', () => {
        test('passes validated pagination params to the service', async () => {
            mockLoyaltyService.getHistory.mockResolvedValue({
                transactions: [],
                limit: 10,
                offset: 20
            });

            const res = await request(app).get('/api/loyalty/history?limit=10&offset=20');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockLoyaltyService.getHistory).toHaveBeenCalledWith(TEST_USER_ID, {
                limit: 10,
                offset: 20
            });
        });

        test('rejects a non-integer limit with 400', async () => {
            const res = await request(app).get('/api/loyalty/history?limit=abc');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(mockLoyaltyService.getHistory).not.toHaveBeenCalled();
        });
    });
});
