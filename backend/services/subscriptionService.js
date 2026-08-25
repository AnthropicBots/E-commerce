// backend/services/subscriptionService.js
//
// Billing plans and subscriptions (#1494).
//
// Refactored for modular organization, rigorous input sanitization, 
// and robust transaction safety with explicit row locking.

'use strict';

const db = require('../config/db');
const { withTransaction } = require('../config/db');
const logger = require('../utils/logger');
const { safeNumber, safeUUID } = require('../utils/helpers');

/**
 * Statuses that mean "this account already has a subscription".
 */
const LIVE_STATUSES = Object.freeze(['active', 'past_due', 'paused']);

/** Every status the column accepts, matching the ENUM in migration 0024. */
const STATUSES = Object.freeze(['active', 'past_due', 'paused', 'canceled']);

const MAX_DUNNING_RETRIES = safeNumber(process.env.SUBSCRIPTION_MAX_DUNNING_RETRIES) || 3;
const DUNNING_RETRY_HOURS = safeNumber(process.env.SUBSCRIPTION_DUNNING_RETRY_HOURS) || 24;
const ALLOWED_INTERVALS = Object.freeze(['daily', 'weekly', 'monthly', 'yearly']);

class SubscriptionError extends Error {
    constructor(message, status = 400, code = 'SUBSCRIPTION_ERROR') {
        super(message);
        this.name = 'SubscriptionError';
        this.status = status;
        this.code = code;
    }
}

// ---------------------------------------------------------------------------
// Period Arithmetic Helpers
// ---------------------------------------------------------------------------

function validateAndParseDate(from) {
    const start = from instanceof Date ? new Date(from.getTime()) : new Date(from);
    if (Number.isNaN(start.getTime())) {
        throw new SubscriptionError('Cannot advance an invalid date', 500, 'INVALID_PERIOD_START');
    }
    return start;
}

function validateStepCount(count) {
    const steps = Math.trunc(safeNumber(count));
    if (steps < 1) {
        throw new SubscriptionError(`interval_count must be at least 1, got ${count}`, 500, 'INVALID_INTERVAL_COUNT');
    }
    return steps;
}

function advancePeriod(from, interval, count = 1) {
    const start = validateAndParseDate(from);
    const steps = validateStepCount(count);
    const end = new Date(start.getTime());

    switch (interval) {
        case 'daily':
            end.setDate(end.getDate() + steps);
            break;
        case 'weekly':
            end.setDate(end.getDate() + 7 * steps);
            break;
        case 'monthly': {
            const desiredDay = start.getDate();
            end.setDate(1);
            end.setMonth(start.getMonth() + steps);
            const maxDays = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
            end.setDate(Math.min(desiredDay, maxDays));
            break;
        }
        case 'yearly': {
            const desiredDay = start.getDate();
            const desiredMonth = start.getMonth();
            end.setDate(1);
            end.setFullYear(start.getFullYear() + steps);
            end.setMonth(desiredMonth);
            const maxDays = new Date(end.getFullYear(), desiredMonth + 1, 0).getDate();
            end.setDate(Math.min(desiredDay, maxDays));
            break;
        }
        default:
            throw new SubscriptionError(`Unsupported billing interval: ${interval}`, 400, 'UNSUPPORTED_INTERVAL');
    }

    return end;
}

function nextPeriod(periodEnd, interval, count = 1, now = new Date()) {
    const MAX_CATCH_UP = 120;
    let start = validateAndParseDate(periodEnd);
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
// Read Operations
// ---------------------------------------------------------------------------

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
// Write Operations & Transactions
// ---------------------------------------------------------------------------

/**
 * The plan id as a positive integer, or a refusal.
 *
 * Split out of fetchAndValidatePlan so callers can run it before they open a
 * transaction. "abc" is not a plan id under any state of the database, and
 * settling that after `withTransaction` has taken a connection means an
 * unusable argument costs a connection from the pool and a rollback to answer.
 */
function normalisePlanId(planId) {
    const plan = Math.trunc(safeNumber(planId));

    if (plan < 1) {
        throw new SubscriptionError('Invalid plan ID', 400, 'INVALID_PLAN');
    }

    return plan;
}

async function fetchAndValidatePlan(connection, planId) {
    const plan = normalisePlanId(planId);

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
    if (!ALLOWED_INTERVALS.includes(billingPlan.interval)) {
        throw new SubscriptionError(`Unsupported billing interval: ${billingPlan.interval}`, 400, 'UNSUPPORTED_INTERVAL');
    }

    return billingPlan;
}

async function subscribe(userId, planId) {
    const id = safeUUID(userId);
    if (!id) {
        throw new SubscriptionError('Authentication required', 401, 'UNAUTHENTICATED');
    }

    // Both argument checks happen before the transaction, for the same reason.
    // Neither depends on anything in the database, and an unusable argument
    // that opens and rolls back a transaction to answer is paying for a
    // connection to say no.
    const plan = normalisePlanId(planId);

    return withTransaction(async (connection) => {
        const billingPlan = await fetchAndValidatePlan(connection, plan);

        const [existing] = await connection.query(
            `SELECT id, status, cancel_at_period_end
               FROM subscriptions
              WHERE user_id = ? AND status IN (?, ?, ?)
              FOR UPDATE`,
            [id, ...LIVE_STATUSES]
        );

        if (existing.length) {
            if (existing[0].cancel_at_period_end) {
                throw new SubscriptionError(
                    'This subscription is set to end at the close of the period. Resume it instead of subscribing again.',
                    409,
                    'CANCELLATION_PENDING'
                );
            }

            throw new SubscriptionError('You already have an active subscription', 409, 'ALREADY_SUBSCRIBED');
        }

        const start = new Date();
        const trialDays = Math.trunc(safeNumber(billingPlan.trial_days));

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

async function pause(userId) {
    return transition(userId, {
        from: ['active'],
        set: "status = 'paused'",
        notFound: 'No active subscription found to pause'
    });
}

async function resume(userId) {
    return transition(userId, {
        from: ['paused', 'active', 'past_due'],
        set: "status = 'active', cancel_at_period_end = 0, canceled_at = NULL",
        notFound: 'No subscription found to resume',
        requireChange: (row) => row.status === 'paused' || row.cancel_at_period_end === 1,
        unchanged: 'This subscription is already running',
        annotate: (row) => ({ withdrewCancellation: row.cancel_at_period_end === 1 })
    });
}

async function cancel(userId) {
    return transition(userId, {
        from: LIVE_STATUSES,
        set: 'cancel_at_period_end = 1',
        notFound: 'No active subscription found to cancel',
        requireChange: (row) => row.cancel_at_period_end !== 1,
        unchanged: 'This subscription is already set to end at the close of the period'
    });
}

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
// Renewal Operations
// ---------------------------------------------------------------------------

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
        logger.warn(`Subscription ${subscription.id} cancelled after ${retries} failed renewals`);
    }

    return { outcome: exhausted ? 'canceled' : 'past_due', retries };
}

// ---------------------------------------------------------------------------
// Response Shaping
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
