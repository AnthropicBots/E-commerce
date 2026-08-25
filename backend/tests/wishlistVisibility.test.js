const wishlistController = require('../controllers/wishlistController');
const promisePool = require('../config/db');

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

describe('WishlistController - Canonical Product Visibility', () => {
    let req;
    let res;

    beforeEach(() => {
        req = {
            user: { id: 'user-1' },
            query: { page: '1', limit: '10' },
            params: {}
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        jest.clearAllMocks();
    });

    test('getUserWishlist queries should filter by status = active and deleted_at IS NULL', async () => {
        promisePool.query
            .mockResolvedValueOnce([[{ total: 1 }]]) // count query
            .mockResolvedValueOnce([[              // items query
                { id: 'p1', name: 'Product 1', price: 50, status: 'active' }
            ]]);

        await wishlistController.getUserWishlist(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(promisePool.query).toHaveBeenCalledTimes(2);

        const countQuery = promisePool.query.mock.calls[0][0];
        const itemsQuery = promisePool.query.mock.calls[1][0];

        expect(countQuery).toContain("p.status = 'active' AND p.deleted_at IS NULL");
        expect(itemsQuery).toContain("p.status = 'active' AND p.deleted_at IS NULL");
    });
});
