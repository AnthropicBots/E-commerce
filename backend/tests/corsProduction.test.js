const express = require('express');
const supertest = require('supertest');
const corsMiddleware = require('../middleware/corsMiddleware');
const appConfig = require('../config/appConfig');

describe('Production CORS Whitelist Integration', () => {
    const PRODUCTION_ORIGIN = 'https://ecommerce.vercel.app';

    test('allowedOrigins list in appConfig contains production origin', () => {
        expect(appConfig.allowedOrigins).toContain(PRODUCTION_ORIGIN);
    });

    test('allows requests from production origin https://ecommerce.vercel.app', async () => {
        const app = express();
        app.use(corsMiddleware);
        app.get('/api/test-cors', (req, res) => {
            res.status(200).json({ success: true, message: 'CORS OK' });
        });

        const response = await supertest(app)
            .get('/api/test-cors')
            .set('Origin', PRODUCTION_ORIGIN);

        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe(PRODUCTION_ORIGIN);
        expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    test('allows OPTIONS preflight requests from production origin https://ecommerce.vercel.app', async () => {
        const app = express();
        app.use(corsMiddleware);
        app.options('/api/test-cors', (req, res) => {
            res.sendStatus(204);
        });

        const response = await supertest(app)
            .options('/api/test-cors')
            .set('Origin', PRODUCTION_ORIGIN)
            .set('Access-Control-Request-Method', 'GET');

        expect(response.headers['access-control-allow-origin']).toBe(PRODUCTION_ORIGIN);
    });

    test('rejects requests from unallowed origin', async () => {
        const app = express();
        app.use(corsMiddleware);
        app.get('/api/test-cors', (req, res) => {
            res.status(200).json({ success: true });
        });
        // Error handler for CORS rejection
        app.use((err, req, res, next) => {
            if (err.message === 'CORS not allowed') {
                return res.status(403).json({ success: false, message: err.message });
            }
            next(err);
        });

        const response = await supertest(app)
            .get('/api/test-cors')
            .set('Origin', 'https://unallowed-malicious-site.com');

        expect(response.status).toBe(403);
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
});
