const { resolveVariant } = require('../services/stockCounterService');

describe('StockCounterService - Soft-Deleted Variant Exclusion', () => {
    let connection;

    beforeEach(() => {
        connection = {
            query: jest.fn()
        };
    });

    test('resolveVariant by explicit ID should check deleted_at IS NULL', async () => {
        connection.query.mockResolvedValueOnce([
            [{ id: 10, price: '100.00', stock: 5 }]
        ]);

        const variant = await resolveVariant(connection, 'prod-1', { variantId: 10 });

        expect(variant).toBeDefined();
        expect(variant.id).toBe(10);

        expect(connection.query).toHaveBeenCalledTimes(1);
        const sql = connection.query.mock.calls[0][0];
        expect(sql).toContain('deleted_at IS NULL');
        expect(sql).toContain('is_active = 1');
    });

    test('resolveVariant by attributes should check deleted_at IS NULL', async () => {
        connection.query.mockResolvedValueOnce([
            [{ id: 12, price: '120.00', stock: 3 }]
        ]);

        const variant = await resolveVariant(connection, 'prod-1', { color: 'Blue', size: 'M' });

        expect(variant).toBeDefined();
        expect(variant.id).toBe(12);

        expect(connection.query).toHaveBeenCalledTimes(1);
        const sql = connection.query.mock.calls[0][0];
        expect(sql).toContain('deleted_at IS NULL');
        expect(sql).toContain('is_active = 1');
    });
});
