// backend/services/cartLifecycleService.js
//
// The cart as a record with an identity (#1364).
//
// Until now the only cart storage was `cart_items`, keyed by user. Lines
// existed; a cart did not. Nothing could be said about a basket as a whole --
// when it started, whether it turned into an order, whether it was walked away
// from -- because there was no row to say it about.
//
// This module owns that row. Every cart write goes through `resolveActiveCart`
// so lines are always attached to a cart, and `touchCart` records that the
// shopper did something, which is the clock abandonment is later measured
// against.
//
// A cart has exactly two exits, and both live here:
//
//   active -> converted, at the moment an order is created from it, inside the
//             order's own transaction so a cart is never recorded as converted
//             against an order that rolled back;
//   active -> abandoned, once it has gone untouched for longer than the
//             configured threshold, applied by the scheduled sweep.
//
// Both are terminal. Nothing moves a cart back to active; the shopper's next
// action resolves a new one.
//
// Guest carts: `carts.user_id` is nullable so a pre-sign-in basket can be
// persisted later, but nothing creates one yet -- every cart endpoint is behind
// authentication. Resolving a cart therefore requires an account, and says so
// rather than quietly inventing an ownerless row.

const crypto = require('crypto');
const db = require('../config/db');
const cartConfig = require('../config/cartConfig');
const logger = require('../utils/logger');
const { safeInteger, safeUUID } = require('../utils/helpers');

const CART_STATUS = Object.freeze({
    ACTIVE: 'active',
    CONVERTED: 'converted',
    ABANDONED: 'abandoned'
});

// mysql2's code for a unique-key collision.
const DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

/**
 * Run against the caller's transaction when there is one, the pool otherwise.
 *
 * Cart writes happen inside checkout and sync transactions, and resolving the
 * cart has to join those rather than open a second connection that cannot see
 * their uncommitted rows.
 */
function runner(connection) {
    return connection || db;
}

/**
 * The id of the account's active cart, or null.
 *
 * @param {string} userId
 * @param {object} [connection]
 * @param {boolean} [lockRow] - Take a locking read, which also reads the
 *   latest committed row rather than the transaction's snapshot.
 * @returns {Promise<string|null>}
 */
async function findActiveCartId(userId, connection, lockRow = false) {
    const owner = safeUUID(userId);

    if (!owner) return null;

    const [rows] = await runner(connection).query(
        `SELECT id FROM carts
         WHERE user_id = ? AND status = ?
         LIMIT 1${lockRow ? ' FOR UPDATE' : ''}`,
        [owner, CART_STATUS.ACTIVE]
    );

    return rows.length ? rows[0].id : null;
}

/**
 * The account's active cart, created if it has none.
 *
 * At most one active cart per account is guaranteed by a unique key on the
 * table (see the `active_marker` generated column), so a race between two
 * concurrent add-to-cart requests surfaces as a duplicate-entry error on the
 * loser rather than as two carts. The loser re-reads with a locking read,
 * which sees the winner's committed row even under REPEATABLE READ, where the
 * transaction's own snapshot would not.
 *
 * @param {string} userId
 * @param {object} [connection]
 * @returns {Promise<string>} Cart id.
 */
async function resolveActiveCart(userId, connection) {
    const owner = safeUUID(userId);

    if (!owner) {
        throw new Error('An active cart can only be resolved for a signed-in account');
    }

    const existing = await findActiveCartId(owner, connection);

    if (existing) return existing;

    const cartId = crypto.randomUUID();

    try {
        await runner(connection).query(
            `INSERT INTO carts (id, user_id, status, last_activity_at)
             VALUES (?, ?, ?, NOW())`,
            [cartId, owner, CART_STATUS.ACTIVE]
        );

        return cartId;
    } catch (error) {
        if (error && error.code === DUPLICATE_ENTRY) {
            const winner = await findActiveCartId(owner, connection, true);

            if (winner) return winner;
        }

        throw error;
    }
}

/**
 * Record that the shopper touched the cart.
 *
 * `last_activity_at` is set explicitly rather than by ON UPDATE CURRENT_TIMESTAMP
 * so that a status change -- an abandonment sweep, say -- does not read as
 * shopper activity.
 *
 * @param {string} cartId
 * @param {object} [connection]
 * @returns {Promise<void>}
 */
async function touchCart(cartId, connection) {
    const id = safeUUID(cartId);

    if (!id) return;

    await runner(connection).query(
        'UPDATE carts SET last_activity_at = NOW() WHERE id = ? AND status = ?',
        [id, CART_STATUS.ACTIVE]
    );
}

