// backend/tests/cartMerge.test.js
//
// Folding a guest basket into an account's cart at sign-in (#1427).
//
// The database is mocked at the module boundary. What is pinned here is not
// SQL text but the four things a merge has to be true of:
//
//   * the account ends up with one cart, and the guest cart takes a terminal
//     exit that is neither "converted" nor "abandoned";
//   * the same line from both baskets is one line with the quantities added;
//   * only an ownerless cart can be absorbed, so presenting a token can never
//     move somebody else's basket onto your account;
//   * none of it can fail a sign-in.

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

jest.mock('../services/inventoryReservationService', () => ({
    releaseUserLocks: jest.fn().mockResolvedValue(undefined),
    reserveStock: jest.fn().mockResolvedValue(true)
}));

const db = require('../config/db');
const logger = require('../utils/logger');
const inventoryReservationService = require('../services/inventoryReservationService');
const guestCart = require('../services/guestCartService');
const cartMerge = require('../services/cartMergeService');
const cartConfig = require('../config/cartConfig');

const USER = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_CART = '33333333-3333-4333-8333-333333333333';
const GUEST_CART = '44444444-4444-4444-8444-444444444444';
const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function line(productId, quantity, overrides = {}) {
    return { product_id: productId, variant_id: 0, color: '', size: '', quantity, ...overrides };
}

/**
 * A connection double wired for the merge's sequence of reads.
 *
 * The guest cart lookup and the account cart lookup are both "SELECT id FROM
 * carts", told apart by which predicate they carry.
 */
function mergeConnection({ guestCartId = GUEST_CART, guestLines = [], accountLines = [] } = {}) {
    const calls = [];

    const connection = {
        calls,
        query: jest.fn(async (sql, params = []) => {
            calls.push({ sql, params });

            if (/guest_token_hash = \?/i.test(sql)) {
                return [guestCartId ? [{ id: guestCartId }] : []];
            }

            if (/SELECT id FROM carts/i.test(sql)) {
                return [[{ id: ACCOUNT_CART }]];
            }

            if (/FROM cart_items WHERE cart_id = \?/i.test(sql)) {
                return [params[0] === GUEST_CART ? guestLines : accountLines];
            }

            return [{ affectedRows: 1 }];
        })
    };

    return connection;
}

function callsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

/** The rows the merge inserted, read back out of the flattened parameter list. */
function insertedLines(calls) {
    const insert = callsMatching(calls, /INSERT INTO cart_items/i)[0];

    if (!insert) return [];

    const columns = 7;
    const rows = [];

    for (let i = 0; i < insert.params.length; i += columns) {
        const [userId, cartId, productId, variantId, color, size, quantity] =
            insert.params.slice(i, i + columns);
        rows.push({ userId, cartId, productId, variantId, color, size, quantity });
    }

    return rows;
}

afterEach(() => {
    db.query.mockReset();
    logger.info.mockClear();
    logger.error.mockClear();
    inventoryReservationService.reserveStock.mockClear();
    inventoryReservationService.releaseUserLocks.mockClear();
});

describe('what a merge does', () => {
    const token = guestCart.issueToken();

    test('adds the quantities of a line both baskets hold, and keeps the rest', async () => {
        const connection = mergeConnection({
            accountLines: [line(PRODUCT_A, 1)],
            guestLines: [line(PRODUCT_A, 2), line(PRODUCT_B, 3)]
        });

        const result = await cartMerge.mergeGuestCart(USER, token, connection);

        expect(result).toEqual({ merged: true, cartId: ACCOUNT_CART, lines: 2 });

        const rows = insertedLines(connection.calls);
        expect(rows).toHaveLength(2);
        expect(rows.find((row) => row.productId === PRODUCT_A).quantity).toBe(3);
        expect(rows.find((row) => row.productId === PRODUCT_B).quantity).toBe(3);
    });

    test('every surviving line lands on the account cart, owned by the account', async () => {
        const connection = mergeConnection({ guestLines: [line(PRODUCT_A, 1)] });

        await cartMerge.mergeGuestCart(USER, token, connection);

        for (const row of insertedLines(connection.calls)) {
            expect(row.cartId).toBe(ACCOUNT_CART);
            expect(row.userId).toBe(USER);
        }
    });

    test('the guest cart is closed as merged, naming the cart it went into', async () => {
        const connection = mergeConnection({ guestLines: [line(PRODUCT_A, 1)] });

        await cartMerge.mergeGuestCart(USER, token, connection);

        const [close] = callsMatching(connection.calls, /merged_into_cart_id/i);
        expect(close.params).toEqual(['merged', ACCOUNT_CART, GUEST_CART, 'active']);
    });

    // Not `abandoned`, which would say the shopper walked away from a basket
    // they in fact signed in to keep, and not `converted`, which would claim
    // an order that does not exist.
    test('the exit it takes is neither of the other two', async () => {
        const connection = mergeConnection({ guestLines: [line(PRODUCT_A, 1)] });

        await cartMerge.mergeGuestCart(USER, token, connection);

        const [close] = callsMatching(connection.calls, /merged_into_cart_id/i);
        expect(close.params).not.toContain('abandoned');
        expect(close.params).not.toContain('converted');
    });

    test('both carts are emptied before the merged set is written', async () => {
        const connection = mergeConnection({
            accountLines: [line(PRODUCT_A, 1)],
            guestLines: [line(PRODUCT_B, 1)]
        });

        await cartMerge.mergeGuestCart(USER, token, connection);

        const [clear] = callsMatching(connection.calls, /DELETE FROM cart_items/i);
        expect(clear.params).toEqual([ACCOUNT_CART, GUEST_CART]);

        const clearIndex = connection.calls.indexOf(clear);
        const insertIndex = connection.calls.findIndex(
            ({ sql }) => /INSERT INTO cart_items/i.test(sql)
        );
        expect(clearIndex).toBeLessThan(insertIndex);
    });

    // Adding two baskets is the one way a line can grow past a limit nobody
    // typed, and a cart no checkout would accept is worse than a short one.
    test('a combined line is capped at what checkout will accept', async () => {
        const connection = mergeConnection({
            accountLines: [line(PRODUCT_A, cartConfig.MAX_LINE_QUANTITY)],
            guestLines: [line(PRODUCT_A, 50)]
        });

        await cartMerge.mergeGuestCart(USER, token, connection);

        expect(insertedLines(connection.calls)[0].quantity)
            .toBe(cartConfig.MAX_LINE_QUANTITY);
    });

    test('holds stock for the merged lines, replacing what was held before', async () => {
        const connection = mergeConnection({ guestLines: [line(PRODUCT_A, 2)] });

        await cartMerge.mergeGuestCart(USER, token, connection);

        expect(inventoryReservationService.releaseUserLocks)
            .toHaveBeenCalledWith(USER, null, connection);
        expect(inventoryReservationService.reserveStock)
            .toHaveBeenCalledWith(USER, PRODUCT_A, 2, connection, expect.anything());
    });

    // A hold is a courtesy. "Somebody took the last one" is an answer checkout
    // can explain; arriving as a failed sign-in it would be inexplicable.
    test('a reservation it cannot get does not undo the merge', async () => {
        inventoryReservationService.reserveStock.mockRejectedValueOnce(
            new Error('nothing left')
        );

        const connection = mergeConnection({ guestLines: [line(PRODUCT_A, 2)] });

        await expect(cartMerge.mergeGuestCart(USER, token, connection))
            .resolves.toMatchObject({ merged: true });
    });
});

