const express = require('express');
const request = require('supertest');

const mockAnalyze = jest.fn();
const mockGetStatus = jest.fn();
const mockGetStats = jest.fn();

jest.mock('../middleware/authMiddleware', () => (req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    next();
});

jest.mock('../services/architecturalRiskService', () => {
    const mockMap = new Map();
    mockMap.set('/app/backend/services/cartController.js', { score: 85, level: 'low' });
    return {
        architecturalRiskService: {
            moduleScores: mockMap,
            analyzeRisk: mockAnalyze,
            riskHistory: [{ id: 1, score: 90 }],
            getStatus: mockGetStatus,
            getStatistics: mockGetStats
        }
    };
});

const riskRoutes = require('../routes/riskRoutes');

describe('Risk Routes API', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use('/api/risk', riskRoutes);
        jest.clearAllMocks();
    });

    test('GET /api/risk/modules/:name should return module data when module exists', async () => {
        const response = await request(app).get('/api/risk/modules/cartController.js');
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual({
            path: '/app/backend/services/cartController.js',
            score: 85,
            level: 'low'
        });
    });

    test('GET /api/risk/modules/:name should return 404 when module does not exist', async () => {
        const response = await request(app).get('/api/risk/modules/nonExistentModule');
        expect(response.status).toBe(404);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Module not found');
    });

    test('POST /api/risk/analyze should trigger risk analysis for admin', async () => {
        mockAnalyze.mockResolvedValue({ status: 'completed' });
        const response = await request(app).post('/api/risk/analyze');
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual({ status: 'completed' });
    });

    test('GET /api/risk/history should return risk history', async () => {
        const response = await request(app).get('/api/risk/history');
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual([{ id: 1, score: 90 }]);
    });

    test('GET /api/risk/status should return risk status', async () => {
        mockGetStatus.mockReturnValue({ active: true });
        const response = await request(app).get('/api/risk/status');
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual({ active: true });
    });

    test('GET /api/risk/stats should return risk statistics', async () => {
        mockGetStats.mockResolvedValue({ total: 10 });
        const response = await request(app).get('/api/risk/stats');
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual({ total: 10 });
    });
});