/**
 * active -> converted, for the account that just placed an order.
 *
 * Call inside the order's transaction: if the order rolls back, so must the
 * claim that a cart became it. The status guard makes the write idempotent --
 * a retry finds the cart already converted and reports that it changed
 * nothing, rather than overwriting the first order id with the second.
 *
 * A guest checkout has no cart to convert, and that is not an error.
 *
 * @param {string} userId
 * @param {string} orderId
 * @param {object} [connection]
 * @returns {Promise<{cartId: string|null, converted: boolean}>}
 */
async function markCartConverted(userId, orderId, connection) {
    const owner = safeUUID(userId);
    const order = safeUUID(orderId);

    if (!owner || !order) {
        return { cartId: null, converted: false };
    }

    const cartId = await findActiveCartId(owner, connection);

    if (!cartId) {
        return { cartId: null, converted: false };
    }

    const [result] = await runner(connection).query(
        `UPDATE carts
         SET status = ?, converted_order_id = ?, converted_at = NOW()
         WHERE id = ? AND status = ?`,
        [CART_STATUS.CONVERTED, order, cartId, CART_STATUS.ACTIVE]
    );

    return { cartId, converted: result.affectedRows > 0 };
}

/**
 * active -> abandoned, for carts left untouched past the threshold.
 *
 * Three properties matter more than throughput here:
 *
 *   * bounded -- work is done in batches of `batchSize`, capped at
 *     `maxBatches` per run, so a backlog is drained over several runs rather
 *     than in one statement that locks the table;
 *   * idempotent -- the transition is guarded on `status = 'active'`, so a
 *     second run over the same carts changes nothing and reports zero;
 *   * safe to run twice at once -- two instances may select the same ids, but
 *     the same guard means only one of them actually transitions a given cart,
 *     and each reports only what it changed. No cart is counted twice.
 *
 * Empty carts are skipped. A cart with no lines in it is a session that never
 * became a basket, and counting those as abandoned would put a floor under the
 * abandonment rate that has nothing to do with shopping.
 *
 * @param {object} [options]
 * @param {number} [options.inactivityMinutes]
 * @param {number} [options.batchSize]
 * @param {number} [options.maxBatches]
 * @param {object} [options.connection]
 * @returns {Promise<{abandoned: number, batches: number, scanned: number,
 *   inactivityMinutes: number, batchSize: number, exhausted: boolean}>}
 */
async function sweepAbandonedCarts(options = {}) {
    const inactivityMinutes = Math.max(
        1,
        safeInteger(options.inactivityMinutes, cartConfig.ABANDON_AFTER_MINUTES)
    );
    const batchSize = Math.max(
        1,
        safeInteger(options.batchSize, cartConfig.SWEEP_BATCH_SIZE)
    );
    const maxBatches = Math.max(
        1,
        safeInteger(options.maxBatches, cartConfig.SWEEP_MAX_BATCHES)
    );

    const client = runner(options.connection);

    let abandoned = 0;
    let scanned = 0;
    let batches = 0;
    let exhausted = false;

    while (batches < maxBatches) {
        const [candidates] = await client.query(
            `SELECT c.id
             FROM carts c
             WHERE c.status = ?
               AND c.last_activity_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
               AND EXISTS (
                   SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id
               )
             ORDER BY c.last_activity_at ASC
             LIMIT ?`,
            [CART_STATUS.ACTIVE, inactivityMinutes, batchSize]
        );

        batches += 1;

        if (!candidates.length) {
            exhausted = true;
            break;
        }

        const ids = candidates.map((row) => row.id);
        scanned += ids.length;

        const [result] = await client.query(
            `UPDATE carts
             SET status = ?, abandoned_at = NOW()
             WHERE id IN (${ids.map(() => '?').join(',')}) AND status = ?`,
            [CART_STATUS.ABANDONED, ...ids, CART_STATUS.ACTIVE]
        );

        abandoned += result.affectedRows;

        if (ids.length < batchSize) {
            exhausted = true;
            break;
        }
    }

    // Logged unconditionally, and with the figure rather than a verb: a run
    // that found nothing to do has to be distinguishable from a run that did
    // nothing, which is exactly what the previous no-op handler could not say.
    logger.info(
        `Abandoned-cart sweep: ${abandoned} cart(s) transitioned from ${scanned} candidate(s) ` +
        `in ${batches} batch(es); threshold ${inactivityMinutes} minute(s)` +
        `${exhausted ? '' : '; batch ceiling reached, backlog remains'}`
    );

    return {
        abandoned,
        batches,
        scanned,
        inactivityMinutes,
        batchSize,
        exhausted
    };
}

module.exports = {
    CART_STATUS,
    findActiveCartId,
    resolveActiveCart,
    touchCart,
    markCartConverted,
    sweepAbandonedCarts
};
