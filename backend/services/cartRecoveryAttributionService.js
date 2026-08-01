// backend/services/cartRecoveryAttributionService.js
//
// What the recovery programme actually recovered (#1429).
//
// A programme that cannot say what it earned cannot be tuned, defended or
// turned off, and the tempting way to answer the question is to infer it
// afterwards: orders from people we mailed, placed within some window of the
// message. That number is worthless. It counts everyone who would have come
// back regardless, it moves whenever somebody adjusts the window, and it stops
// being computable at all once the send log is pruned.
//
// So attribution is a fact recorded when it is known. The restore endpoint
// hands back a reference to the link that was spent; the browser carries it to
// checkout; the order stores it. Afterwards, reporting is a filter on a column
// rather than a reconstruction, and the figure does not change when the
// reporting code does.
//
// The reference is not a credential and grants nothing -- it buys a row in a
// report, not a discount or an entitlement -- but it still may not be used to
// claim somebody else's recovery, so a signed-in order has to match the account
// the link was issued to. A guest order is accepted, because checking out
// without signing in is the case the whole link exists to serve.

'use strict';

const db = require('../config/db');
const cartRecoveryConfig = require('../config/cartRecoveryConfig');
const logger = require('../utils/logger');
const { safeInteger, safeUUID } = require('../utils/helpers');

const NO_ATTRIBUTION = Object.freeze({ recoveryTokenId: null, recoveredCartId: null });

/**
 * Run against the caller's transaction when there is one, the pool otherwise.
 *
 * Attribution is resolved inside the order's transaction so the claim that an
 * order was recovered can never outlive an order that rolled back.
 */
function runner(connection) {
    return connection || db;
}

/**
 * Turn a restore reference from the browser into an attribution, or nothing.
 *
 * Refusals are silent by design. An unrecognised, stale or mismatched
 * reference means the order is simply not attributed; failing checkout over a
 * reporting field would be trading revenue for a statistic.
 *
 * @param {object} params
 * @param {string} [params.recoveryRef] - The token id handed back at restore.
 * @param {string} [params.userId] - The ordering account, if any.
 * @param {object} [params.connection]
 * @param {number} [params.windowMinutes]
 * @returns {Promise<{recoveryTokenId: string|null, recoveredCartId: string|null}>}
 */
async function resolveAttribution({ recoveryRef, userId, connection, windowMinutes } = {}) {
    const reference = safeUUID(recoveryRef);

    if (!reference) return NO_ATTRIBUTION;

    const window = Math.max(
        1,
        safeInteger(windowMinutes, cartRecoveryConfig.ATTRIBUTION_WINDOW_MINUTES)
    );

    const [rows] = await runner(connection).query(
        `SELECT id, cart_id, user_id
         FROM cart_restore_tokens
         WHERE id = ?
           AND redeemed_at IS NOT NULL
           AND redeemed_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
         LIMIT 1`,
        [reference, window]
    );

    const token = rows[0];

    if (!token) return NO_ATTRIBUTION;

    const buyer = safeUUID(userId);

    // A signed-in shopper may only claim their own recovery. A guest order
    // carries no account to compare against and is taken at face value: the
    // reference is only obtainable by having spent the link, and the credit it
    // buys is a line in a report.
    if (buyer && safeUUID(token.user_id) !== buyer) {
        logger.warn(
            `Recovery reference ${reference} presented by a different account; not attributed`
        );
        return NO_ATTRIBUTION;
    }

    return { recoveryTokenId: token.id, recoveredCartId: token.cart_id };
}

/**
 * Recovered revenue over a trading window, beside the total it came out of.
 *
 * The denominator is deliberately included. "We recovered £12,000" is not a
 * figure anybody can act on without knowing what was taken overall in the same
 * period, and computing the two separately is how the two end up covering
 * different windows.
 *
 * @param {object} [options]
 * @param {number} [options.days]
 * @returns {Promise<object>}
 */
async function getRecoveredRevenue({ days = 30 } = {}) {
    const window = Math.min(365, Math.max(1, safeInteger(days, 30)));

    const [rows] = await db.query(
        `SELECT
             COUNT(*) AS total_orders,
             COALESCE(SUM(o.total), 0) AS total_revenue,
             SUM(CASE WHEN o.recovered_cart_id IS NOT NULL THEN 1 ELSE 0 END)
                 AS recovered_orders,
             COALESCE(
                 SUM(CASE WHEN o.recovered_cart_id IS NOT NULL THEN o.total ELSE 0 END),
                 0
             ) AS recovered_revenue
         FROM orders o
         WHERE o.deleted_at IS NULL
           AND o.status <> 'cancelled'
           AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [window]
    );

    const summary = rows[0] || {};

    const totalOrders = Number(summary.total_orders) || 0;
    const totalRevenue = Number(summary.total_revenue) || 0;
    const recoveredOrders = Number(summary.recovered_orders) || 0;
    const recoveredRevenue = Number(summary.recovered_revenue) || 0;

    return {
        windowDays: window,
        totalOrders,
        totalRevenue,
        recoveredOrders,
        recoveredRevenue,
        // Reported as a share of revenue rather than of order count: a
        // recovery programme that brings back small baskets and one that
        // brings back large ones are worth different amounts, and only this
        // ratio can tell them apart.
        recoveredRevenueShare: totalRevenue > 0
            ? Number(((recoveredRevenue / totalRevenue) * 100).toFixed(2))
            : 0
    };
}

/**
 * The same figures broken down by which message in the sequence earned them.
 *
 * This is what the stage delays are tuned against: a second reminder that
 * recovers nothing is a second reminder that should not be sent.
 *
 * @param {object} [options]
 * @param {number} [options.days]
 * @returns {Promise<Array<{stage: number, orders: number, revenue: number}>>}
 */
async function getRecoveryByStage({ days = 30 } = {}) {
    const window = Math.min(365, Math.max(1, safeInteger(days, 30)));

    // Joined through the link rather than through the basket. A basket can be
    // asked about more than once, so matching orders to messages by cart and
    // timing would credit the same order to every reminder that preceded it;
    // the link is minted per send, and the order recorded which link it used.
    const [rows] = await db.query(
        `SELECT l.stage,
                COUNT(DISTINCT l.id) AS messages,
                COUNT(DISTINCT o.id) AS orders,
                COALESCE(SUM(o.total), 0) AS revenue
         FROM cart_recovery_log l
         LEFT JOIN cart_restore_tokens t ON t.recovery_log_id = l.id
         LEFT JOIN orders o
                ON o.recovery_token_id = t.id
               AND o.deleted_at IS NULL
               AND o.status <> 'cancelled'
         WHERE l.sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY l.stage
         ORDER BY l.stage ASC`,
        [window]
    );

    return rows.map((row) => ({
        stage: Number(row.stage),
        messages: Number(row.messages) || 0,
        orders: Number(row.orders) || 0,
        revenue: Number(row.revenue) || 0
    }));
}

module.exports = {
    resolveAttribution,
    getRecoveredRevenue,
    getRecoveryByStage
};
