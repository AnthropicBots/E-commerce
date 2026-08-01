// backend/tests/cartLifecycle.test.js
//
// Cart lifecycle (#1364).
//
// The database is mocked at the module boundary, as every healthy suite in this
// repo does. What is worth pinning here is not SQL text but the properties the
// lifecycle has to hold whatever the SQL looks like:
//
//   * an account has one active cart, and a race for it yields one, not two;
//   * a cart converts exactly once, against the order it actually became;
//   * the abandonment sweep is bounded, idempotent, and safe to run twice at
//     the same time;
//   * the reporting queries read cart state instead of columns and joins that
//     never existed.

jest.mock('../config/db', () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    // metricsAggregationService reaches the pool through `.promise`.
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
const logger = require('../utils/logger');
const cartLifecycle = require('../services/cartLifecycleService');
const cartConfig = require('../config/cartConfig');
const { MetricsAggregationService } = require('../services/metricsAggregationService');

const USER = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const CART = '33333333-3333-4333-8333-333333333333';

/** A connection double that records every statement and answers by pattern. */
function fakeConnection(responder) {
    const calls = [];

    const connection = {
        calls,
        query: jest.fn(async (sql, params = []) => {
            calls.push({ sql, params });
            return responder(sql, params);
        })
    };

    return connection;
}

function callsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

/** `count` cart id rows, as the sweep's candidate select returns them. */
function candidateRows(count, offset = 0) {
    return Array.from({ length: count }, (_, i) => ({ id: `cart-${offset + i}` }));
}

afterEach(() => {
    db.query.mockReset();
    logger.info.mockClear();
});

describe('resolving the active cart', () => {
    test('reuses the account\'s active cart rather than opening another', async () => {
        const connection = fakeConnection((sql) => {
            if (/SELECT id FROM carts/i.test(sql)) return [[{ id: CART }]];
            return [{ affectedRows: 1 }];
        });

        await expect(cartLifecycle.resolveActiveCart(USER, connection)).resolves.toBe(CART);
        expect(callsMatching(connection.calls, /INSERT INTO carts/i)).toHaveLength(0);
    });

    test('creates one when the account has none', async () => {
        const connection = fakeConnection((sql) => {
            if (/SELECT id FROM carts/i.test(sql)) return [[]];
            return [{ affectedRows: 1 }];
        });

        const cartId = await cartLifecycle.resolveActiveCart(USER, connection);

        const inserts = callsMatching(connection.calls, /INSERT INTO carts/i);
        expect(inserts).toHaveLength(1);
        expect(inserts[0].params).toEqual([cartId, USER, 'active']);
        expect(cartId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    test('adopts the winner\'s cart when it loses the race for the single active slot', async () => {
        // Two concurrent add-to-cart requests: the unique key on carts rejects
        // the loser, which must end up on the winner's cart and not throw.
        let selects = 0;

        const connection = fakeConnection((sql) => {
            if (/SELECT id FROM carts/i.test(sql)) {
                selects += 1;
                return selects === 1 ? [[]] : [[{ id: CART }]];
            }
            if (/INSERT INTO carts/i.test(sql)) {
                const duplicate = new Error('Duplicate entry for key uq_carts_one_active');
                duplicate.code = 'ER_DUP_ENTRY';
                throw duplicate;
            }
            return [{ affectedRows: 1 }];
        });

        await expect(cartLifecycle.resolveActiveCart(USER, connection)).resolves.toBe(CART);

        // The recovery read has to be a locking one: under REPEATABLE READ the
        // transaction's own snapshot would not contain the winner's row.
        const recovery = callsMatching(connection.calls, /SELECT id FROM carts/i).pop();
        expect(recovery.sql).toMatch(/FOR UPDATE/i);
    });

    test('refuses to invent an ownerless cart', async () => {
        await expect(cartLifecycle.resolveActiveCart(null)).rejects.toThrow(/signed-in account/i);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('touching a cart moves only its activity clock, and only while active', async () => {
        db.query.mockResolvedValue([{ affectedRows: 1 }]);

        await cartLifecycle.touchCart(CART);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/UPDATE carts SET last_activity_at = NOW\(\)/i);
        expect(sql).toMatch(/status = \?/i);
        expect(params).toEqual([CART, 'active']);
    });

    test('touching nothing is a no-op, so an account with no cart costs no query', async () => {
        await cartLifecycle.touchCart(null);
        expect(db.query).not.toHaveBeenCalled();
    });
});

describe('active -> converted', () => {
    test('records the order the cart became, on the caller\'s connection', async () => {
        const connection = fakeConnection((sql) => {
            if (/SELECT id FROM carts/i.test(sql)) return [[{ id: CART }]];
            return [{ affectedRows: 1 }];
        });

        await expect(cartLifecycle.markCartConverted(USER, ORDER, connection))
            .resolves.toEqual({ cartId: CART, converted: true });

        const [update] = callsMatching(connection.calls, /UPDATE carts/i);
        expect(update.sql).toMatch(/converted_order_id = \?/i);
        expect(update.sql).toMatch(/converted_at = NOW\(\)/i);
        expect(update.params).toEqual(['converted', ORDER, CART, 'active']);

        // Never on the pool: the conversion belongs to the order's transaction.
        expect(db.query).not.toHaveBeenCalled();
    });

    test('is idempotent -- a cart already converted is not re-pointed at a second order', async () => {
        const connection = fakeConnection((sql) => {
            if (/SELECT id FROM carts/i.test(sql)) return [[{ id: CART }]];
            return [{ affectedRows: 0 }];
        });

        await expect(cartLifecycle.markCartConverted(USER, ORDER, connection))
            .resolves.toEqual({ cartId: CART, converted: false });
    });

    test('an account is not how a guest cart is found, and that is not an error', async () => {
        const connection = fakeConnection(() => [[]]);

        await expect(cartLifecycle.markCartConverted(null, ORDER, connection))
            .resolves.toEqual({ cartId: null, converted: false });
        expect(connection.query).not.toHaveBeenCalled();
    });

    // A guest cart converts on exactly the same terms; the caller names it
    // rather than reaching it through an owner it does not have (#1427).
    test('a named cart converts without an account being involved at all', async () => {
        const connection = fakeConnection(() => [{ affectedRows: 1 }]);

        await expect(cartLifecycle.markCartConvertedById(CART, ORDER, connection))
            .resolves.toEqual({ cartId: CART, converted: true });

        expect(callsMatching(connection.calls, /SELECT id FROM carts/i)).toHaveLength(0);

        const [update] = callsMatching(connection.calls, /UPDATE carts/i);
        expect(update.params).toEqual(['converted', ORDER, CART, 'active']);
    });

    test('a named cart already converted is not re-pointed at a second order', async () => {
        const connection = fakeConnection(() => [{ affectedRows: 0 }]);

        await expect(cartLifecycle.markCartConvertedById(CART, ORDER, connection))
            .resolves.toEqual({ cartId: CART, converted: false });
    });
});

describe('active -> abandoned (the sweep)', () => {
    test('works in bounded batches instead of one statement over the table', async () => {
        const batchSize = 2;
        let selects = 0;

        db.query.mockImplementation(async (sql) => {
            if (/SELECT c\.id/i.test(sql)) {
                selects += 1;
                // Two full batches, then a short one, which ends the run.
                if (selects <= 2) return [candidateRows(batchSize, selects * 10)];
                return [candidateRows(1, 99)];
            }
            return [{ affectedRows: 2 }];
        });

        const summary = await cartLifecycle.sweepAbandonedCarts({ batchSize, maxBatches: 10 });

        expect(summary.batches).toBe(3);
        expect(summary.scanned).toBe(5);
        expect(summary.exhausted).toBe(true);

        const candidateSelects = db.query.mock.calls.filter(([sql]) => /SELECT c\.id/i.test(sql));
        expect(candidateSelects).toHaveLength(3);
        for (const [sql, params] of candidateSelects) {
            expect(sql).toMatch(/LIMIT \?/i);
            expect(params[params.length - 1]).toBe(batchSize);
        }
    });

    test('stops at the batch ceiling and says the backlog is not drained', async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT c\.id/i.test(sql)) return [candidateRows(2)];
            return [{ affectedRows: 2 }];
        });

        const summary = await cartLifecycle.sweepAbandonedCarts({ batchSize: 2, maxBatches: 3 });

        expect(summary.batches).toBe(3);
        expect(summary.abandoned).toBe(6);
        expect(summary.exhausted).toBe(false);
        expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/backlog remains/i));
    });

    test('a second run over the same carts transitions nothing', async () => {
        // The guard is `status = 'active'`: the first run flipped them, so the
        // candidate select finds none the second time round.
        db.query.mockImplementation(async (sql) => {
            if (/SELECT c\.id/i.test(sql)) return [[]];
            return [{ affectedRows: 0 }];
        });

        const summary = await cartLifecycle.sweepAbandonedCarts();

        expect(summary).toMatchObject({ abandoned: 0, scanned: 0, exhausted: true });
        expect(db.query.mock.calls.filter(([sql]) => /UPDATE carts/i.test(sql))).toHaveLength(0);
    });

    test('counts only what it changed, so two instances running at once cannot double-count', async () => {
        // Three candidates selected, one of which another instance transitioned
        // between the select and the update.
        db.query.mockImplementation(async (sql) => {
            if (/SELECT c\.id/i.test(sql)) return [candidateRows(3)];
            return [{ affectedRows: 2 }];
        });

        const summary = await cartLifecycle.sweepAbandonedCarts({ batchSize: 3, maxBatches: 1 });

        expect(summary.scanned).toBe(3);
        expect(summary.abandoned).toBe(2);

        const [updateSql, updateParams] = db.query.mock.calls
            .find(([sql]) => /UPDATE carts/i.test(sql));
        expect(updateSql).toMatch(/status = \?\s*$|AND status = \?/i);
        expect(updateParams[0]).toBe('abandoned');
        expect(updateParams[updateParams.length - 1]).toBe('active');
    });

    test('leaves empty carts alone -- a basket with nothing in it was never abandoned', async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT c\.id/i.test(sql)) return [[]];
            return [{ affectedRows: 0 }];
        });

        await cartLifecycle.sweepAbandonedCarts();

        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM cart_items/i);
    });

    test('measures inactivity against the configured threshold', async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT c\.id/i.test(sql)) return [[]];
            return [{ affectedRows: 0 }];
        });

        const summary = await cartLifecycle.sweepAbandonedCarts();

        expect(summary.inactivityMinutes).toBe(cartConfig.ABANDON_AFTER_MINUTES);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/DATE_SUB\(NOW\(\), INTERVAL \? MINUTE\)/i);
        expect(params).toContain(cartConfig.ABANDON_AFTER_MINUTES);
    });

    test('reports the figure, so "nothing to do" reads differently from "did nothing"', async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT c\.id/i.test(sql)) return [candidateRows(1)];
            return [{ affectedRows: 1 }];
        });

        await cartLifecycle.sweepAbandonedCarts({ batchSize: 5 });

        expect(logger.info).toHaveBeenCalledWith(
            expect.stringMatching(/1 cart\(s\) transitioned from 1 candidate\(s\)/i)
        );
    });
});

