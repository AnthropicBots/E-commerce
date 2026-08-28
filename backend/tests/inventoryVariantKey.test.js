const { reserveStockInTransaction, lockLine } = require('../services/inventoryReservationService');
const stockCounter = require('../services/stockCounterService');

jest.mock('../services/stockCounterService', () => ({
    resolveVariant: jest.fn()
}));

describe('InventoryReservationService - Variant Lock Key Serialization', () => {
    let conn;

    beforeEach(() => {
        conn = {
            query: jest.fn()
        };
        jest.clearAllMocks();
    });

    test('should resolve variant and lock using variant.id when line variantId is NO_VARIANT_ID', async () => {
        stockCounter.resolveVariant.mockResolvedValueOnce({
            id: 15,
            stock: 10
        });

        // 1. DELETE expired locks
        // 2. SELECT products FOR UPDATE
        // 3. SELECT SUM(quantity) FROM inventory_locks
        // 4. INSERT INTO inventory_locks
        conn.query
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([[{ id: 'prod-1', stock: 10, name: 'T-Shirt' }]])
            .mockResolvedValueOnce([[{ locked_qty: 2 }]])
            .mockResolvedValueOnce([{ insertId: 1 }]);

        const line = lockLine({ productId: 'prod-1', color: 'Blue', size: 'M' });
        const result = await reserveStockInTransaction(
            conn,
            'user-1',
            'prod-1',
            3,
            new Date(),
            line
        );

        expect(result.ok).toBe(true);
        expect(line.variantId).toBe(15);

        // Verify lock check queried using resolved variant ID 15
        const lockQuerySql = conn.query.mock.calls[2][0];
        const lockQueryParams = conn.query.mock.calls[2][1];
        expect(lockQuerySql).toContain('variant_id = ?');
        expect(lockQueryParams).toContain(15);

        // Verify lock insert inserted using resolved variant ID 15
        const insertSql = conn.query.mock.calls[3][0];
        const insertParams = conn.query.mock.calls[3][1];
        expect(insertSql).toContain('INSERT INTO inventory_locks');
        expect(insertParams[3]).toBe(15);
    });
});
