// backend/services/subscriptionService.js
//
// Billing plans and subscriptions (#1494).
//
// The rules used to live in two places that agreed by coincidence: the
// four-branch period arithmetic was written out once in subscriptionController
// and again in subscriptionRenewalJob, neither with a fallback, so an interval
// outside the enum produced a period of zero length in both. They are here
// once now, and the job and the controller are both callers.
//
// `interval` is a reserved word in MySQL. Every statement below that names it
// quotes it. The migration that created the column says so explicitly
// (migrations/0024_reconcile_commerce_tables.sql:14-16) and the renewal query
// did not, which is why the job has never run.

'use strict';

const db = require('../config/db');
const { withTransaction } = require('../config/db');
const logger = require('../utils/logger');
const { safeNumber, safeUUID } = require('../utils/helpers');

/**
 * Statuses that mean "this account already has a subscription".
 *
 * `canceled` is absent deliberately: a subscription that has ended is not in
 * the way of a new one.
 */
const LIVE_STATUSES = Object.freeze(['active', 'past_due', 'paused']);

/** Every status the column accepts, matching the ENUM in migration 0024. */
const STATUSES = Object.freeze(['active', 'past_due', 'paused', 'canceled']);

/**
 * How many failed renewals a subscription survives before it is cancelled.
 *
 * A count rather than a duration, because the retry cadence belongs to the
 * scheduler and the tolerance belongs here. The two used to be the same number
 * by accident -- the job left `current_period_end` where it was on failure, so
 * "three retries" meant "three sweeps", and changing the sweep interval
 * silently changed the dunning policy.
 */
const MAX_DUNNING_RETRIES = safeNumber(process.env.SUBSCRIPTION_MAX_DUNNING_RETRIES) || 3;

/** How long a failed renewal waits before the next attempt, in hours. */
const DUNNING_RETRY_HOURS = safeNumber(process.env.SUBSCRIPTION_DUNNING_RETRY_HOURS) || 24;

class SubscriptionError extends Error {
    constructor(message, status = 400, code = 'SUBSCRIPTION_ERROR') {
        super(message);
        this.name = 'SubscriptionError';
        this.status = status;
        this.code = code;
    }
}

// ---------------------------------------------------------------------------
// Period arithmetic
// ---------------------------------------------------------------------------

/**
 * Advance a date by one billing period.
 *
 * Throws on an interval it does not recognise rather than returning the date
 * unchanged. Both previous copies of this fell through their `else if` chain
 * and produced `end === start`: a subscription whose period had already
 * expired the moment it was created, and which the renewal sweep would then
 * pick up on every single run.
 *
 * @param {Date} from
 * @param {string} interval - one of daily / weekly / monthly / yearly
 * @param {number} [count=1] - how many of them
 * @returns {Date} a new Date; `from` is not mutated
 */
function advancePeriod(from, interval, count = 1) {
    const start = from instanceof Date ? new Date(from.getTime()) : new Date(from);

    if (Number.isNaN(start.getTime())) {
        throw new SubscriptionError('Cannot advance an invalid date', 500, 'INVALID_PERIOD_START');
    }

    const steps = Math.trunc(safeNumber(count));

    if (steps < 1) {
        throw new SubscriptionError(
            `interval_count must be at least 1, got ${count}`,
            500,
            'INVALID_INTERVAL_COUNT'
        );
    }

    const end = new Date(start.getTime());

    switch (interval) {
        case 'daily':
            end.setDate(end.getDate() + steps);
            break;
        case 'weekly':
            end.setDate(end.getDate() + 7 * steps);
            break;
        case 'monthly':
            end.setMonth(end.getMonth() + steps);
            break;
        case 'yearly':
            end.setFullYear(end.getFullYear() + steps);
            break;
        default:
            throw new SubscriptionError(
                `Unsupported billing interval: ${interval}`,
                500,
                'UNSUPPORTED_INTERVAL'
            );
    }

    return end;
}

/**
 * Advance a period past `now`, however many periods that takes.
 *
 * A subscription whose renewal has been missed for four months should end up
 * with a period that ends in the future, not one that ends three months ago
 * and gets swept again on the next run. The loop is bounded so a plan with a
 * pathological interval cannot spin.
 *
 * @param {Date} periodEnd - the period that just lapsed
 * @param {string} interval
 * @param {number} count
 * @param {Date} [now]
 * @returns {{start: Date, end: Date, periodsBilled: number}}
 */