describe('reporting reads cart state', () => {
    let metrics;

    beforeEach(() => {
        // A fresh instance per test: the service memoizes results for five
        // minutes, which would otherwise answer the next test from cache.
        metrics = new MetricsAggregationService();
    });

    test('conversion is counted from the cart\'s own status', async () => {
        db.query.mockResolvedValue([[{ carts: 10, orders: 4, conversion_rate: 40 }]]);

        const result = await metrics.getConversionRate('week');

        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/FROM carts c/i);
        expect(sql).toMatch(/status = 'converted'/i);
        // `orders` has no cart_id -- the cart is what knows which order it became.
        expect(sql).not.toMatch(/o\.cart_id/i);

        expect(result).toMatchObject({ metric: 'conversion_rate', carts: 10, orders: 4, value: 40 });
    });

    test('the abandonment denominator is every cart in the window, not the abandoned ones', async () => {
        db.query.mockResolvedValue([[{
            total_carts: 8,
            abandoned_carts: 2,
            abandoned_rate: 25,
            lost_revenue: 1500
        }]]);

        const result = await metrics.getAbandonedCartRate('week');

        const [sql] = db.query.mock.calls[0];
        // The old query filtered the whole population to `status = 'abandoned'`,
        // which made the rate 100% by construction.
        expect(sql).not.toMatch(/WHERE[\s\S]*status = 'abandoned'/i);
        expect(sql).toMatch(/SUM\(CASE WHEN c\.status = 'abandoned'/i);

        expect(result).toMatchObject({
            metric: 'abandoned_cart',
            totalCarts: 8,
            abandonedCarts: 2,
            value: 25,
            lostRevenue: 1500
        });
    });

    test('what a cart was worth is priced from its lines, since a cart stores no total', async () => {
        db.query.mockResolvedValue([[{}]]);

        await metrics.getAbandonedCartRate('month');

        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/SUM\(ci\.quantity \* p\.price\)/i);
        expect(sql).not.toMatch(/total_value/i);
    });

    test('a category filter asks what is in the cart', async () => {
        db.query.mockResolvedValue([[{}]]);

        await metrics.getConversionRate('week', { category: 7 });

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM cart_items ci/i);
        expect(sql).toMatch(/p\.category_id = \?/i);
        expect(params[params.length - 1]).toBe(7);
    });

    // A guest basket merged at sign-in is the same basket as the account cart
    // it went into, so counting both would move every cart rate for a reason
    // that has nothing to do with trading (#1427).
    test('a basket counted once before sign-in is not counted twice after it', async () => {
        db.query.mockResolvedValue([[{}]]);

        await metrics.getConversionRate('week');
        await metrics.getAbandonedCartRate('week');

        for (const [sql] of db.query.mock.calls) {
            expect(sql).toMatch(/c\.status <> 'merged'/i);
        }
    });

    test('an empty result set reads as zero rather than NaN', async () => {
        db.query.mockResolvedValue([[]]);

        const conversion = await metrics.getConversionRate('today');
        const abandoned = await metrics.getAbandonedCartRate('today');

        expect(conversion).toMatchObject({ value: 0, carts: 0, orders: 0 });
        expect(abandoned).toMatchObject({ value: 0, totalCarts: 0, abandonedCarts: 0 });
    });
});
