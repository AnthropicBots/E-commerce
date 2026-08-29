const reviewRepo = require('../repositories/reviewRepository');

describe('ReviewRepository - Moderation Status Defaults on Create', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        reviewRepo.db = {
            query: jest.fn()
        };
    });

    test('create should supply moderation_status = approved and is_approved = 1', async () => {
        reviewRepo.db.query
            .mockResolvedValueOnce([{ insertId: 42 }]) // insert query
            .mockResolvedValueOnce([[{ id: 42, product_id: 'prod-1', user_id: 'user-1', moderation_status: 'approved', is_approved: 1 }]]); // findById query

        const review = await reviewRepo.create({
            productId: 'prod-1',
            userId: 'user-1',
            rating: 5,
            comment: 'Great product!'
        });

        expect(review).toBeDefined();
        expect(reviewRepo.db.query).toHaveBeenCalledTimes(2);

        const insertSql = reviewRepo.db.query.mock.calls[0][0];
        const insertParams = reviewRepo.db.query.mock.calls[0][1];

        expect(insertSql).toContain('moderation_status');
        expect(insertSql).toContain('is_approved');
        expect(insertParams).toContain('approved');
        expect(insertParams).toContain(1);
    });
});
