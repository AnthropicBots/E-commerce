// backend/tests/reviewRoutes.test.js
//
// `/api/reviews` used to write to the `reviews` table itself, which made it a
// second door with none of the locks on the first one (#1653). These tests
// pin the thing that matters: every write goes through reviewController, so
// the purchase check, the duplicate check, `is_verified` and the rating
// refresh apply here exactly as they do on the product page.

const request = require('supertest');
const express = require('express');

jest.mock('../middleware/authMiddleware', () => {
    return jest.fn((req, res, next) => {
        req.user = { id: 'user-123', role: 'user' };
        next();
    });
});

jest.mock('../repositories/reviewRepository', () => ({
    create: jest.fn(),
    findById: jest.fn(),
    findByProduct: jest.fn(),
    findByUser: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
}));

jest.mock('../controllers/reviewController', () => ({
    createProductReview: jest.fn((req, res) =>
        res.status(201).json({
            success: true,
            message: 'Review submitted successfully',
            reviewId: 1,
            averageRating: 4.5,
            reviewCount: 2
        })
    ),
    deleteProductReview: jest.fn((req, res) =>
        res.status(200).json({
            success: true,
            message: 'Review deleted',
            averageRating: 4.0,
            reviewCount: 1
        })
    ),
    refreshProductReviewStats: jest.fn().mockResolvedValue({
        averageRating: 4.5,
        reviewCount: 2
    })
}));

const reviewRepo = require('../repositories/reviewRepository');
const reviewController = require('../controllers/reviewController');
const reviewRoutes = require('../routes/reviewRoutes');

const app = express();
app.use(express.json());
app.use('/api/reviews', reviewRoutes);

describe('POST /api/reviews goes through the guarded path', () => {
    beforeEach(() => jest.clearAllMocks());

    test('hands the write to reviewController, not to the repository', async () => {
        const res = await request(app)
            .post('/api/reviews')
            .send({
                productId: 'prod-100',
                rating: 5,
                comment: 'Excellent quality!'
            });

        expect(res.statusCode).toBe(201);
        expect(reviewController.createProductReview).toHaveBeenCalledTimes(1);

        // The regression: this used to be the only thing the route called, and
        // it skipped every guard the controller applies.
        expect(reviewRepo.create).not.toHaveBeenCalled();
    });

    test('moves productId from the body onto req.params.id', async () => {
        // The controller reads the product from the path because it is mounted
        // under /products/:id. Adapting the shape is the whole delegation.
        await request(app)
            .post('/api/reviews')
            .send({ productId: 'prod-100', rating: 5, comment: 'Great' });

        const [req] = reviewController.createProductReview.mock.calls[0];

        expect(req.params.id).toBe('prod-100');
    });

    test('still requires a product id up front', async () => {
        const res = await request(app)
            .post('/api/reviews')
            .send({ rating: 5, comment: 'Great' });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/Product ID is required/i);
        expect(reviewController.createProductReview).not.toHaveBeenCalled();
    });

    test('a refusal from the controller is the response', async () => {
        // The purchase check is the controller's. What matters here is that the
        // route does not paper over it, which is what writing to the repository
        // directly amounted to.
        reviewController.createProductReview.mockImplementationOnce((req, res) =>
            res.status(403).json({
                success: false,
                message: 'You can only review products you have purchased'
            })
        );

        const res = await request(app)
            .post('/api/reviews')
            .send({ productId: 'prod-100', rating: 5, comment: 'Never bought it' });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toMatch(/only review products you have purchased/i);
        expect(reviewRepo.create).not.toHaveBeenCalled();
    });

    test('a duplicate is refused by the controller and not written twice', async () => {
        reviewController.createProductReview.mockImplementationOnce((req, res) =>
            res.status(400).json({
                success: false,
                message: 'You have already reviewed this product'
            })
        );

        const res = await request(app)
            .post('/api/reviews')
            .send({ productId: 'prod-100', rating: 5, comment: 'Again' });

        expect(res.statusCode).toBe(400);
        expect(reviewRepo.create).not.toHaveBeenCalled();
    });
});

