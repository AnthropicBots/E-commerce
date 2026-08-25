const request = require('supertest');
const express = require('express');

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

const db = require('../config/db');
const searchRoutes = require('../routes/searchRoutes');

const app = express();
app.use(express.json());
app.use('/api/search', searchRoutes);

describe('Search API (/api/search)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('GET /api/search with empty q returns empty list', async () => {
        const res = await request(app).get('/api/search?q=');
        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual([]);
    });

    test('GET /api/search?q=shirt returns top 5 matching products', async () => {
        const mockProducts = [
            { id: '1', name: 'Cotton T-Shirt', price: 19.99, relevance: 100 },
            { id: '2', name: 'Summer Polo Shirt', price: 29.99, relevance: 90 },
            { id: '3', name: 'Casual Denim Shirt', price: 39.99, relevance: 80 },
            { id: '4', name: 'Formal White Shirt', price: 49.99, relevance: 70 },
            { id: '5', name: 'Linen Shirt', price: 59.99, relevance: 60 }
        ];

        db.query.mockResolvedValueOnce([mockProducts]);

        const res = await request(app).get('/api/search?q=shirt');
        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(5);
        expect(res.body.data[0].name).toBe('Cotton T-Shirt');
    });

    test('GET /api/search handles DB error gracefully with fallback or empty', async () => {
        db.query.mockRejectedValue(new Error('DB failure'));

        const res = await request(app).get('/api/search?q=test');
        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual([]);
    });
});
