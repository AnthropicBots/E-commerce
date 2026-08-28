// backend/services/cartMergeService.js
//
// Folding a guest basket into an account's cart (#1427).
//
// A shopper who fills a basket and then signs in must not lose it, and must
// not come away with two. Both halves of that were previously left to the
// browser, which is why the outcome depended on which page the shopper landed
// on and on whether a stale flag in local storage said the merge had already
// happened.
//
// Three rules define it here:
//
//   * one cart survives. The account's active cart absorbs the guest's lines
//     and the guest cart takes its terminal exit, so the single-active-cart
//     guarantee the schema enforces is never even approached -- a merged cart
//     is not active, so it holds no slot;
//   * only an ownerless cart may be absorbed. A cart with a `user_id` belongs
//     to somebody, and presenting its token must never move it to a different
//     account. That is enforced by the lookup, which will not return one;
//   * the same line from both baskets is one line with the quantities added,
//     which is the rule `cart.service.mergeCartLines` already states for
//     everything else that combines carts.
//
// Merging never fails a sign-in. A shopper who cannot get in because their
// basket could not be combined is worse off than one who has to add an item
// again, so the caller is expected to treat a failure as "no merge" and carry
// on.

const db = require('../config/db');
const cartConfig = require('../config/cartConfig');
const logger = require('../utils/logger');
const guestCart = require('./guestCartService');
const cartLifecycle = require('./cartLifecycleService');
const inventoryReservationService = require('./inventoryReservationService');
const { mergeCartLines, normalizeCartLines } = require('./cart.service');
const { publicProductCondition } = require('../constants/productVisibility');
const { safeArray, safeUUID } = require('../utils/helpers');

/**
 * Fold the basket a token reaches into the account's cart.
 *
 * Runs in its own transaction unless the caller supplies a connection, so the
 * whole merge -- the account's new lines, the guest's removed ones and the
 * guest cart's status -- either happens or does not. A partial merge is the
 * one outcome that could genuinely lose a basket.
 *
 * @param {string} userId
 * @param {string|null} guestToken
 * @param {object} [connection] - Join the caller's transaction instead.
 * @returns {Promise<{merged: boolean, cartId: string|null, lines: number}>}
 */
async function mergeGuestCart(userId, guestToken, connection) {
    const owner = safeUUID(userId);

    if (!owner || !guestCart.isWellFormedToken(guestToken)) {
        return { merged: false, cartId: null, lines: 0 };
    }

    if (connection) {
        return runMerge(owner, guestToken, connection);
    }

    const ownConnection = await db.getConnection();

    try {
        await ownConnection.beginTransaction();
        const result = await runMerge(owner, guestToken, ownConnection);
        await ownConnection.commit();

        return result;
    } catch (error) {
        await ownConnection.rollback();
        throw error;
    } finally {
        ownConnection.release();
    }
}

/**
 * The same merge, with a sign-in's tolerance for failure.
 *
 * Sign-in and registration call this rather than `mergeGuestCart` directly:
 * they have already decided that the shopper is getting in, and a basket is
 * not worth taking that back.
 *
 * @param {string} userId
 * @param {object} req - Carries the presented cart token.
 * @returns {Promise<boolean>} whether anything moved
 */
async function mergeGuestCartOnSignIn(userId, req) {
    try {
        const { merged, lines } = await mergeGuestCart(
            userId,
            guestCart.readTokenFromRequest(req)
        );

        if (merged) {
            logger.info(`Merged ${lines} guest cart line(s) into the cart of user ${userId}`);
        }

        return merged;
    } catch (error) {
        logger.error(`Guest cart merge failed for user ${userId}: ${error.message}`);

        return false;
    }
}

async function runMerge(owner, guestToken, connection) {
    const guestCartId = await guestCart.findCartIdByToken(guestToken, connection);

    if (!guestCartId) {
        return { merged: false, cartId: null, lines: 0 };
    }

    const guestLines = await readCartLines(guestCartId, connection);

    // The account's cart is resolved even for an empty guest basket, because
    // the guest cart still has to be closed: leaving it active would leave a
    // live basket behind a token the shopper has just stopped using, and the
    // sweep would eventually record it as abandoned.
    const accountCartId = await cartLifecycle.resolveActiveCart(owner, connection);

    if (!guestLines.length) {
        await closeGuestCart(guestCartId, accountCartId, connection);

        return { merged: false, cartId: accountCartId, lines: 0 };
    }

    const accountLines = await readCartLines(accountCartId, connection);
    const merged = mergeCartLines(accountLines, guestLines).map(capQuantity);

    // Replace rather than upsert: the merged set is the answer for the whole
    // cart, and inserting line by line over the existing rows would leave the
    // outcome depending on which of them happened to be there already.
    await connection.query('DELETE FROM cart_items WHERE cart_id IN (?, ?)', [
        accountCartId,
        guestCartId
    ]);

    await connection.query(
        `INSERT INTO cart_items (user_id, cart_id, product_id, variant_id, color, size, quantity)
         VALUES ${merged.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',')}`,
        merged.flatMap((line) => [
            owner,
            accountCartId,
            line.productId,
            line.variantId,
            line.color,
            line.size,
            line.quantity
        ])
    );

    await closeGuestCart(guestCartId, accountCartId, connection);
    await cartLifecycle.touchCart(accountCartId, connection);
    await holdStockForMergedLines(owner, merged, connection);

    return { merged: true, cartId: accountCartId, lines: merged.length };
}

async function readCartLines(cartId, connection) {
    const visible = publicProductCondition('p');
    const [rows] = await connection.query(
        `SELECT ci.product_id, ci.variant_id, ci.color, ci.size, ci.quantity
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         WHERE ci.cart_id = ? AND ${visible.sql}`,
        [cartId, ...visible.params]
    );

    return normalizeCartLines(safeArray(rows));
}

async function closeGuestCart(guestCartId, accountCartId, connection) {
    await connection.query(
        `UPDATE carts
         SET status = ?, merged_into_cart_id = ?, merged_at = NOW()
         WHERE id = ? AND status = ?`,
        [cartLifecycle.CART_STATUS.MERGED, accountCartId, guestCartId, cartLifecycle.CART_STATUS.ACTIVE]
    );
}

// A line the shopper reaches by adding to it is capped at checkout; a line
// reached by adding two baskets together was not capped anywhere, so a merge
// could produce a cart that no checkout would accept.
function capQuantity(line) {
    return {
        ...line,
        quantity: Math.min(line.quantity, cartConfig.MAX_LINE_QUANTITY)
    };
}

/**
 * Take reservations on the merged lines, as a cart write would.
 *
 * Best effort, deliberately. A reservation is a courtesy hold and the answer
 * to "somebody else took the last one" belongs at checkout, where it can be
 * explained; arriving as a failed sign-in it would be inexplicable.
 */
async function holdStockForMergedLines(owner, lines, connection) {
    await inventoryReservationService.releaseUserLocks(owner, null, connection);

    for (const line of lines) {
        try {
            await inventoryReservationService.reserveStock(
                owner,
                line.productId,
                line.quantity,
                connection,
                line
            );
        } catch (error) {
            logger.warn(
                `Could not hold stock for ${line.productId} while merging a guest cart: ${error.message}`
            );
        }
    }
}

module.exports = {
    mergeGuestCart,
    mergeGuestCartOnSignIn,
    readCartLines
};
