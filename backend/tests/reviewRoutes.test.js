// backend/tests/reviewRoutes.test.js
const request = require('supertest');
const express = require('express');

// Mock authMiddleware
jest.mock('../middleware/authMiddleware', () => {
    return jest.fn((req, res, next) => {
        req.user = { id: 'user-123', role: 'user' };
        next();
    });
});

// Mock reviewRepository
jest.mock('../repositories/reviewRepository', () => ({
    create: jest.fn(),
    findById: jest.fn(),
    findByProduct: jest.fn(),
    findByUser: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
}));

const reviewRepo = require('../repositories/reviewRepository');
const reviewRoutes = require('../routes/reviewRoutes');

const app = express();
app.use(express.json());
app.use('/api/reviews', reviewRoutes);

describe('Review Routes (/api/reviews)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POST /api/reviews creates review successfully', async () => {
        reviewRepo.create.mockResolvedValueOnce({
            id: 1,
            product_id: 'prod-100',
            user_id: 'user-123',
            rating: 5,
            comment: 'Excellent quality!'
        });

        const res = await request(app)
            .post('/api/reviews')
            .send({
                productId: 'prod-100',
                rating: 5,
                comment: 'Excellent quality!'
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.review.id).toBe(1);
    });

    test('POST /api/reviews rejects invalid rating', async () => {
        const res = await request(app)
            .post('/api/reviews')
            .send({
                productId: 'prod-100',
                rating: 6,
                comment: 'Bad rating'
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('GET /api/reviews lists reviews by productId', async () => {
        reviewRepo.findByProduct.mockResolvedValueOnce([
            { id: 1, rating: 5, comment: 'Awesome' }
        ]);

        const res = await request(app).get('/api/reviews?productId=prod-100');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.reviews).toHaveLength(1);
    });

    test('DELETE /api/reviews/:id deletes review owned by user', async () => {
        reviewRepo.findById.mockResolvedValueOnce({
            id: 1,
            user_id: 'user-123'
        });
        reviewRepo.delete.mockResolvedValueOnce(true);

        const res = await request(app).delete('/api/reviews/1');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.deleted).toBe(true);
    });
});
