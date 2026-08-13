const promisePool = require("../config/db");
const { safeInteger, safeUUID, sanitizeString } = require("../utils/helpers");
const inventoryReservationService = require("../services/inventoryReservationService");
const {
    CART_OWNERSHIP,
    cartLineKey,
    mergeCartLines,
    normalizeCartLine,
    normalizeCartLines,
    resolveCartOwnership
} = require("../services/cart.service");
const cartLifecycle = require("../services/cartLifecycleService");
const guestCart = require("../services/guestCartService");
const cartRestoreService = require("../services/cartRestoreService");
// The same definition of "a shopper may see this product" the catalogue and
// the wishlist use (#1456). The cart was the one surface still asking only
// whether a row existed, so a product an admin had withdrawn stayed addable,
// stayed in the basket, and travelled to checkout (#1546).
const { publicProductCondition } = require("../constants/productVisibility");

// Every handler below works from the cart, not from the account (#1427). The
// two are the same thing for a signed-in shopper and the account is still
// written on each line, but a guest has only the cart, and one code path that
// always knows which cart it is holding is worth more than two that differ
// only in how they found it.

/**
 * The cart this request may write to, opened if the shopper has none yet.
 *
 * A guest token comes back only when one was minted, because that is the only
 * moment the client can be told what to hold on to.
 */
const resolveCartForWrite = async (req, connection) => {
    const { userId, guestToken } = req.cartIdentity;

    if (userId) {
        return {
            cartId: await cartLifecycle.resolveActiveCart(userId, connection),
            userId,
            issuedToken: null
        };
    }

    const guest = await guestCart.resolveCart(guestToken, connection);

    return { cartId: guest.cartId, userId: null, issuedToken: guest.token };
};

/**
 * The cart this request may read, or null.
 *
 * Reading never opens one. A visitor who has added nothing has an empty
 * basket, not a row, and a cart created by a page load would be counted as a
 * basket that was walked away from.
 */
const resolveCartForRead = async (req) => {
    const { userId, guestToken } = req.cartIdentity;

    return userId
        ? cartLifecycle.findActiveCartId(userId)
        : guestCart.findCartIdByToken(guestToken);
};

/**
 * The ids among `productIds` that a shopper may actually buy right now.
 *
 * Existence is not the question. `deleteProduct` is a soft delete and `status`
 * carries the lifecycle, so a withdrawn product is still a row -- one that
 * 404s at its own URL, is absent from every listing, and cannot be added to a
 * wishlist. The cart asked `SELECT id FROM products WHERE id = ?` and got
 * `true` for all of them (#1546).
 *
 * @param {object} connection A pool or an open transaction.
 * @param {string[]} productIds
 * @returns {Promise<Set<string>>} the subset that is live
 */
const findLiveProductIds = async (connection, productIds) => {
    const ids = [...new Set(productIds.filter(Boolean))];

    if (!ids.length) {
        return new Set();
    }

    const visibility = publicProductCondition("p");

    const [rows] = await connection.query(
        `SELECT p.id
           FROM products p
          WHERE p.id IN (${ids.map(() => "?").join(",")})
            AND ${visibility.sql}`,
        [...ids, ...visibility.params]
    );

    return new Set((rows || []).map((row) => safeUUID(row.id)));
};

/**
 * Is this one product live?
 *
 * @param {object} connection
 * @param {string} productId
 * @returns {Promise<boolean>}
 */
const isLiveProduct = async (connection, productId) => {
    const live = await findLiveProductIds(connection, [productId]);
    return live.has(productId);
};

// Shopper activity moves two clocks for a guest: the cart's, which the
// abandonment sweep reads, and the token's, so a credential does not expire
// under someone who is still shopping.
const recordActivity = async (cart, connection) => {
    await cartLifecycle.touchCart(cart.cartId, connection);

    if (!cart.userId) {
        await guestCart.extendToken(cart.cartId, connection);
    }
};

// Returned in the body rather than in a header: a response header has to be
// named in the CORS exposure list before a browser will let a script read it,
// and the client already parses every one of these responses.
const issuedToken = (cart) => (
    cart.issuedToken ? { cartToken: cart.issuedToken } : {}
);

