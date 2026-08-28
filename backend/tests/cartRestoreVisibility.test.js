const { loadRestorableLines } = require('../services/cartRestoreService');
const db = require('../config/db');

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

describe('CartRestoreService - Canonical Product Visibility Filtering', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('loadRestorableLines should query with status = active and deleted_at IS NULL', async () => {
        db.query.mockResolvedValueOnce([
            [{ product_id: 'prod-1', variant_id: 10, color: 'Blue', size: 'M', quantity: 2, name: 'Shirt', price: '49.99', image: 'img.jpg' }]
        ]);

        const lines = await loadRestorableLines('cart-123');

        expect(lines).toHaveLength(1);
        expect(lines[0].id).toBe('prod-1');
        expect(lines[0].price).toBe(49.99);

        expect(db.query).toHaveBeenCalledTimes(1);
        const sql = db.query.mock.calls[0][0];
        const params = db.query.mock.calls[0][1];

        expect(sql).toContain('p.status IN (?)');
        expect(sql).toContain('p.deleted_at IS NULL');
        expect(params).toContain('cart-123');
        expect(params).toContain('active');
    });
});
