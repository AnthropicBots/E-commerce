// backend/tests/subscriptionRenewal.test.js
//
// Subscription renewal (#1494).
//
// The job had never run. `SELECT s.*, p.price, p.interval, p.interval_count`
// names a reserved word unquoted, so MySQL refused the statement, the parse
// error landed in the job's own catch, and the sweep logged one line and
// returned. Every subscription ever created is still `active` with a period
// end in the past.
//
// The first describe below is the regression that matters most and it is a
// static one: assert on the SQL text. A mocked `db.query` accepts any string,
// so no behavioural test in a suite without a live MySQL can tell a quoted
// identifier from an unquoted one -- and an unquoted one is the entire bug.
// Everything after that is behaviour.

jest.mock('../config/db', () => {
    const query = jest.fn();
    const withTransaction = jest.fn(async (fn) => fn({ query: mockConnectionQuery }));

    return Object.assign({ query, getConnection: jest.fn() }, { withTransaction });
});

// Declared with a `mock` prefix so the factory above may close over it.
const mockConnectionQuery = jest.fn();

const fs = require('fs');
const path = require('path');

const db = require('../config/db');
const subscriptionService = require('../services/subscriptionService');
const { SubscriptionError } = require('../services/subscriptionService');

const USER = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([[]]);
    mockConnectionQuery.mockResolvedValue([[]]);
});

// ---------------------------------------------------------------------------
// The bug itself
// ---------------------------------------------------------------------------

