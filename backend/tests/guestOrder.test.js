// backend/tests/guestOrder.test.js
//
// Buying, and then finding the order, without an account (#1427).
//
// The database is mocked at the module boundary. What is pinned here is not
// SQL text but the properties the lookup has to hold whatever the SQL looks
// like, because they are the ones a change could quietly remove:
//
//   * the order number is unguessable and is not derived from the order;
//   * a failure says nothing about which half of the pair was wrong;
//   * an account's order is not reachable this way at all;
//   * the email comparison happens whether or not a row was found, so the
//     existence of one is not readable from the timing.

jest.mock('../config/db', () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    pool.promise = pool;
    return pool;
});

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const db = require('../config/db');
const {
    ORDER_NUMBER_PATTERN,
    generateOrderNumber,
    normalizeOrderNumber
} = require('../services/orderNumber.service');
const { emailsMatch, findGuestOrder } = require('../services/guestOrderService');

const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'Shopper@Example.com';

function guestOrderRow(overrides = {}) {
    return {
        id: ORDER_ID,
        order_number: 'ORD-20260801-A1B2C3D4E5F60718',
        customer_name: 'A Shopper',
        customer_email: 'shopper@example.com',
        customer_phone: '9876543210',
        city: 'Pune',
        state: 'MH',
        zip: '411001',
        full_address: '12 Somewhere Lane',
        payment_method: 'cod',
        payment_status: 'pending',
        status: 'pending',
        subtotal: '1000.00',
        tax: '180.00',
        shipping_cost: '0.00',
        discount_amount: '0.00',
        total: '1180.00',
        tracking_number: null,
        created_at: '2026-08-01 10:00:00',
        updated_at: '2026-08-01 10:00:00',
        ...overrides
    };
}

/** Answers the order select with `rows`, and any item select with none. */
function respondWith(rows) {
    db.query.mockImplementation(async (sql) => {
        if (/FROM orders/i.test(sql)) return [rows];
        return [[]];
    });
}

afterEach(() => {
    db.query.mockReset();
});

describe('the number a shopper is given', () => {
    test('is unguessable, and no two are alike', () => {
        const numbers = new Set(Array.from({ length: 50 }, () => generateOrderNumber()));

        expect(numbers.size).toBe(50);

        for (const number of numbers) {
            expect(number).toMatch(ORDER_NUMBER_PATTERN);
            // Sixteen hex characters is sixty-four bits. A counter, or
            // anything derived from the order id, would carry none.
            expect(number.split('-')[2]).toHaveLength(16);
        }
    });

    test('carries the date it was placed, for the person reading it out', () => {
        const number = generateOrderNumber(new Date(2026, 0, 9));

        expect(number.startsWith('ORD-20260109-')).toBe(true);
    });

    test('forgives case and stray whitespace, and nothing else', () => {
        const number = generateOrderNumber();

        expect(normalizeOrderNumber(`  ${number.toLowerCase()} `)).toBe(number);
        expect(normalizeOrderNumber('ORD-2026-0801-ABC')).toBeNull();
        expect(normalizeOrderNumber('%')).toBeNull();
        expect(normalizeOrderNumber(null)).toBeNull();
        expect(normalizeOrderNumber(42)).toBeNull();
    });
});

describe('comparing the email an order was placed with', () => {
    test('ignores case, because the shopper will not remember theirs', () => {
        expect(emailsMatch('Shopper@Example.com', 'shopper@example.com')).toBe(true);
        expect(emailsMatch('  shopper@example.com  ', 'shopper@example.com')).toBe(true);
    });

    test('rejects a different address, whatever its length', () => {
        expect(emailsMatch('someone@example.com', 'shopper@example.com')).toBe(false);
        expect(emailsMatch('s@e.co', 'shopper@example.com')).toBe(false);
        expect(emailsMatch('', 'shopper@example.com')).toBe(false);
    });
});

describe('finding a guest order', () => {
    test('returns the order and its lines when both halves are right', async () => {
        db.query.mockImplementation(async (sql) => {
            if (/FROM orders/i.test(sql)) return [[guestOrderRow()]];
            return [[{ product_id: 'p1', name: 'Thing', price: '1000.00', qty: 1 }]];
        });

        const order = await findGuestOrder({
            orderNumber: 'ORD-20260801-A1B2C3D4E5F60718',
            email: EMAIL
        });

        expect(order.order_number).toBe('ORD-20260801-A1B2C3D4E5F60718');
        expect(order.items).toHaveLength(1);
    });

    test('only looks at orders with no account behind them', async () => {
        respondWith([guestOrderRow()]);

        await findGuestOrder({
            orderNumber: 'ORD-20260801-A1B2C3D4E5F60718',
            email: EMAIL
        });

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/user_id IS NULL/i);
        expect(params).toEqual(['ORD-20260801-A1B2C3D4E5F60718']);
    });

    test('a wrong email finds nothing, and the order is not leaked in passing', async () => {
        respondWith([guestOrderRow()]);

        await expect(findGuestOrder({
            orderNumber: 'ORD-20260801-A1B2C3D4E5F60718',
            email: 'someone-else@example.com'
        })).resolves.toBeNull();

        // The lines are only fetched once the pair has been accepted.
        expect(db.query.mock.calls.filter(([sql]) => /FROM order_items/i.test(sql)))
            .toHaveLength(0);
    });

    test('an unknown order number finds nothing', async () => {
        respondWith([]);

        await expect(findGuestOrder({
            orderNumber: 'ORD-20260801-FFFFFFFFFFFFFFFF',
            email: EMAIL
        })).resolves.toBeNull();
    });

    // The two failures have to be indistinguishable from the outside, which
    // means the work done on each has to be the same: a missing row must not
    // skip the comparison a present one performs.
    test('the missing-row path does the same comparison the wrong-email path does', async () => {
        respondWith([]);

        const comparisons = [];
        const spy = jest.spyOn(require('crypto'), 'createHash');

        await findGuestOrder({
            orderNumber: 'ORD-20260801-FFFFFFFFFFFFFFFF',
            email: EMAIL
        });

        comparisons.push(spy.mock.calls.length);
        spy.mockClear();

        respondWith([guestOrderRow()]);

        await findGuestOrder({
            orderNumber: 'ORD-20260801-A1B2C3D4E5F60718',
            email: 'someone-else@example.com'
        });

        comparisons.push(spy.mock.calls.length);
        spy.mockRestore();

        expect(comparisons[0]).toBe(comparisons[1]);
        expect(comparisons[0]).toBeGreaterThan(0);
    });

    test('a malformed order number is refused before it reaches a query', async () => {
        await expect(findGuestOrder({
            orderNumber: "' OR '1'='1",
            email: EMAIL
        })).resolves.toBeNull();

        expect(db.query).not.toHaveBeenCalled();
    });
});