describe('GET /api/reviews', () => {
    beforeEach(() => jest.clearAllMocks());

    test('lists reviews by productId', async () => {
        reviewRepo.findByProduct.mockResolvedValueOnce([
            { id: 1, rating: 5, comment: 'Awesome' }
        ]);

        const res = await request(app).get('/api/reviews?productId=prod-100');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.reviews).toHaveLength(1);
    });

    test('falls back to the caller\'s own reviews', async () => {
        reviewRepo.findByUser.mockResolvedValueOnce([]);

        await request(app).get('/api/reviews');

        expect(reviewRepo.findByUser).toHaveBeenCalledWith(
            'user-123',
            expect.any(Object)
        );
    });

    test('GET /api/reviews/:id returns 404 for a review that is not there', async () => {
        reviewRepo.findById.mockResolvedValueOnce(null);

        const res = await request(app).get('/api/reviews/999');

        expect(res.statusCode).toBe(404);
    });
});

describe('PUT /api/reviews/:id', () => {
    beforeEach(() => jest.clearAllMocks());

    const ownReview = { id: 1, user_id: 'user-123', product_id: 'prod-100' };

    test('refuses a rating outside 1-5 instead of clamping it', async () => {
        // reviewRepository.update computes Math.max(1, Math.min(5, Number(x) || 5)),
        // so 0 stored as 5 and 99 stored as 5 -- a one-star edit silently
        // becoming five stars.
        reviewRepo.findById.mockResolvedValue(ownReview);

        for (const rating of [0, 6, 99, -1]) {
            const res = await request(app)
                .put('/api/reviews/1')
                .send({ rating });

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toMatch(/integer between 1 and 5/i);
        }

        expect(reviewRepo.update).not.toHaveBeenCalled();
    });

    test('refuses a non-integer rating', async () => {
        reviewRepo.findById.mockResolvedValueOnce(ownReview);

        const res = await request(app).put('/api/reviews/1').send({ rating: 3.7 });

        expect(res.statusCode).toBe(400);
        expect(reviewRepo.update).not.toHaveBeenCalled();
    });

    test('refreshes the product rating after a rating change', async () => {
        reviewRepo.findById.mockResolvedValue(ownReview);
        reviewRepo.update.mockResolvedValueOnce({ ...ownReview, rating: 2 });

        const res = await request(app).put('/api/reviews/1').send({ rating: 2 });

        expect(res.statusCode).toBe(200);
        expect(reviewController.refreshProductReviewStats).toHaveBeenCalledWith('prod-100');
    });

    test('does not recompute the average when the rating did not change', async () => {
        reviewRepo.findById.mockResolvedValue(ownReview);
        reviewRepo.update.mockResolvedValueOnce({ ...ownReview, comment: 'edited' });

        await request(app).put('/api/reviews/1').send({ comment: 'edited' });

        expect(reviewController.refreshProductReviewStats).not.toHaveBeenCalled();
    });

    test('refuses an edit to somebody else\'s review', async () => {
        reviewRepo.findById.mockResolvedValueOnce({
            id: 1,
            user_id: 'someone-else',
            product_id: 'prod-100'
        });

        const res = await request(app).put('/api/reviews/1').send({ rating: 1 });

        expect(res.statusCode).toBe(403);
        expect(reviewRepo.update).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/reviews/:id', () => {
    beforeEach(() => jest.clearAllMocks());

    test('delegates to the controller so the delete is soft and the stars move', async () => {
        reviewRepo.findById.mockResolvedValueOnce({
            id: 1,
            user_id: 'user-123',
            product_id: 'prod-100'
        });

        const res = await request(app).delete('/api/reviews/1');

        expect(res.statusCode).toBe(200);
        expect(reviewController.deleteProductReview).toHaveBeenCalledTimes(1);

        // reviewRepo.delete only stamped deleted_at: no deleted_by, no
        // moderation_status, and no rating refresh, so a removed review went on
        // counting towards the product's average.
        expect(reviewRepo.delete).not.toHaveBeenCalled();

        const [req] = reviewController.deleteProductReview.mock.calls[0];
        expect(req.params.id).toBe('prod-100');
        expect(req.params.reviewId).toBe('1');
    });

    test('refuses a delete of somebody else\'s review before delegating', async () => {
        reviewRepo.findById.mockResolvedValueOnce({
            id: 1,
            user_id: 'someone-else',
            product_id: 'prod-100'
        });

        const res = await request(app).delete('/api/reviews/1');

        expect(res.statusCode).toBe(403);
        expect(reviewController.deleteProductReview).not.toHaveBeenCalled();
    });

    test('404s for a review that is not there', async () => {
        reviewRepo.findById.mockResolvedValueOnce(null);

        const res = await request(app).delete('/api/reviews/1');

        expect(res.statusCode).toBe(404);
        expect(reviewController.deleteProductReview).not.toHaveBeenCalled();
    });
});
