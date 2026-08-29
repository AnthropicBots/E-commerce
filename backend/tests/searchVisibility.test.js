const { searchProducts } = require('../controllers/searchController');
const db = require('../config/db');

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

describe('SearchController - Canonical Product Visibility Filtering', () => {
    let req;
    let res;

    beforeEach(() => {
        req = {
            query: { q: 'shirt' }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        jest.clearAllMocks();
    });

    test('should apply publicProductCondition checking status = active and deleted_at IS NULL', async () => {
        db.query.mockResolvedValueOnce([
            [{ id: 'p1', name: 'Cotton Shirt', price: 500, status: 'active', relevance: 100 }]
        ]);

        await searchProducts(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(db.query).toHaveBeenCalledTimes(1);

        const sql = db.query.mock.calls[0][0];
        const params = db.query.mock.calls[0][1];

        expect(sql).toContain('products.status IN (?)');
        expect(sql).toContain('products.deleted_at IS NULL');
        expect(params).toContain('active');
    });

    test('fallback query should also include publicProductCondition', async () => {
        db.query
            .mockRejectedValueOnce(new Error('Fulltext index not available'))
            .mockResolvedValueOnce([
                [{ id: 'p1', name: 'Cotton Shirt', price: 500, status: 'active', relevance: 50 }]
            ]);

        await searchProducts(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(db.query).toHaveBeenCalledTimes(2);

        const fallbackSql = db.query.mock.calls[1][0];
        const fallbackParams = db.query.mock.calls[1][1];

        expect(fallbackSql).toContain('products.status IN (?)');
        expect(fallbackSql).toContain('products.deleted_at IS NULL');
        expect(fallbackParams).toContain('active');
    });
});
