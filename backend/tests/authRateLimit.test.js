const express = require('express');
const supertest = require('supertest');
const { authLimiter } = require('../middleware/authLimiter');
const appConfig = require('../config/appConfig');

describe('Auth Rate Limiter Configuration and Behavior', () => {
    test('appConfig defines auth rate limit max as 20 requests per 15 minutes', () => {
        expect(appConfig.authRateLimit).toBeDefined();
        expect(appConfig.authRateLimit.max).toBe(20);
        expect(appConfig.authRateLimit.windowMs).toBe(15 * 60 * 1000);
    });

    test('returns HTTP 429 response after 20 attempts on auth routes', async () => {
        const app = express();
        app.use('/auth', authLimiter);
        app.get('/auth/login', (req, res) => {
            res.status(200).json({ success: true, message: 'Login endpoint' });
        });

        // First 20 requests should pass
        for (let i = 0; i < 20; i++) {
            const res = await supertest(app).get('/auth/login');
            expect(res.status).toBe(200);
        }

        // The 21st request must trigger a 429 Too Many Requests response
        const rateLimitedResponse = await supertest(app).get('/auth/login');
        expect(rateLimitedResponse.status).toBe(429);
        expect(rateLimitedResponse.body).toEqual(expect.objectContaining({
            success: false,
            errorCode: 'AUTH_RATE_LIMIT_EXCEEDED'
        }));
    });
});
