const { readCartLines } = require('../services/cartMergeService');

describe('CartMergeService - Canonical Product Visibility Filtering in Cart Merge', () => {
    let connection;

    beforeEach(() => {
        connection = {
            query: jest.fn()
        };
    });

    test('readCartLines should filter by p.status = active and p.deleted_at IS NULL', async () => {
        const prodUuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
        connection.query.mockResolvedValueOnce([
            [{ product_id: prodUuid, variant_id: 10, color: 'Blue', size: 'M', quantity: 2 }]
        ]);

        const lines = await readCartLines('guest-cart-123', connection);

        expect(lines).toHaveLength(1);
        expect(lines[0].productId).toBe(prodUuid);

        expect(connection.query).toHaveBeenCalledTimes(1);
        const sql = connection.query.mock.calls[0][0];
        const params = connection.query.mock.calls[0][1];

        expect(sql).toContain('p.status IN (?)');
        expect(sql).toContain('p.deleted_at IS NULL');
        expect(params).toContain('guest-cart-123');
        expect(params).toContain('active');
    });
});
