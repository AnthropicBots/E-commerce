// backend/tests/cartRecoveryAttribution.test.js
//
// Recovery attribution (#1429).
//
// Two properties matter here and they pull against each other. Attribution has
// to be a recorded fact rather than a reconstruction, so the resolution rules
// are pinned; and it must never be able to cost a shopper their order, so the
// refusals are pinned as silent.

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
const attribution = require('../services/cartRecoveryAttributionService');
const cartRecoveryConfig = require('../config/cartRecoveryConfig');

const REF = '55555555-5555-4555-8555-555555555555';
const CART = '33333333-3333-4333-8333-333333333333';
const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';

/** A connection double that records every statement and answers by pattern. */
function fakeConnection(responder) {
    const calls = [];

    return {
        calls,
        query: jest.fn(async (sql, params = []) => {
            calls.push({ sql, params });
            return responder(sql, params);
        })
    };
}

const tokenRow = (overrides = {}) => ({
    id: REF,
    cart_id: CART,
    user_id: OWNER,
    ...overrides
});

afterEach(() => {
    db.query.mockReset();
});

describe('resolving a reference', () => {
    test('names the link and the basket it brought back', async () => {
        const connection = fakeConnection(() => [[tokenRow()]]);

        await expect(
            attribution.resolveAttribution({ recoveryRef: REF, userId: OWNER, connection })
        ).resolves.toEqual({ recoveryTokenId: REF, recoveredCartId: CART });
    });

    // A claim that an order was recovered must not survive an order that did
    // not happen.
    test('reads on the order\'s connection, never on the pool', async () => {
        const connection = fakeConnection(() => [[tokenRow()]]);

        await attribution.resolveAttribution({ recoveryRef: REF, userId: OWNER, connection });

        expect(connection.query).toHaveBeenCalled();
        expect(db.query).not.toHaveBeenCalled();
    });

    test('only counts a link that was actually spent, and spent recently', async () => {
        const connection = fakeConnection(() => [[tokenRow()]]);

        await attribution.resolveAttribution({ recoveryRef: REF, userId: OWNER, connection });

        const [{ sql, params }] = connection.calls;

        expect(sql).toMatch(/redeemed_at IS NOT NULL/i);
        expect(sql).toMatch(/redeemed_at > DATE_SUB\(NOW\(\), INTERVAL \? MINUTE\)/i);
        expect(params).toEqual([REF, cartRecoveryConfig.ATTRIBUTION_WINDOW_MINUTES]);
    });

    test('a stale reference attributes nothing', async () => {
        // Out of window, so the guarded select returns no row at all.
        const connection = fakeConnection(() => [[]]);

        await expect(
            attribution.resolveAttribution({ recoveryRef: REF, userId: OWNER, connection })
        ).resolves.toEqual({ recoveryTokenId: null, recoveredCartId: null });
    });

    test('a signed-in shopper cannot claim another account\'s recovery', async () => {
        const connection = fakeConnection(() => [[tokenRow()]]);

        await expect(
            attribution.resolveAttribution({ recoveryRef: REF, userId: STRANGER, connection })
        ).resolves.toEqual({ recoveryTokenId: null, recoveredCartId: null });
    });

    // Checking out without signing in is the case the restore link exists to
    // serve, so a guest order has no account to compare and is taken as given.
    test('a guest order is attributed', async () => {
        const connection = fakeConnection(() => [[tokenRow()]]);

        await expect(
            attribution.resolveAttribution({ recoveryRef: REF, userId: null, connection })
        ).resolves.toEqual({ recoveryTokenId: REF, recoveredCartId: CART });
    });

    test.each([
        ['absent', undefined],
        ['empty', ''],
        ['not a reference at all', 'or 1=1']
    ])('a reference that is %s costs no query', async (_name, recoveryRef) => {
        const connection = fakeConnection(() => [[]]);

        await expect(
            attribution.resolveAttribution({ recoveryRef, userId: OWNER, connection })
        ).resolves.toEqual({ recoveryTokenId: null, recoveredCartId: null });

        expect(connection.query).not.toHaveBeenCalled();
    });

    // Checkout calls this inside its own transaction. Anything thrown here
    // would roll the order back, which is trading revenue for a statistic.
    test('never throws over a reference it does not like', async () => {
        const connection = fakeConnection(() => [[tokenRow({ user_id: STRANGER })]]);

        await expect(
            attribution.resolveAttribution({ recoveryRef: REF, userId: OWNER, connection })
        ).resolves.toEqual({ recoveryTokenId: null, recoveredCartId: null });

        await expect(attribution.resolveAttribution()).resolves.toEqual({
            recoveryTokenId: null,
            recoveredCartId: null
        });
    });
});