describe('what a merge refuses to do', () => {
    test('an empty guest basket still closes, so no live cart is left behind', async () => {
        const connection = mergeConnection({ guestLines: [] });

        const result = await cartMerge.mergeGuestCart(USER, guestCart.issueToken(), connection);

        expect(result).toEqual({ merged: false, cartId: ACCOUNT_CART, lines: 0 });
        expect(callsMatching(connection.calls, /INSERT INTO cart_items/i)).toHaveLength(0);
        expect(callsMatching(connection.calls, /merged_into_cart_id/i)).toHaveLength(1);
    });

    test('a token that reaches nothing changes nothing', async () => {
        const connection = mergeConnection({ guestCartId: null });

        await expect(cartMerge.mergeGuestCart(USER, guestCart.issueToken(), connection))
            .resolves.toEqual({ merged: false, cartId: null, lines: 0 });

        expect(callsMatching(connection.calls, /INSERT INTO cart_items/i)).toHaveLength(0);
    });

    // The lookup will only return a cart with no owner, so a token for an
    // account's cart resolves to nothing and no basket changes hands. Asserted
    // on the query because that predicate is the whole defence.
    test('only an ownerless cart is even a candidate', async () => {
        const connection = mergeConnection({ guestLines: [line(PRODUCT_A, 1)] });

        await cartMerge.mergeGuestCart(USER, guestCart.issueToken(), connection);

        const [lookup] = callsMatching(connection.calls, /guest_token_hash = \?/i);
        expect(lookup.sql).toMatch(/user_id IS NULL/i);
    });

    test('nothing happens without an account to merge into', async () => {
        const connection = mergeConnection();

        await expect(cartMerge.mergeGuestCart(null, guestCart.issueToken(), connection))
            .resolves.toEqual({ merged: false, cartId: null, lines: 0 });

        expect(connection.query).not.toHaveBeenCalled();
    });

    test('a token that is not one costs no query', async () => {
        const connection = mergeConnection();

        await expect(cartMerge.mergeGuestCart(USER, 'nonsense', connection))
            .resolves.toEqual({ merged: false, cartId: null, lines: 0 });

        expect(connection.query).not.toHaveBeenCalled();
    });
});

describe('merging at sign-in', () => {
    const requestWith = (token) => ({
        headers: token ? { 'x-cart-token': token } : {},
        get: (name) => (token && String(name).toLowerCase() === 'x-cart-token' ? token : undefined)
    });

    test('reports nothing to merge when the shopper brought no basket', async () => {
        await expect(cartMerge.mergeGuestCartOnSignIn(USER, requestWith(null)))
            .resolves.toBe(false);
    });

    // The property that matters most: a sign-in cannot be lost to a cart.
    test('swallows a failure rather than letting it reach the sign-in', async () => {
        db.getConnection.mockRejectedValue(new Error('pool exhausted'));

        await expect(cartMerge.mergeGuestCartOnSignIn(USER, requestWith(guestCart.issueToken())))
            .resolves.toBe(false);

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('Guest cart merge failed')
        );
    });
});
