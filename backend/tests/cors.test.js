const express = require('express');
const supertest = require('supertest');
const corsMiddleware = require('../middleware/corsMiddleware');

describe('CORS Origin Header Validation', () => {
  const ALLOWED_ORIGINS = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5501',
    'http://127.0.0.1:5501',
    'http://localhost:5502',
    'http://127.0.0.1:5502',
    'http://172.18.208.1:5500',
    'http://172.18.208.1:5501',
    'http://172.18.208.1:5502',
    'https://ecommerce.vercel.app',
    'https://e-commerce-git-main-bhuvanshs-projects.vercel.app',
    'https://www.bhuvansh.xyz',
    'null'
  ];

  const createTestApp = () => {
    const app = express();
    app.use(corsMiddleware);
    app.get('/api/test-cors', (req, res) => {
      res.status(200).json({ success: true, message: 'CORS OK' });
    });
    app.use((err, req, res, next) => {
      if (err.message && err.message.startsWith('CORS not allowed')) {
        return res.status(403).json({ success: false, message: err.message });
      }
      next(err);
    });
    return app;
  };

  describe('Allowed development origins', () => {
    ALLOWED_ORIGINS.forEach(origin => {
      test(`allows requests from allowed origin: ${origin}`, async () => {
        const app = createTestApp();
        const response = await supertest(app)
          .get('/api/test-cors')
          .set('Origin', origin);

        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
        expect(response.headers['access-control-allow-credentials']).toBe('true');
      });

      test(`allows OPTIONS preflight from allowed origin: ${origin}`, async () => {
        const app = createTestApp();
        const response = await supertest(app)
          .options('/api/test-cors')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'GET');

        expect(response.status).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
      });
    });

    test('allows requests matching local network pattern (172.x.x.x)', async () => {
      const app = createTestApp();
      const testOrigins = [
        'http://172.16.0.1:3000',
        'http://172.31.255.255:8080',
        'http://172.20.10.5:5500'
      ];

      for (const origin of testOrigins) {
        const response = await supertest(app)
          .get('/api/test-cors')
          .set('Origin', origin);

        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
      }
    });
  });

  describe('Rejection of missing Origin headers', () => {
    // Temporarily set NODE_ENV to 'development' for these tests
    // to verify the production behavior of rejecting missing Origin headers
    const originalNodeEnv = process.env.NODE_ENV;

    beforeAll(() => {
      process.env.NODE_ENV = 'development';
    });

    afterAll(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    test('rejects requests with no Origin header', async () => {
      const app = createTestApp();
      const response = await supertest(app)
        .get('/api/test-cors');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Missing Origin header');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('rejects OPTIONS preflight with no Origin header', async () => {
      const app = createTestApp();
      const response = await supertest(app)
        .options('/api/test-cors')
        .set('Access-Control-Request-Method', 'GET');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Missing Origin header');
    });

    test('rejects requests with empty Origin header', async () => {
      const app = createTestApp();
      const response = await supertest(app)
        .get('/api/test-cors')
        .set('Origin', '');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Missing Origin header');
    });
  });

  describe('Rejection of unallowed origins', () => {
    test('rejects requests from unallowed origin', async () => {
      const app = createTestApp();
      const response = await supertest(app)
        .get('/api/test-cors')
        .set('Origin', 'https://unallowed-malicious-site.com');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('CORS not allowed');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('rejects requests from similar but unallowed origin', async () => {
      const app = createTestApp();
      const response = await supertest(app)
        .get('/api/test-cors')
        .set('Origin', 'http://localhost:3000');

      expect(response.status).toBe(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('CORS headers validation', () => {
    test('includes correct CORS headers for allowed origin on preflight', async () => {
      const app = createTestApp();
      const response = await supertest(app)
        .options('/api/test-cors')
        .set('Origin', 'http://localhost:5500')
        .set('Access-Control-Request-Method', 'GET');

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5500');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['access-control-allow-methods']).toContain('GET');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
      expect(response.headers['access-control-allow-headers']).toContain('Content-Type');
      expect(response.headers['access-control-allow-headers']).toContain('Authorization');
      expect(response.headers['access-control-allow-headers']).toContain('X-Cart-Token');
    });

    test('includes Vary: Origin header', async () => {
      const app = createTestApp();
      const response = await supertest(app)
        .get('/api/test-cors')
        .set('Origin', 'http://localhost:5500');

      expect(response.headers['vary']).toContain('Origin');
    });
  });
});