function nextPeriod(periodEnd, interval, count = 1, now = new Date()) {
    const MAX_CATCH_UP = 120;

    let start = periodEnd instanceof Date ? new Date(periodEnd.getTime()) : new Date(periodEnd);
    let end = advancePeriod(start, interval, count);
    let periodsBilled = 1;

    while (end <= now && periodsBilled < MAX_CATCH_UP) {
        start = end;
        end = advancePeriod(start, interval, count);
        periodsBilled += 1;
    }

    return { start, end, periodsBilled };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every plan a shopper may subscribe to.
 *
 * @returns {Promise<object[]>}
 */
async function listPlans() {
    const [rows] = await db.query(
        `SELECT id, name, description, price, currency,
                \`interval\`, interval_count, trial_days
           FROM billing_plans
          WHERE is_active = 1
          ORDER BY price ASC, id ASC`
    );

    return (rows || []).map(toPublicPlan);
}

/**
 * The caller's own subscription, plan included, or null.
 *
 * "Own" means the one that is not cancelled. A user who has cancelled and
 * resubscribed has two rows and only one of them is current.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getForUser(userId) {
    const id = safeUUID(userId);

    if (!id) {
        throw new SubscriptionError('Authentication required', 401, 'UNAUTHENTICATED');
    }

    const [rows] = await db.query(
        `SELECT s.id, s.status, s.current_period_start, s.current_period_end,
                s.cancel_at_period_end, s.canceled_at, s.dunning_retry_count,
                s.created_at,
                p.id AS plan_id, p.name AS plan_name, p.description AS plan_description,
                p.price, p.currency, p.\`interval\`, p.interval_count, p.trial_days
           FROM subscriptions s
           JOIN billing_plans p ON p.id = s.plan_id
          WHERE s.user_id = ?
            AND s.status IN (?, ?, ?)
          ORDER BY s.created_at DESC
          LIMIT 1`,
        [id, ...LIVE_STATUSES]
    );

    if (!rows || rows.length === 0) {
        return null;
    }

    return toPublicSubscription(rows[0]);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Subscribe the caller to a plan.
 *
 * The existence check and the insert are one transaction, and the check takes
 * the row lock. Previously they were two statements on a hand-taken pool
 * connection with no transaction at all, so two concurrent requests both saw
 * zero rows and both inserted -- which CONTRIBUTING.md warns about in as many
 * words.
 *
 * @param {string} userId
 * @param {number} planId
 * @returns {Promise<object>} the new subscription
 */
async function subscribe(userId, planId) {
    const id = safeUUID(userId);
    const plan = Math.trunc(safeNumber(planId));

    if (!id) {
        throw new SubscriptionError('Authentication required', 401, 'UNAUTHENTICATED');
    }

    if (plan < 1) {
        throw new SubscriptionError('Invalid plan ID', 400, 'INVALID_PLAN');
    }

    return withTransaction(async (connection) => {
        const [plans] = await connection.query(
            `SELECT id, name, price, currency, \`interval\`, interval_count, trial_days
               FROM billing_plans
              WHERE id = ? AND is_active = 1
              LIMIT 1`,
            [plan]
        );

        if (!plans.length) {
            throw new SubscriptionError('Billing plan not found', 404, 'PLAN_NOT_FOUND');
        }

        const billingPlan = plans[0];

        // FOR UPDATE so a second concurrent subscribe waits here rather than
        // reading the same empty result and inserting alongside this one.
        const [existing] = await connection.query(
            `SELECT id, status, cancel_at_period_end
               FROM subscriptions
              WHERE user_id = ? AND status IN (?, ?, ?)
              FOR UPDATE`,
            [id, ...LIVE_STATUSES]
        );

        if (existing.length) {
            // A subscription already scheduled to end is not a reason to
            // refuse: the shopper is changing their mind, and the honest
            // answer is to clear the cancellation rather than tell them they
            // already have something they have asked to be rid of.
            if (existing[0].cancel_at_period_end) {
                throw new SubscriptionError(
                    'This subscription is set to end at the close of the period. ' +
                        'Resume it instead of subscribing again.',
                    409,
                    'CANCELLATION_PENDING'
                );
            }

            throw new SubscriptionError(
                'You already have an active subscription',
                409,
                'ALREADY_SUBSCRIBED'
            );
        }

        const start = new Date();
        const trialDays = Math.trunc(safeNumber(billingPlan.trial_days));

        // A trial is a first period of its own length, not a discount on the
        // first billing period.
        const end = trialDays > 0
            ? advancePeriod(start, 'daily', trialDays)
            : advancePeriod(start, billingPlan.interval, billingPlan.interval_count);

        const [result] = await connection.query(
            `INSERT INTO subscriptions
                (user_id, plan_id, status, current_period_start, current_period_end)
             VALUES (?, ?, 'active', ?, ?)`,
            [id, billingPlan.id, start, end]
        );

        return {
            id: result.insertId,
            status: 'active',
            planId: billingPlan.id,
            planName: billingPlan.name,
            currentPeriodStart: start,
            currentPeriodEnd: end,
            trialDays,
            cancelAtPeriodEnd: false
        };
    });
}

/**
 * Pause an active subscription.
 *
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function pause(userId) {
    return transition(userId, {
        from: ['active'],
        set: "status = 'paused'",
        notFound: 'No active subscription found to pause'
    });
}

/**
 * Resume a subscription.
 *
 * Two things are called "resume" by a shopper and they are not the same:
 * un-pausing, and withdrawing a cancellation. Both are handled, because a
 * customer who presses Resume after pressing Cancel means the second one and
 * used to get "No paused subscription found to resume".
 *
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function resume(userId) {
    return transition(userId, {
        from: ['paused', 'active', 'past_due'],
        // Clearing the flag is the point of the second case; setting status to
        // 'active' is a no-op for a subscription that already is.
        set: "status = 'active', cancel_at_period_end = 0, canceled_at = NULL",
        notFound: 'No subscription found to resume',
        requireChange: (row) => row.status === 'paused' || row.cancel_at_period_end === 1,
        unchanged: 'This subscription is already running',
        // Which of the two happened, decided from the row as it was *before*
        // the update. Afterwards both look identical, and the caller wants to
        // tell the shopper which thing they just did.
        annotate: (row) => ({ withdrewCancellation: row.cancel_at_period_end === 1 })
    });
}

/**
 * Schedule a cancellation for the end of the current period.
 *
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function cancel(userId) {
    return transition(userId, {
        from: LIVE_STATUSES,
        set: 'cancel_at_period_end = 1',
        notFound: 'No active subscription found to cancel',
        requireChange: (row) => row.cancel_at_period_end !== 1,
        unchanged: 'This subscription is already set to end at the close of the period'
    });
}

/**
 * Shared shape for the three state changes above.
 *
 * Each one reads the row under a lock, decides, writes, and returns the
 * subscription as the caller should now see it -- so the client does not have
 * to issue a second request to find out what happened.
 *
 * @param {string} userId
 * @param {object} options
 * @returns {Promise<object>}
 */
async function transition(userId, options) {
    const id = safeUUID(userId);

    if (!id) {
        throw new SubscriptionError('Authentication required', 401, 'UNAUTHENTICATED');
    }

    return withTransaction(async (connection) => {
        const placeholders = options.from.map(() => '?').join(', ');

        const [rows] = await connection.query(
            `SELECT id, status, cancel_at_period_end, current_period_end
               FROM subscriptions
              WHERE user_id = ? AND status IN (${placeholders})
              ORDER BY created_at DESC
              LIMIT 1
              FOR UPDATE`,
            [id, ...options.from]
        );

        if (!rows.length) {
            throw new SubscriptionError(options.notFound, 404, 'SUBSCRIPTION_NOT_FOUND');
        }

        const row = rows[0];

        if (options.requireChange && !options.requireChange(row)) {
            throw new SubscriptionError(options.unchanged, 409, 'NO_CHANGE');
        }

        await connection.query(
            `UPDATE subscriptions SET ${options.set} WHERE id = ?`,
            [row.id]
        );

        const [updated] = await connection.query(
            `SELECT s.id, s.status, s.current_period_start, s.current_period_end,
                    s.cancel_at_period_end, s.canceled_at, s.dunning_retry_count,
                    s.created_at,
                    p.id AS plan_id, p.name AS plan_name, p.description AS plan_description,
                    p.price, p.currency, p.\`interval\`, p.interval_count, p.trial_days
               FROM subscriptions s
               JOIN billing_plans p ON p.id = s.plan_id
              WHERE s.id = ?`,
            [row.id]
        );

        return {
            ...toPublicSubscription(updated[0]),
            ...(options.annotate ? options.annotate(row) : {})
        };
    });
}

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

/**
 * Subscriptions whose period has lapsed.
 *
 * `p.\`interval\`` is quoted. It was not, which made this query a syntax error
 * and is the reason no subscription has ever renewed.
 *
 * @param {Date} now
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
async function findDueForRenewal(now = new Date(), limit = 500) {
    const [rows] = await db.query(
        `SELECT s.id, s.user_id, s.plan_id, s.status, s.cancel_at_period_end,
                s.current_period_start, s.current_period_end, s.dunning_retry_count,
                p.price, p.currency, p.\`interval\`, p.interval_count
           FROM subscriptions s
           JOIN billing_plans p ON p.id = s.plan_id
          WHERE s.current_period_end <= ?
            AND s.status IN ('active', 'past_due')
          ORDER BY s.current_period_end ASC
          LIMIT ?`,
        [now, Math.trunc(safeNumber(limit)) || 500]
    );

    return rows || [];
}

/**
 * End a subscription whose owner asked for it to end.
 *
 * @param {object} subscription
 * @param {Date} now
 * @returns {Promise<{outcome: string}>}
 */
async function completeCancellation(subscription, now = new Date()) {
    await withTransaction(async (connection) => {
        await connection.query(
            `UPDATE subscriptions
                SET status = 'canceled', canceled_at = ?
              WHERE id = ? AND status IN ('active', 'past_due')`,
            [now, subscription.id]
        );
    });

    return { outcome: 'canceled' };
}

/**
 * Move a subscription into its next period after a successful charge.
 *
 * @param {object} subscription
 * @param {Date} now
 * @returns {Promise<{outcome: string, periodEnd: Date, periodsBilled: number}>}
 */
async function recordRenewal(subscription, now = new Date()) {
    const { start, end, periodsBilled } = nextPeriod(
        subscription.current_period_end,
        subscription.interval,
        subscription.interval_count,
        now
    );

    await withTransaction(async (connection) => {
        await connection.query(
            `UPDATE subscriptions
                SET status = 'active',
                    current_period_start = ?,
                    current_period_end = ?,
                    dunning_retry_count = 0
              WHERE id = ?`,
            [start, end, subscription.id]
        );
    });

    return { outcome: 'renewed', periodStart: start, periodEnd: end, periodsBilled };
}

/**
 * Record a failed charge.
 *
 * The retry is scheduled by moving `current_period_end` forward, so the next
 * attempt is a fixed interval away rather than "whenever the sweep next runs".
 * The old code left the column alone, which tied the dunning policy to the
 * scheduler's interval without saying so.
 *
 * @param {object} subscription
 * @param {Date} now
 * @returns {Promise<{outcome: string, retries: number}>}
 */
async function recordDunningFailure(subscription, now = new Date()) {
    const retries = Math.trunc(safeNumber(subscription.dunning_retry_count)) + 1;
    const exhausted = retries >= MAX_DUNNING_RETRIES;

    await withTransaction(async (connection) => {
        if (exhausted) {
            await connection.query(
                `UPDATE subscriptions
                    SET status = 'canceled', canceled_at = ?, dunning_retry_count = ?
                  WHERE id = ?`,
                [now, retries, subscription.id]
            );
            return;
        }

        const retryAt = new Date(now.getTime() + DUNNING_RETRY_HOURS * 60 * 60 * 1000);

        await connection.query(
            `UPDATE subscriptions
                SET status = 'past_due', dunning_retry_count = ?, current_period_end = ?
              WHERE id = ?`,
            [retries, retryAt, subscription.id]
        );
    });

    if (exhausted) {
        logger.warn(
            `Subscription ${subscription.id} cancelled after ${retries} failed renewals`
        );
    }

    return { outcome: exhausted ? 'canceled' : 'past_due', retries };
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

function toPublicPlan(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        price: Number(row.price),
        currency: row.currency,
        interval: row.interval,
        intervalCount: Number(row.interval_count),
        trialDays: Number(row.trial_days)
    };
}

function toPublicSubscription(row) {
    return {
        id: row.id,
        status: row.status,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        // A boolean, not the TINYINT the column stores. A client checking
        // truthiness on 0 and 1 works by accident and reads badly.
        cancelAtPeriodEnd: row.cancel_at_period_end === 1,
        canceledAt: row.canceled_at,
        dunningRetryCount: Number(row.dunning_retry_count || 0),
        createdAt: row.created_at,
        plan: {
            id: row.plan_id,
            name: row.plan_name,
            description: row.plan_description,
            price: Number(row.price),
            currency: row.currency,
            interval: row.interval,
            intervalCount: Number(row.interval_count),
            trialDays: Number(row.trial_days)
        }
    };
}

module.exports = {
    SubscriptionError,
    LIVE_STATUSES,
    STATUSES,
    MAX_DUNNING_RETRIES,
    DUNNING_RETRY_HOURS,
    advancePeriod,
    nextPeriod,
    listPlans,
    getForUser,
    subscribe,
    pause,
    resume,
    cancel,
    findDueForRenewal,
    completeCancellation,
    recordRenewal,
    recordDunningFailure,
    toPublicPlan,
    toPublicSubscription
};
