// backend/tests/reviewRepository.test.js
const reviewRepo = require('../repositories/reviewRepository');
const db = require('../config/db');

jest.mock('../config/db', () => {
    const mockQuery = jest.fn();
    return {
        promise: {
            query: mockQuery
        },
        query: mockQuery
    };
});

describe('ReviewRepository', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('create inserts a new review record and returns it', async () => {
        db.promise.query
            .mockResolvedValueOnce([{ insertId: 10 }]) // INSERT query
            .mockResolvedValueOnce([[{ id: 10, product_id: 'prod-123', user_id: 'user-456', rating: 5, comment: 'Great product!' }]]); // SELECT query

        const result = await reviewRepo.create({
            productId: 'prod-123',
            userId: 'user-456',
            rating: 5,
            comment: 'Great product!'
        });

        expect(db.promise.query).toHaveBeenCalledTimes(2);
        expect(result).toBeDefined();
        expect(result.id).toBe(10);
        expect(result.rating).toBe(5);
    });

    test('findById returns review if present', async () => {
        db.promise.query.mockResolvedValueOnce([[{ id: 10, rating: 4, comment: 'Nice' }]]);

        const review = await reviewRepo.findById(10);
        expect(review).toBeDefined();
        expect(review.id).toBe(10);
        expect(review.rating).toBe(4);
    });

    test('findByProduct returns list of approved reviews', async () => {
        db.promise.query.mockResolvedValueOnce([
            [{ id: 1, product_id: 'prod-1', rating: 5 }, { id: 2, product_id: 'prod-1', rating: 4 }]
        ]);

        const reviews = await reviewRepo.findByProduct('prod-1', { page: 1, limit: 10 });
        expect(reviews).toHaveLength(2);
    });

    test('update modifies review fields', async () => {
        db.promise.query
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
            .mockResolvedValueOnce([[{ id: 10, rating: 3, comment: 'Updated comment' }]]); // SELECT

        const updated = await reviewRepo.update(10, { rating: 3, comment: 'Updated comment' });
        expect(updated).toBeDefined();
        expect(updated.rating).toBe(3);
    });

    test('delete stamps deleted_at', async () => {
        db.promise.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

        const success = await reviewRepo.delete(10);
        expect(success).toBe(true);
    });
});
