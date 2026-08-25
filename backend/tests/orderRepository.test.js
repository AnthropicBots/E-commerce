// backend/tests/orderRepository.test.js
//
// Two independent faults, one loud and one silent (#1568).
//
// getStats() aggregated `total_amount`. orders has subtotal, total and
// final_amount (0001_baseline_schema.sql:186-190) and no total_amount -- the
// name appears in migrations/0047 only inside a comment. So the statement threw
// ER_BAD_FIELD_ERROR and the store never got a revenue figure at all.
//
// getCompleted() filtered on 'completed', which is not one of the seven states
// orders.status can hold. That one raised nothing: MySQL matches no rows when
// an ENUM is compared against a value outside its set, so it returned [] on a
// store full of delivered orders, and its two working siblings made that look
// like a true answer.

jest.mock('../config/db', () => ({
    promise: { query: jest.fn() },
    withTransaction: jest.fn()
}));

const orderRepo = require('../repositories/orderRepository');

const ORDER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const USER_ID = '9f8b7a60-1c2d-4e3f-8a9b-0c1d2e3f4a5b';

/** Every statement sent, whitespace collapsed for matching. */
const allSql = () =>
    orderRepo.db.query.mock.calls.map(([sql]) =>
        String(sql).replace(/\s+/g, ' ').trim());

const lastSql = () => allSql()[allSql().length - 1];

const lastParams = () => {
    const calls = orderRepo.db.query.mock.calls;
    return calls[calls.length - 1][1];
};

beforeEach(() => {
    orderRepo.db = { query: jest.fn().mockResolvedValue([[], []]) };
    orderRepo.clearCache();
});

describe('getStats aggregates a column that exists', () => {
    beforeEach(() => {
        orderRepo.db.query.mockResolvedValue([[{ total_orders: 2 }], []]);
    });

    test('it sums total, not total_amount', async () => {
        await orderRepo.getStats();

        expect(lastSql()).toMatch(/SUM\(total\) as total_revenue/i);
        expect(lastSql()).not.toMatch(/total_amount/i);
    });

    test('every aggregate moves together', async () => {
        await orderRepo.getStats();

        for (const fn of ['SUM', 'AVG', 'MIN', 'MAX']) {
            expect(lastSql()).toMatch(new RegExp(`${fn}\\(total\\)`, 'i'));
        }
    });

    test('refunded money is not counted as revenue', async () => {
        await orderRepo.getStats();

        expect(lastSql()).toMatch(/status NOT IN \(\?, \?\)/i);
        expect(lastParams().slice(0, 2)).toEqual(['cancelled', 'refunded']);
    });

    test('it can still be scoped to one customer', async () => {
        await orderRepo.getStats(USER_ID);

        expect(lastSql()).toMatch(/AND user_id = \?/i);
        expect(lastParams()).toEqual(['cancelled', 'refunded', USER_ID]);
    });

    test('soft-deleted orders are not counted', async () => {
        await orderRepo.getStats();

        expect(lastSql()).toMatch(/deleted_at IS NULL/i);
    });

    test('it returns null rather than undefined when there is no row', async () => {
        orderRepo.db.query.mockResolvedValue([[], []]);

        await expect(orderRepo.getStats()).resolves.toBeNull();
    });
});

describe('the fulfilled state is delivered, not completed', () => {
    test('getCompleted asks for delivered orders', async () => {
        await orderRepo.getCompleted();

        expect(lastSql()).toMatch(/WHERE status = \?/i);
        expect(lastParams()[0]).toBe('delivered');
    });

    test('and never for a status the ENUM has no room for', async () => {
        await orderRepo.getCompleted();

        expect(lastParams()[0]).not.toBe('completed');
    });

    test('its working siblings are unchanged', async () => {
        await orderRepo.getPending();
        expect(lastParams()[0]).toBe('pending');

        await orderRepo.getProcessing();
        expect(lastParams()[0]).toBe('processing');
    });

    test('the fulfilled status is exported so callers need not restate it', () => {
        // Restating the vocabulary by hand is how 'completed' got written.
        expect(orderRepo.FULFILLED_STATUS).toBe('delivered');
        expect(orderRepo.ORDER_STATUSES).toContain('delivered');
        expect(orderRepo.ORDER_STATUSES).not.toContain('completed');
    });
});

