// backend/tests/cartRecovery.test.js
//
// Abandoned-cart recovery (#1429).
//
// The database is mocked at the module boundary, as the rest of this suite
// does. What is pinned here is the suppression policy rather than SQL text,
// because the policy is the feature: a run that sends the right message is
// unremarkable, and a run that sends one it should have withheld is the
// failure that reaches a shopper's inbox.

jest.mock('../config/db', () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    // notificationBrokerService reaches the pool through `.promise`.
    pool.promise = pool;
    return pool;
});

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../services/notificationBrokerService', () => ({
    NOTIFICATION_TYPES: { CART_RECOVERY: 'cart.recovery' },
    notificationBroker: { publish: jest.fn(async () => ({ id: 'n1' })) }
}));

jest.mock('../services/notificationEmailService', () => ({
    sendNotificationEmail: jest.fn(async () => ({ delivered: false, channel: 'log' }))
}));

const db = require('../config/db');
const logger = require('../utils/logger');
const { notificationBroker } = require('../services/notificationBrokerService');
const { sendNotificationEmail } = require('../services/notificationEmailService');
const cartRecovery = require('../services/cartRecoveryService');
const cartRecoveryConfig = require('../config/cartRecoveryConfig');
const {
    runCartRecoveryJob,
    startCartRecoveryJob,
    CART_RECOVERY_CRON
} = require('../jobs/cartRecoveryJob');

const USER = '11111111-1111-4111-8111-111111111111';
const CART = '33333333-3333-4333-8333-333333333333';
const SECOND_CART = '44444444-4444-4444-8444-444444444444';

const { SUPPRESSION } = cartRecovery;

/**
 * A candidate row shaped as findRecoveryCandidates returns it: eligible in
 * every respect, so each test can spoil exactly one thing.
 */
function candidate(overrides = {}) {
    return {
        cart_id: CART,
        user_id: USER,
        abandoned_at: '2026-01-01 10:00:00',
        user_email: 'shopper@example.com',
        user_name: 'Sam',
        unsubscribed_all: 0,
        cart_recovery_email: 1,
        cart_recovery_in_app: 1,
        minutes_since_abandoned: 100000,
        line_count: 2,
        messages_for_cart: 0,
        messages_in_window: 0,
        orders_since_abandoned: 0,
        ...overrides
    };
}

/**
 * Answer the sweep's three query shapes: the candidate scan, the send-log
 * insert, and the basket preview.
 */
function mockSweep(candidates, { insertFails = false } = {}) {
    db.query.mockImplementation(async (sql) => {
        if (/FROM carts c/i.test(sql)) return [candidates];

        if (/INSERT INTO cart_recovery_log/i.test(sql)) {
            if (insertFails) {
                const duplicate = new Error('Duplicate entry for key uq_cart_recovery_dedupe');
                duplicate.code = 'ER_DUP_ENTRY';
                throw duplicate;
            }
            return [{ affectedRows: 1 }];
        }

        if (/FROM cart_items ci/i.test(sql)) {
            return [[{ name: 'Tee', price: 20, quantity: 1, color: '', size: '' }]];
        }

        return [{ affectedRows: 1 }];
    });
}

afterEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
});

describe('the recovery sequence', () => {
    test('position in the configured delays is the stage number', () => {
        const delays = [60, 1440];

        expect(cartRecovery.dueStage(0, 60, delays)).toBe(0);
        expect(cartRecovery.dueStage(1, 1440, delays)).toBe(1);
    });

    test('a stage that is not due yet is owed nothing', () => {
        expect(cartRecovery.dueStage(0, 59, [60, 1440])).toBeNull();
        expect(cartRecovery.dueStage(1, 100, [60, 1440])).toBeNull();
    });

    test('the sequence ends rather than repeating its last step forever', () => {
        expect(cartRecovery.dueStage(2, 99999, [60, 1440])).toBeNull();
    });

    test('the delays are configuration, and ordered', () => {
        const delays = cartRecoveryConfig.STAGE_DELAYS_MINUTES;

        expect(delays.length).toBeGreaterThan(0);
        expect([...delays]).toEqual([...delays].sort((a, b) => a - b));
    });

    test('one basket at one step has one key, whatever else is going on', () => {
        expect(cartRecovery.dedupeKey(CART, 0)).toBe(`${CART}:0`);
        expect(cartRecovery.dedupeKey(CART, 1)).not.toBe(cartRecovery.dedupeKey(CART, 0));
    });
});

