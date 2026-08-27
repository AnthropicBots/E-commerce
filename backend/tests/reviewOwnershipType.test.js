const request = require('supertest');
const express = require('express');

let mockUser = { id: '10', role: 'user' };

jest.mock('../middleware/authMiddleware', () => {
    return jest.fn((req, res, next) => {
        req.user = mockUser;
        next();
    });
});

jest.mock('../repositories/reviewRepository', () => ({
    findById: jest.fn(),
    update: jest.fn()
}));

jest.mock('../controllers/reviewController', () => ({
    deleteProductReview: jest.fn((req, res) =>
        res.status(200).json({ success: true, message: 'Review deleted successfully' })
    ),
    refreshProductReviewStats: jest.fn().mockResolvedValue({ averageRating: 5, reviewCount: 1 })
}));

const reviewRepo = require('../repositories/reviewRepository');
const reviewRoutes = require('../routes/reviewRoutes');

const app = express();
app.use(express.json());
app.use('/api/reviews', reviewRoutes);

describe('ReviewRoutes - User ID Type Normalization in Ownership Checks', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUser = { id: '10', role: 'user' };
    });

    test('PUT /api/reviews/:id should allow owner when existing.user_id is numeric 10 and req.user.id is string "10"', async () => {
        reviewRepo.findById.mockResolvedValueOnce({
            id: 1,
            product_id: 'prod-1',
            user_id: 10 // numeric in DB
        });
        reviewRepo.update.mockResolvedValueOnce({ id: 1, rating: 5, comment: 'Updated' });

        const res = await request(app)
            .put('/api/reviews/1')
            .send({ rating: 5, comment: 'Updated' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('DELETE /api/reviews/:id should allow owner when existing.user_id is numeric 10 and req.user.id is string "10"', async () => {
        reviewRepo.findById.mockResolvedValueOnce({
            id: 1,
            product_id: 'prod-1',
            user_id: 10 // numeric in DB
        });

        const res = await request(app)
            .delete('/api/reviews/1');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('PUT /api/reviews/:id should reject when user ID does not match', async () => {
        reviewRepo.findById.mockResolvedValueOnce({
            id: 1,
            product_id: 'prod-1',
            user_id: 99 // different user
        });

        const res = await request(app)
            .put('/api/reviews/1')
            .send({ rating: 5, comment: 'Updated' });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});