describe('an unknown status fails loudly', () => {
    test('findByStatus refuses it', async () => {
        // Previously an empty list, which is indistinguishable from a true
        // "none in that state" answer.
        await expect(orderRepo.findByStatus('completed'))
            .rejects.toThrow(/Unknown order status/i);

        expect(orderRepo.db.query).not.toHaveBeenCalled();
    });

    test('the message names what was expected', async () => {
        await expect(orderRepo.findByStatus('shipped_out'))
            .rejects.toThrow(/pending, processing, shipped, delivered/i);
    });

    test('updateStatus refuses it too', async () => {
        await expect(orderRepo.updateStatus(ORDER_ID, 'complete'))
            .rejects.toThrow(/Unknown order status/i);
    });

    test('findByUser refuses it when filtering', async () => {
        await expect(orderRepo.findByUser(USER_ID, { status: 'done' }))
            .rejects.toThrow(/Unknown order status/i);
    });

    test('a valid status in the wrong case is accepted and normalised', async () => {
        await orderRepo.findByStatus('Delivered');

        expect(lastParams()[0]).toBe('delivered');
    });

    test('findByUser without a status filter is unaffected', async () => {
        await orderRepo.findByUser(USER_ID);

        expect(lastSql()).not.toMatch(/AND status = \?/i);
    });
});

describe('cancel does not overwrite an order that is over', () => {
    test('it excludes delivered, cancelled and refunded orders', async () => {
        orderRepo.db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

        await orderRepo.cancel(ORDER_ID, 'changed my mind');

        expect(lastSql()).toMatch(/status NOT IN \(\?, \?, \?\)/i);
        expect(lastParams()).toEqual([
            'changed my mind', ORDER_ID, 'delivered', 'cancelled', 'refunded'
        ]);
    });

    test('it reports false when nothing was cancellable', async () => {
        // affectedRows > 0 was true for an overwrite, so the old version
        // reported re-cancelling a delivered order as a success.
        orderRepo.db.query.mockResolvedValue([{ affectedRows: 0 }, []]);

        await expect(orderRepo.cancel(ORDER_ID, 'too late')).resolves.toBe(false);
    });

    test('it still records the reason and the time', async () => {
        orderRepo.db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

        await orderRepo.cancel(ORDER_ID, 'changed my mind');

        expect(lastSql()).toMatch(/cancellation_reason = \?/i);
        expect(lastSql()).toMatch(/cancelled_at = NOW\(\)/i);
    });
});

describe('soft-deleted orders stay out of the reads', () => {
    const readsThatMustFilter = [
        ['findByUser', () => orderRepo.findByUser(USER_ID)],
        ['findByStatus', () => orderRepo.findByStatus('pending')],
        ['getByDateRange', () => orderRepo.getByDateRange('2026-01-01', '2026-02-01')],
        ['getStats', () => orderRepo.getStats()]
    ];

    test.each(readsThatMustFilter)('%s excludes them', async (_name, run) => {
        orderRepo.db.query.mockResolvedValue([[{}], []]);

        await run();

        expect(lastSql()).toMatch(/deleted_at IS NULL/i);
    });

    test('getRecent excludes them on the aliased table', async () => {
        await orderRepo.getRecent();

        expect(lastSql()).toMatch(/o\.deleted_at IS NULL/i);
    });

    test('findWithItems refuses a deleted order', async () => {
        orderRepo.db.query.mockResolvedValue([
            [{ id: ORDER_ID, deleted_at: new Date() }], []
        ]);

        await expect(orderRepo.findWithItems(ORDER_ID)).resolves.toBeNull();
        // It must not go on to fetch the items.
        expect(orderRepo.db.query).toHaveBeenCalledTimes(1);
    });

    test('findWithItems still returns a live order with its items', async () => {
        orderRepo.db.query
            .mockResolvedValueOnce([[{ id: ORDER_ID, deleted_at: null }], []])
            .mockResolvedValueOnce([[{ id: 1, name: 'Shirt' }], []]);

        const result = await orderRepo.findWithItems(ORDER_ID);

        expect(result.id).toBe(ORDER_ID);
        expect(result.items).toEqual([{ id: 1, name: 'Shirt' }]);
    });

    test('the repository declares the soft-delete column', () => {
        // Without it, BaseRepository.delete() hard-deletes the order and
        // cascades order_items away with it.
        expect(orderRepo.softDeleteColumn).toBe('deleted_at');
    });
});