describe('preferences decide the channels', () => {
    test('the global opt-out silences everything', () => {
        expect(
            cartRecovery.recoveryChannels({
                unsubscribed_all: 1,
                cart_recovery_email: 1,
                cart_recovery_in_app: 1
            })
        ).toEqual([]);
    });

    test('a channel turned off is not used', () => {
        expect(
            cartRecovery.recoveryChannels({
                unsubscribed_all: 0,
                cart_recovery_email: 0,
                cart_recovery_in_app: 1
            })
        ).toEqual(['in_app']);
    });

    // A shopper who has never opened the preference centre has no row at all,
    // and the LEFT JOIN hands the sender nulls rather than the column defaults.
    test('never having expressed a preference is not the same as refusing', () => {
        expect(cartRecovery.recoveryChannels({})).toEqual(['in_app', 'email']);
    });
});

describe('a due basket', () => {
    test('is recorded before it is sent, and sent on the allowed channels', async () => {
        mockSweep([candidate()]);

        const summary = await cartRecovery.runRecoverySweep();

        expect(summary.sent).toBe(1);

        const statements = db.query.mock.calls.map(([sql]) => sql);
        const insertAt = statements.findIndex((sql) => /INSERT INTO cart_recovery_log/i.test(sql));

        expect(insertAt).toBeGreaterThanOrEqual(0);
        expect(notificationBroker.publish).toHaveBeenCalledWith(
            'cart.recovery',
            expect.objectContaining({ userId: USER, cartId: CART, stage: 0 }),
            expect.objectContaining({ channels: ['in_app', 'email'] })
        );
        expect(sendNotificationEmail).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'shopper@example.com' })
        );
    });

    test('claims its dedupe key before the message leaves', async () => {
        mockSweep([candidate()]);

        await cartRecovery.runRecoverySweep();

        const [, params] = db.query.mock.calls
            .find(([sql]) => /INSERT INTO cart_recovery_log/i.test(sql));

        // id, cart, user, stage, channels, dedupe key.
        expect(params[1]).toBe(CART);
        expect(params[2]).toBe(USER);
        expect(params[3]).toBe(0);
        expect(params[5]).toBe(`${CART}:0`);
    });
});

