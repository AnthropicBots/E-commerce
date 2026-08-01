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
// Guest carts: `carts.user_id` is nullable so a pre-sign-in basket can be
// persisted later, but nothing creates one yet -- every cart endpoint is behind
// authentication. Resolving a cart therefore requires an account, and says so
// rather than quietly inventing an ownerless row.

const crypto = require('crypto');
const db = require('../config/db');
const { safeUUID } = require('../utils/helpers');

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

module.exports = {
    CART_STATUS,
    findActiveCartId,
    resolveActiveCart,
    touchCart
};