describe('recovered revenue', () => {
    test('reports the recovered figures beside the total they came from', async () => {
        db.query.mockResolvedValue([[{
            total_orders: 20,
            total_revenue: 10000,
            recovered_orders: 3,
            recovered_revenue: 1500
        }]]);

        const report = await attribution.getRecoveredRevenue({ days: 30 });

        expect(report).toMatchObject({
            windowDays: 30,
            totalOrders: 20,
            totalRevenue: 10000,
            recoveredOrders: 3,
            recoveredRevenue: 1500,
            recoveredRevenueShare: 15
        });
    });

    test('counts recovery from the column, not from timing', async () => {
        db.query.mockResolvedValue([[{}]]);

        await attribution.getRecoveredRevenue({ days: 7 });

        const [sql] = db.query.mock.calls[0];

        expect(sql).toMatch(/o\.recovered_cart_id IS NOT NULL/i);
        // Nothing here reconstructs attribution from when a message was sent.
        expect(sql).not.toMatch(/cart_recovery_log/i);
    });

    test('leaves out cancelled and deleted orders', async () => {
        db.query.mockResolvedValue([[{}]]);

        await attribution.getRecoveredRevenue({});

        const [sql] = db.query.mock.calls[0];

        expect(sql).toMatch(/o\.deleted_at IS NULL/i);
        expect(sql).toMatch(/o\.status <> 'cancelled'/i);
    });

    test('a period with no trade reads as zero rather than NaN', async () => {
        db.query.mockResolvedValue([[]]);

        await expect(attribution.getRecoveredRevenue({})).resolves.toMatchObject({
            totalRevenue: 0,
            recoveredRevenue: 0,
            recoveredRevenueShare: 0
        });
    });

    test('the window is clamped, so a report cannot ask for all of history', async () => {
        db.query.mockResolvedValue([[{}]]);

        const report = await attribution.getRecoveredRevenue({ days: 100000 });

        expect(report.windowDays).toBe(365);
    });
});

describe('recovery by stage', () => {
    test('says which message in the sequence earned what', async () => {
        db.query.mockResolvedValue([[
            { stage: 0, messages: 10, orders: 3, revenue: 900 },
            { stage: 1, messages: 7, orders: 0, revenue: 0 }
        ]]);

        const byStage = await attribution.getRecoveryByStage({ days: 30 });

        expect(byStage).toEqual([
            { stage: 0, messages: 10, orders: 3, revenue: 900 },
            { stage: 1, messages: 7, orders: 0, revenue: 0 }
        ]);
    });

    test('a stage that sent messages and earned nothing still appears', async () => {
        db.query.mockResolvedValue([[{ stage: 1, messages: 7, orders: 0, revenue: null }]]);

        const byStage = await attribution.getRecoveryByStage({});

        expect(byStage).toEqual([{ stage: 1, messages: 7, orders: 0, revenue: 0 }]);

        // A LEFT JOIN is what keeps the unproductive stage in the report, and
        // an unproductive stage is the one worth seeing.
        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/LEFT JOIN orders o/i);
    });

    // A basket is asked about more than once. Matching orders to messages by
    // cart and timing would credit one order to every reminder before it.
    test('credits the message that was actually clicked', async () => {
        db.query.mockResolvedValue([[]]);

        await attribution.getRecoveryByStage({});

        const [sql] = db.query.mock.calls[0];

        expect(sql).toMatch(/t\.recovery_log_id = l\.id/i);
        expect(sql).toMatch(/o\.recovery_token_id = t\.id/i);
        expect(sql).not.toMatch(/o\.created_at >= l\.sent_at/i);
    });
});