describe('suppression', () => {
    /**
     * Run one candidate and report which rule, if any, withheld the message.
     */
    async function sweepOne(overrides, options = {}) {
        mockSweep([candidate(overrides)], options);

        const summary = await cartRecovery.runRecoverySweep(options.sweep);
        const [reason] =
            Object.entries(summary.suppressed).find(([, count]) => count > 0) || [null];

        return { summary, reason };
    }

    test('an emptied basket is nothing to come back to', async () => {
        const { summary, reason } = await sweepOne({ line_count: 0 });

        expect(summary.sent).toBe(0);
        expect(reason).toBe(SUPPRESSION.BASKET_EMPTIED);
    });

    test('buying stops the sequence', async () => {
        const { summary, reason } = await sweepOne({ orders_since_abandoned: 1 });

        expect(summary.sent).toBe(0);
        expect(reason).toBe(SUPPRESSION.ALREADY_BOUGHT);
        expect(notificationBroker.publish).not.toHaveBeenCalled();
    });

    test('a shopper who opted out hears nothing', async () => {
        const { summary, reason } = await sweepOne({ unsubscribed_all: 1 });

        expect(summary.sent).toBe(0);
        expect(reason).toBe(SUPPRESSION.OPTED_OUT);
    });

    test('email-only preferences with no address on file send nothing', async () => {
        const { reason } = await sweepOne({
            user_email: null,
            cart_recovery_in_app: 0
        });

        expect(reason).toBe(SUPPRESSION.NO_ADDRESS);
    });

    test('a basket that has had every message in the sequence gets no more', async () => {
        const { reason } = await sweepOne({
            messages_for_cart: cartRecoveryConfig.STAGE_DELAYS_MINUTES.length
        });

        expect(reason).toBe(SUPPRESSION.SEQUENCE_COMPLETE);
    });

    test('a basket abandoned moments ago waits for its first stage', async () => {
        const { reason } = await sweepOne({ minutes_since_abandoned: 0 });

        expect(reason).toBe(SUPPRESSION.NOT_DUE);
    });

    test('the frequency cap counts messages to the person, not to the basket', async () => {
        const { reason } = await sweepOne(
            { messages_in_window: cartRecoveryConfig.FREQUENCY_CAP_MESSAGES },
            { sweep: {} }
        );

        expect(reason).toBe(SUPPRESSION.FREQUENCY_CAP);
    });

    // Two instances sweeping at once select the same basket; the unique key on
    // the send log is what decides which of them gets to send.
    test('losing the race for the send log is an outcome, not a fault', async () => {
        const { summary, reason } = await sweepOne({}, { insertFails: true });

        expect(summary.sent).toBe(0);
        expect(reason).toBe(SUPPRESSION.ALREADY_SENT);
        expect(notificationBroker.publish).not.toHaveBeenCalled();
    });

    test('a cap spent earlier in the same run still binds later in it', async () => {
        // Two baskets, one shopper, a cap of one. The pre-run count is zero for
        // both rows, so only carrying the spend forward stops the second send.
        mockSweep([candidate(), candidate({ cart_id: SECOND_CART })]);

        const summary = await cartRecovery.runRecoverySweep({ frequencyCapMessages: 1 });

        expect(summary.candidates).toBe(2);
        expect(summary.sent).toBe(1);
        expect(summary.suppressed[SUPPRESSION.FREQUENCY_CAP]).toBe(1);
    });

    test('the run says which rule did the work', async () => {
        await sweepOne({ orders_since_abandoned: 1 });

        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining(SUPPRESSION.ALREADY_BOUGHT)
        );
    });
});

describe('delivery failure', () => {
    test('keeps the send log, so a broken transport cannot resend forever', async () => {
        mockSweep([candidate()]);
        notificationBroker.publish.mockRejectedValueOnce(new Error('broker down'));

        const summary = await cartRecovery.runRecoverySweep();

        expect(summary.sent).toBe(0);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('delivery failed'));

        const deletes = db.query.mock.calls
            .filter(([sql]) => /DELETE FROM cart_recovery_log/i.test(sql));
        expect(deletes).toHaveLength(0);
    });
});

describe('the candidate scan', () => {
    test('looks only at abandoned baskets inside the give-up window', async () => {
        mockSweep([]);

        await cartRecovery.runRecoverySweep();

        const [sql, params] = db.query.mock.calls[0];

        expect(sql).toMatch(/c\.status = \?/i);
        expect(sql).toMatch(/c\.abandoned_at > DATE_SUB\(NOW\(\), INTERVAL \? MINUTE\)/i);
        expect(params).toContain('abandoned');
        expect(params).toContain(cartRecoveryConfig.GIVE_UP_AFTER_MINUTES);
        expect(params[params.length - 1]).toBe(cartRecoveryConfig.SCAN_BATCH_SIZE);
    });

    test('is bounded, so a backlog drains across runs', async () => {
        mockSweep([]);

        await cartRecovery.runRecoverySweep({ batchSize: 25 });

        const [sql, params] = db.query.mock.calls[0];

        expect(sql).toMatch(/LIMIT \?/i);
        expect(params[params.length - 1]).toBe(25);
    });
});

describe('cartRecoveryJob', () => {
    test('exports a cron expression', () => {
        expect(CART_RECOVERY_CRON).toMatch(/\S+/);
    });

    test('is a no-op under test', () => {
        process.env.NODE_ENV = 'test';
        expect(startCartRecoveryJob()).toBeNull();
    });

    test('returns the sweep summary', async () => {
        const spy = jest
            .spyOn(cartRecovery, 'runRecoverySweep')
            .mockResolvedValue({ candidates: 0, sent: 0, suppressed: {} });

        await expect(runCartRecoveryJob()).resolves.toEqual({
            candidates: 0,
            sent: 0,
            suppressed: {}
        });

        spy.mockRestore();
    });
});
