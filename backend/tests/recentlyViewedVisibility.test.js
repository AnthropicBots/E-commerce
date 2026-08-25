const recentlyViewedService = require('../services/recentlyViewedService');
const db = require('../config/db').promise;

jest.mock('../config/db', () => ({
    promise: {
        query: jest.fn()
    }
}));

describe('RecentlyViewedService - Canonical Product Visibility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        recentlyViewedService.cache.clear();
    });

    test('fetchFromDatabase should include publicProductCondition status check in SQL query', async () => {
        db.query.mockResolvedValueOnce([
            [{ id: 'prod-1', name: 'Shoes', price: 99.99, imageUrl: 'img.jpg', viewedAt: new Date() }]
        ]);

        const result = await recentlyViewedService.fetchFromDatabase('user-1', 10);
        expect(result.length).toBe(1);
        expect(db.query).toHaveBeenCalledTimes(1);

        const sql = db.query.mock.calls[0][0];
        const params = db.query.mock.calls[0][1];

        expect(sql).toContain('p.status IN (?)');
        expect(sql).toContain('p.deleted_at IS NULL');
        expect(params).toContain('active');
    });

    test('addViewed should reject product if it is not visible / not found in query', async () => {
        db.query.mockResolvedValueOnce([[]]); // empty product result for non-public product

        const result = await recentlyViewedService.addViewed('user-1', 'prod-draft-1');
        expect(result).toEqual([]);
        // Should not insert into recently_viewed table
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query.mock.calls[0][0]).toContain('SELECT id, name, price, image, stock FROM products');
    });
});