const cartController = {
    // Spend a restore link from a recovery message and hand back the basket.
    //
    // Restored verbatim in #1444: this handler and its route were dropped when
    // cartRoutes.js was rewritten for guest carts (#1427), which left
    // cartRestoreService, its migrations and its public-route declaration in
    // place with nothing reaching them. Every recovery email sent since has
    // linked to a 404.
    //
    // The only unauthenticated cart endpoint, and deliberately the only one:
    // the caller is anonymous, so there is no account here to write to and this
    // reads. The lines go into whichever basket the browser already owns, and a
    // signed-in shopper's existing sync then persists them under their own
    // session -- which keeps every cart *write* behind authentication, exactly
    // as it was.
    restoreFromLink: async (req, res) => {
        try {
            const token = sanitizeString(req.body?.token || req.query?.token || "");
            const restored = await cartRestoreService.redeemRestoreToken(token);

            return res.status(200).json({
                success: true,
                message: "Your basket is back",
                ...restored
            });
        } catch (error) {
            // Nothing about the account, the cart or the reason a token is
            // unknown travels back: every refusal is either "not valid" or
            // "no longer usable".
            return res.status(error.status || 500).json({
                success: false,
                code: error.code || "CART_RESTORE_FAILED",
                message: error.status
                    ? error.message
                    : "Could not restore this basket"
            });
        }
    },

    // Get the current cart (joined with product data)
    getUserCart: async (req, res) => {
        try {
            const cartId = await resolveCartForRead(req);

            if (!cartId) {
                return res.status(200).json({
                    success: true,
                    cart: []
                });
            }

            // Filtered on read as well as on write, because a product can be
            // withdrawn *after* it entered the basket. Without this, an item
            // added last week stays in the cart forever, rendered from its
            // stale snapshot, and is carried to checkout (#1546).
            const visibility = publicProductCondition("p");

            const [rows] = await promisePool.query(`
                SELECT
                    p.id,
                    p.name,
                    p.price,
                    p.image,
                    p.brand,
                    p.stock,
                    c.variant_id AS variantId,
                    c.color,
                    c.size,
                    c.quantity AS qty,
                    c.created_at AS added_at
                FROM cart_items c
                JOIN products p ON c.product_id = p.id
                WHERE c.cart_id = ? AND ${visibility.sql}
                ORDER BY c.created_at DESC
            `, [cartId, ...visibility.params]);

            // How many lines the basket holds versus how many are still
            // buyable. Silently returning fewer rows than the shopper put in
            // reads as data loss; naming the count lets the cart page say
            // "1 item is no longer available" instead.
            const [[held]] = await promisePool.query(
                "SELECT COUNT(*) AS total FROM cart_items WHERE cart_id = ?",
                [cartId]
            );

            const unavailableCount = Math.max(
                0,
                Number(held?.total || 0) - (rows?.length || 0)
            );

            return res.status(200).json({
                success: true,
                cart: rows,
                unavailableCount
            });

        } catch (error) {
            console.error("GET CART ERROR:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch cart"
            });
        }
    },

    // Replace the entire cart with the posted lines
    syncCart: async (req, res) => {
        let connection;

        try {
            const { userId } = req.cartIdentity;

            // A client may only replace the cart it already owns. A payload
            // that declares a different owner has not been reconciled against
            // this session, and adopting it would attach one shopper's basket
            // to another's. An absent viewer reads as the guest owner, so a
            // guest may only push a payload that says it is a guest's.
            if (
                req.body.owner !== undefined &&
                resolveCartOwnership(req.body.owner, userId) !== CART_OWNERSHIP.ADOPT
            ) {
                return res.status(409).json({
                    success: false,
                    message: "Cart does not belong to the signed-in account"
                });
            }

            const lines = normalizeCartLines(req.body.items);

            connection = await promisePool.getConnection();

            await connection.beginTransaction();

            // /cart/sync is replace-all: drop the current reservations up
            // front so the ones created below match the synced lines.
            if (userId) {
                await inventoryReservationService.releaseUserLocks(userId, null, connection);
            }

            const cart = await resolveCartForWrite(req, connection);

            let placeholders = [];
            let values = [];
            const droppedProductIds = [];

            if (lines.length) {
                const productIds = [...new Set(lines.map((line) => line.productId))];

                // Live, not merely present. This asked only whether the row
                // existed, so a soft-deleted or deactivated product synced
                // straight back into the basket (#1546).
                const liveProductIds = await findLiveProductIds(
                    connection,
                    productIds
                );

                for (const line of lines) {
                    if (!liveProductIds.has(line.productId)) {
                        droppedProductIds.push(line.productId);
                        continue;
                    }

                    // Reservations are held against an account, so a guest
                    // basket holds no stock. Nothing is oversold by that: the
                    // deduction at checkout is guarded on the stock it is
                    // deducting from. What a guest gives up is the fifteen
                    // minutes an account gets to finish paying.
                    if (userId) {
                        const reserved = await inventoryReservationService.reserveStock(
                            userId,
                            line.productId,
                            line.quantity,
                            connection,
                            line
                        );

                        if (!reserved) {
                            await connection.rollback();

                            return res.status(400).json({
                                success: false,
                                message: `Requested quantity exceeds available stock for product ${line.productId}`
                            });
                        }
                    }

                    placeholders.push("(?, ?, ?, ?, ?, ?, ?)");
                    values.push(
                        userId,
                        cart.cartId,
                        line.productId,
                        line.variantId,
                        line.color,
                        line.size,
                        line.quantity
                    );
                }
            }

            // clear existing cart only after validation succeeds
            await connection.query(
                "DELETE FROM cart_items WHERE cart_id = ?",
                [cart.cartId]
            );

            if (placeholders.length) {
                await connection.query(
                    `INSERT INTO cart_items (user_id, cart_id, product_id, variant_id, color, size, quantity) VALUES ${placeholders.join(",")}`,
                    values
                );
            }

            await recordActivity(cart, connection);

            await connection.commit();

            return res.status(200).json({
                success: true,
                message: "Cart synced",
                // Named, not silently swallowed. A sync that quietly returns
                // fewer lines than it was sent looks to the client like its
                // own state is wrong; saying which ids were withdrawn lets the
                // cart page tell the shopper what happened.
                droppedProductIds,
                dropped: droppedProductIds.length,
                ...issuedToken(cart)
            });

        } catch (error) {
            if (connection) {
                await connection.rollback();
            }
            console.error("SYNC CART ERROR:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to sync cart"
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    },

    // Add a single cart line (product + variant choice) to the cart
    addToCart: async (req, res) => {
        let connection;
        try {
            connection = await promisePool.getConnection();
            const { userId } = req.cartIdentity;

            // A quantity below 1 is a client error rather than something to
            // clamp, so it is read before normalization floors it.
            const quantity = safeInteger(req.body.quantity ?? 1, 0);
            const line = normalizeCartLine({ ...req.body, quantity });

            if (!line || quantity < 1) {
                return res.status(400).json({ success: false, message: "Invalid product ID or quantity" });
            }

            await connection.beginTransaction();

            // Before the cart is opened and before stock is reserved: a
            // product nobody may buy should not cause either (#1546).
            if (!(await isLiveProduct(connection, line.productId))) {
                await connection.rollback();

                return res.status(404).json({
                    success: false,
                    message: "This product is no longer available"
                });
            }

            const cart = await resolveCartForWrite(req, connection);

            if (userId) {
                const reserved = await inventoryReservationService.reserveStock(userId, line.productId, line.quantity, connection, line);
                if (!reserved) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: "Requested quantity exceeds available stock or could not be reserved" });
                }
            }

            const [existingLines] = await connection.query(
                "SELECT product_id, variant_id, color, size, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?",
                [cart.cartId, line.productId]
            );

            // Adding to a line that is already in the cart is the one place
            // quantities are summed, and only for the very same line.
            const key = cartLineKey(line);
            const mergedLine =
                mergeCartLines(existingLines, [line])
                    .find((candidate) => cartLineKey(candidate) === key) || line;

            await connection.query(
                `INSERT INTO cart_items (user_id, cart_id, product_id, variant_id, color, size, quantity)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
                [userId, cart.cartId, line.productId, line.variantId, line.color, line.size, mergedLine.quantity]
            );

            await recordActivity(cart, connection);

            await connection.commit();
            return res.status(200).json({
                success: true,
                message: userId
                    ? "Product added to cart and reserved for 15 minutes"
                    : "Product added to cart",
                ...issuedToken(cart)
            });
        } catch (error) {
            if (connection) await connection.rollback();
            console.error("ADD TO CART ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to add to cart" });
        } finally {
            if (connection) connection.release();
        }
    },

    // Set the quantity of a line already in the cart
    updateCartItem: async (req, res) => {
        let connection;
        try {
            connection = await promisePool.getConnection();
            const { userId } = req.cartIdentity;

            const quantity = safeInteger(req.body.quantity, 0);
            const line = normalizeCartLine({ ...req.body, quantity });

            if (!line || quantity < 1) {
                return res.status(400).json({ success: false, message: "Invalid product ID or quantity" });
            }

            // Changing the quantity of a line implies a basket to change it
            // in, so this reads the cart rather than opening one. A shopper
            // with no cart is answered the same way a shopper without that
            // line is.
            const cartId = await resolveCartForRead(req);

            if (!cartId) {
                return res.status(404).json({ success: false, message: "Product not found in cart" });
            }

            await connection.beginTransaction();

            // Live, not merely present. Raising the quantity of a product that
            // has been withdrawn reserves stock for something that cannot be
            // sold, and leaves a bigger line to carry to checkout (#1546).
            if (!(await isLiveProduct(connection, line.productId))) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: "This product is no longer available"
                });
            }

            // Move the reservation for this line to the new quantity (release
            // then re-reserve) so held stock tracks the cart. Other variants of
            // the same product keep their own reservations.
            if (userId) {
                await inventoryReservationService.releaseLineLocks(userId, line, connection);

                const reserved = await inventoryReservationService.reserveStock(userId, line.productId, line.quantity, connection, line);
                if (!reserved) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: "Requested quantity exceeds available stock" });
                }
            }

            const [result] = await connection.query(
                "UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ? AND variant_id = ? AND color = ? AND size = ?",
                [line.quantity, cartId, line.productId, line.variantId, line.color, line.size]
            );

            if (result.affectedRows === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: "Product not found in cart" });
            }

            await recordActivity({ cartId, userId }, connection);

            await connection.commit();
            return res.status(200).json({ success: true, message: "Cart item updated" });
        } catch (error) {
            if (connection) await connection.rollback();
            console.error("UPDATE CART ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to update cart" });
        } finally {
            if (connection) connection.release();
        }
    },

    // Remove a single line from the cart. The variant choice travels as query
    // parameters because a DELETE carries no body.
    removeCartItem: async (req, res) => {
        try {
            const { userId } = req.cartIdentity;

            const line = normalizeCartLine({
                productId: req.params.productId,
                variantId: req.query.variantId,
                color: req.query.color,
                size: req.query.size
            });

            if (!line) {
                return res.status(400).json({ success: false, message: "Invalid product ID" });
            }

            const cartId = await resolveCartForRead(req);

            if (!cartId) {
                return res.status(404).json({ success: false, message: "Product not found in cart" });
            }

            const [result] = await promisePool.query(
                "DELETE FROM cart_items WHERE cart_id = ? AND product_id = ? AND variant_id = ? AND color = ? AND size = ?",
                [cartId, line.productId, line.variantId, line.color, line.size]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Product not found in cart" });
            }

            // The line is gone, so the stock it was holding must go with it.
            if (userId) {
                await inventoryReservationService.releaseLineLocks(userId, line);
            }

            // Removing a line is shopper activity, but taking things out of
            // the cart is no reason to create one -- which is why the cart was
            // read rather than resolved above.
            await recordActivity({ cartId, userId });

            return res.status(200).json({ success: true, message: "Product removed from cart" });
        } catch (error) {
            console.error("REMOVE CART ITEM ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to remove item" });
        }
    },

    // Clear the entire cart
    clearCart: async (req, res) => {
        try {
            const { userId } = req.cartIdentity;
            const cartId = await resolveCartForRead(req);

            if (!cartId) {
                return res.status(200).json({ success: true, message: "Cart cleared" });
            }

            await promisePool.query("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);

            if (userId) {
                await inventoryReservationService.releaseUserLocks(userId);
            }

            // The cart stays active and empty. Emptying it is a decision the
            // shopper just made, not a cart to close: closing it here would
            // report a deliberate clear-out as an abandonment.
            await recordActivity({ cartId, userId });

            return res.status(200).json({ success: true, message: "Cart cleared" });
        } catch (error) {
            console.error("CLEAR CART ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to clear cart" });
        }
    }
};

module.exports = cartController;
