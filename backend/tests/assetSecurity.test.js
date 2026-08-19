const express = require('express');
const supertest = require('supertest');
const assetSecurityMiddleware = require('../middleware/assetSecurityMiddleware');

describe('Asset Security Middleware', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(assetSecurityMiddleware);
    });

    test('should allow valid SVG filenames (alphanumeric, hyphens, underscores, .svg)', async () => {
        const response = await supertest(app).get('/assets/images/user.svg');
        // user.svg is valid, so it should not return 403 Forbidden
        expect(response.status).not.toBe(403);
    });

    test('should allow another valid SVG filename with hyphens and numbers', async () => {
        const response = await supertest(app).get('/assets/images/mega-laptop.svg');
        expect(response.status).not.toBe(403);
    });

    test('should reject path traversal attempts (../../../../etc/passwd.svg) with 403 Forbidden', async () => {
        const response = await supertest(app).get('/assets/images/../../../../etc/passwd.svg');
        expect(response.status).toBe(403);
        expect(response.body).toEqual({
            success: false,
            message: expect.stringMatching(/Forbidden/)
        });
    });

    test('should reject encoded path traversal attempts with 403 Forbidden', async () => {
        const response = await supertest(app).get('/assets/images/..%2f..%2fetc%2fpasswd.svg');
        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
    });

    test('should reject non-SVG file extensions with 403 Forbidden', async () => {
        const response = await supertest(app).get('/assets/images/passwd.png');
        expect(response.status).toBe(403);
        expect(response.body).toEqual({
            success: false,
            message: 'Forbidden: Invalid asset filename'
        });
    });

    test('should reject executable or script filenames with 403 Forbidden', async () => {
        const response = await supertest(app).get('/assets/images/script.js');
        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
    });

    test('should reject filenames with special characters (spaces, dollar signs, semicolons)', async () => {
        const res1 = await supertest(app).get('/assets/images/invalid$file.svg');
        expect(res1.status).toBe(403);

        const res2 = await supertest(app).get('/assets/images/bad%20name.svg');
        expect(res2.status).toBe(403);

        const res3 = await supertest(app).get('/assets/images/test;calc.svg');
        expect(res3.status).toBe(403);
    });
});