describe('the reserved word', () => {
    const SOURCES = [
        'services/subscriptionService.js',
        'jobs/subscriptionRenewalJob.js',
        'controllers/subscriptionController.js'
    ];

    test.each(SOURCES)('%s never names `interval` unquoted in SQL', (relative) => {
        const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

        // `p.interval` / `billing_plans.interval` / a bare `, interval` in a
        // select list. The backticked form is what MySQL requires and is what
        // migration 0024 uses in the DDL.
        const unquoted = [
            /\b[a-z_]+\.interval\b(?!`)/gi,
            /(?:SELECT|,)\s+interval\s*(?:,|\s+FROM)/gi
        ];

        const offenders = [];

        for (const pattern of unquoted) {
            for (const match of source.matchAll(pattern)) {
                // `p.\`interval\`` matches nothing here; a JS property access
                // like `subscription.interval` is not SQL and is fine.
                const line = source.slice(0, match.index).split('\n').length;
                const text = source.split('\n')[line - 1];

                if (/`interval`/.test(text)) continue;

                // Only flag it if the line looks like SQL. The keyword check
                // is deliberately case-sensitive: this repo writes SQL
                // keywords in caps, and a lowercase `from` is a JavaScript
                // parameter name -- `advancePeriod(from, interval, ...)`
                // otherwise reads as a select list.
                if (!/\b(SELECT|FROM|JOIN|SET|WHERE)\b/.test(text)) continue;

                offenders.push(`${relative}:${line}: ${text.trim()}`);
            }
        }

        expect(offenders).toEqual([]);
    });

    test('the due-rows query quotes it', async () => {
        await subscriptionService.findDueForRenewal(new Date('2026-06-01T00:00:00Z'));

        const [sql] = db.query.mock.calls[0];

        expect(sql).toMatch(/p\.`interval`/);
        expect(sql).not.toMatch(/p\.interval\b(?!`)/);
    });
});

// ---------------------------------------------------------------------------
// Period arithmetic
// ---------------------------------------------------------------------------

describe('advancePeriod', () => {
    const START = new Date('2026-01-31T10:00:00Z');

    test.each([
        ['daily', 1, '2026-02-01'],
        ['daily', 10, '2026-02-10'],
        ['weekly', 1, '2026-02-07'],
        ['weekly', 2, '2026-02-14'],
        ['yearly', 1, '2027-01-31']
    ])('%s x%i advances to %s', (interval, count, expected) => {
        const end = subscriptionService.advancePeriod(START, interval, count);

        expect(end.toISOString().slice(0, 10)).toBe(expected);
    });

    test('does not mutate the date it is given', () => {
        const before = START.getTime();

        subscriptionService.advancePeriod(START, 'monthly', 1);

        expect(START.getTime()).toBe(before);
    });

    test('throws on an interval outside the enum instead of returning the start', () => {
        // Both previous copies of this fell through their else-if chain and
        // left `end === start`, producing a subscription whose period had
        // already expired at the moment it was created.
        expect(() => subscriptionService.advancePeriod(START, 'fortnightly', 1)).toThrow(
            SubscriptionError
        );
    });

    test('throws on an interval_count below one', () => {
        expect(() => subscriptionService.advancePeriod(START, 'monthly', 0)).toThrow(
            /at least 1/
        );
    });

    test('throws on an unusable start date', () => {
        expect(() => subscriptionService.advancePeriod('not a date', 'monthly', 1)).toThrow(
            SubscriptionError
        );
    });
});

describe('nextPeriod', () => {
    test('advances one period when only one has lapsed', () => {
        const result = subscriptionService.nextPeriod(
            new Date('2026-05-01T00:00:00Z'),
            'monthly',
            1,
            new Date('2026-05-02T00:00:00Z')
        );

        expect(result.periodsBilled).toBe(1);
        expect(result.end.toISOString().slice(0, 10)).toBe('2026-06-01');
    });

    test('catches up so the new period ends in the future', () => {
        // A subscription missed for four months should not come back with a
        // period that ended three months ago and get swept again next run.
        const result = subscriptionService.nextPeriod(
            new Date('2026-01-01T00:00:00Z'),
            'monthly',
            1,
            new Date('2026-05-15T00:00:00Z')
        );

        expect(result.periodsBilled).toBe(5);
        expect(result.end > new Date('2026-05-15T00:00:00Z')).toBe(true);
    });

    test('the catch-up loop is bounded', () => {
        // A daily plan abandoned for a decade must not spin.
        const result = subscriptionService.nextPeriod(
            new Date('2016-01-01T00:00:00Z'),
            'daily',
            1,
            new Date('2026-01-01T00:00:00Z')
        );

        expect(result.periodsBilled).toBeLessThanOrEqual(120);
    });
});

// ---------------------------------------------------------------------------
// Subscribing
// ---------------------------------------------------------------------------

describe('subscribe', () => {
    const PLAN = {
        id: 2,
        name: 'Monthly',
        price: 499,
        currency: 'INR',
        interval: 'monthly',
        interval_count: 1,
        trial_days: 0
    };

    test('locks the existence check inside the transaction', async () => {
        mockConnectionQuery
            .mockResolvedValueOnce([[PLAN]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([{ insertId: 11 }]);

        await subscriptionService.subscribe(USER, 2);

        const existenceCheck = mockConnectionQuery.mock.calls[1][0];

        // Without FOR UPDATE two concurrent requests both read zero rows and
        // both insert -- which is what the previous handler did, on a pool
        // connection with no transaction at all.
        expect(existenceCheck).toMatch(/FOR UPDATE/);
        expect(db.withTransaction).toHaveBeenCalled();
    });

    test('refuses a plan that does not exist', async () => {
        mockConnectionQuery.mockResolvedValueOnce([[]]);

        await expect(subscriptionService.subscribe(USER, 99)).rejects.toMatchObject({
            status: 404,
            code: 'PLAN_NOT_FOUND'
        });
    });

    test('refuses a second subscription', async () => {
        mockConnectionQuery
            .mockResolvedValueOnce([[PLAN]])
            .mockResolvedValueOnce([[{ id: 5, status: 'active', cancel_at_period_end: 0 }]]);

        await expect(subscriptionService.subscribe(USER, 2)).rejects.toMatchObject({
            status: 409,
            code: 'ALREADY_SUBSCRIBED'
        });
    });

    test('points a cancelling subscriber at resume rather than refusing flatly', async () => {
        // The old message was "User already has an active subscription", which
        // is technically true and useless: they had asked for it to end and
        // could neither un-cancel nor re-subscribe.
        mockConnectionQuery
            .mockResolvedValueOnce([[PLAN]])
            .mockResolvedValueOnce([[{ id: 5, status: 'active', cancel_at_period_end: 1 }]]);

        await expect(subscriptionService.subscribe(USER, 2)).rejects.toMatchObject({
            code: 'CANCELLATION_PENDING'
        });
    });

    test('a trial is a first period of its own length', async () => {
        mockConnectionQuery
            .mockResolvedValueOnce([[{ ...PLAN, trial_days: 14 }]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([{ insertId: 12 }]);

        const result = await subscriptionService.subscribe(USER, 2);
        const days = Math.round(
            (result.currentPeriodEnd - result.currentPeriodStart) / 86400000
        );

        expect(days).toBe(14);
    });

    test('refuses a plan with an unsupported billing interval', async () => {
        mockConnectionQuery.mockResolvedValueOnce([[{ ...PLAN, interval: 'fortnightly' }]]);

        await expect(subscriptionService.subscribe(USER, 2)).rejects.toMatchObject({
            status: 400,
            code: 'UNSUPPORTED_INTERVAL'
        });
    });

    test('rejects an unusable plan id before touching the database', async () => {
        await expect(subscriptionService.subscribe(USER, 'abc')).rejects.toMatchObject({
            code: 'INVALID_PLAN'
        });
        expect(db.withTransaction).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------

describe('resume', () => {
    const ROW = (overrides = {}) => ({
        id: 5,
        status: 'paused',
        cancel_at_period_end: 0,
        current_period_end: new Date('2026-07-01T00:00:00Z'),
        ...overrides
    });

    const READBACK = (overrides = {}) => [
        {
            id: 5,
            status: 'active',
            current_period_start: new Date('2026-06-01T00:00:00Z'),
            current_period_end: new Date('2026-07-01T00:00:00Z'),
            cancel_at_period_end: 0,
            canceled_at: null,
            dunning_retry_count: 0,
            created_at: new Date('2026-01-01T00:00:00Z'),
            plan_id: 2,
            plan_name: 'Monthly',
            plan_description: null,
            price: 499,
            currency: 'INR',
            interval: 'monthly',
            interval_count: 1,
            trial_days: 0,
            ...overrides
        }
    ];

    test('un-pauses a paused subscription', async () => {
        mockConnectionQuery
            .mockResolvedValueOnce([[ROW()]])
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([READBACK()]);

        const result = await subscriptionService.resume(USER);

        expect(result.status).toBe('active');
        expect(result.withdrewCancellation).toBe(false);
    });

    test('withdraws a pending cancellation on an active subscription', async () => {
        // This is the case that used to answer "No paused subscription found
        // to resume": the shopper pressed Cancel, changed their mind, and had
        // nothing to press.
        mockConnectionQuery
            .mockResolvedValueOnce([[ROW({ status: 'active', cancel_at_period_end: 1 })]])
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([READBACK()]);

        const result = await subscriptionService.resume(USER);

        expect(result.withdrewCancellation).toBe(true);
        expect(result.cancelAtPeriodEnd).toBe(false);

        const update = mockConnectionQuery.mock.calls[1][0];
        expect(update).toMatch(/cancel_at_period_end = 0/);
    });

    test('refuses when there is nothing to resume', async () => {
        mockConnectionQuery.mockResolvedValueOnce([
            [ROW({ status: 'active', cancel_at_period_end: 0 })]
        ]);

        await expect(subscriptionService.resume(USER)).rejects.toMatchObject({
            code: 'NO_CHANGE'
        });
    });

    test('404s when the account has no subscription at all', async () => {
        mockConnectionQuery.mockResolvedValueOnce([[]]);

        await expect(subscriptionService.resume(USER)).rejects.toMatchObject({
            status: 404
        });
    });
});

describe('cancel', () => {
    test('sets the flag rather than ending the subscription immediately', async () => {
        mockConnectionQuery
            .mockResolvedValueOnce([[{ id: 5, status: 'active', cancel_at_period_end: 0 }]])
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([
                [
                    {
                        id: 5,
                        status: 'active',
                        current_period_start: new Date(),
                        current_period_end: new Date(),
                        cancel_at_period_end: 1,
                        canceled_at: null,
                        dunning_retry_count: 0,
                        created_at: new Date(),
                        plan_id: 2,
                        plan_name: 'Monthly',
                        plan_description: null,
                        price: 499,
                        currency: 'INR',
                        interval: 'monthly',
                        interval_count: 1,
                        trial_days: 0
                    }
                ]
            ]);

        const result = await subscriptionService.cancel(USER);

        expect(result.status).toBe('active');
        expect(result.cancelAtPeriodEnd).toBe(true);
    });

    test('is idempotent-refusing rather than silently repeating', async () => {
        mockConnectionQuery.mockResolvedValueOnce([
            [{ id: 5, status: 'active', cancel_at_period_end: 1 }]
        ]);

        await expect(subscriptionService.cancel(USER)).rejects.toMatchObject({
            code: 'NO_CHANGE'
        });
    });
});

// ---------------------------------------------------------------------------
// Renewal outcomes
// ---------------------------------------------------------------------------

describe('recordRenewal', () => {
    test('advances the period and clears the dunning counter', async () => {
        const subscription = {
            id: 5,
            current_period_start: new Date('2026-05-01T00:00:00Z'),
            current_period_end: new Date('2026-06-01T00:00:00Z'),
            interval: 'monthly',
            interval_count: 1
        };

        const result = await subscriptionService.recordRenewal(
            subscription,
            new Date('2026-06-02T00:00:00Z')
        );

        expect(result.outcome).toBe('renewed');
        expect(result.periodEnd.toISOString().slice(0, 10)).toBe('2026-07-01');

        const [sql, params] = mockConnectionQuery.mock.calls[0];
        expect(sql).toMatch(/dunning_retry_count = 0/);
        expect(params[0]).toEqual(subscription.current_period_end);
    });
});

describe('recordDunningFailure', () => {
    test('schedules the retry by moving the period end forward', async () => {
        // The old code left current_period_end alone, so the retry cadence was
        // whatever the sweep interval happened to be -- changing the schedule
        // silently changed the dunning policy.
        const now = new Date('2026-06-02T00:00:00Z');

        const result = await subscriptionService.recordDunningFailure(
            { id: 5, dunning_retry_count: 0 },
            now
        );

        expect(result.outcome).toBe('past_due');
        expect(result.retries).toBe(1);

        const [sql, params] = mockConnectionQuery.mock.calls[0];
        expect(sql).toMatch(/status = 'past_due'/);
        expect(params[1] > now).toBe(true);
    });

    test('cancels once the retries are exhausted', async () => {
        const result = await subscriptionService.recordDunningFailure(
            { id: 5, dunning_retry_count: subscriptionService.MAX_DUNNING_RETRIES - 1 },
            new Date()
        );

        expect(result.outcome).toBe('canceled');

        const [sql] = mockConnectionQuery.mock.calls[0];
        expect(sql).toMatch(/status = 'canceled'/);
    });
});
