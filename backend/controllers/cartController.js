const promisePool = require("../config/db");
const { safeInteger, safeUUID } = require("../utils/helpers");
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

const cartController = {
    // Get the logged-in user's cart (joined with product data)
    getUserCart: async (req, res) => {
        try {
            const userId = req.user.id;

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
                WHERE c.user_id = ?
                ORDER BY c.created_at DESC
            `, [userId]);

            return res.status(200).json({
                success: true,
                cart: rows
            });

        } catch (error) {
            console.error("GET CART ERROR:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch cart"
            });
        }
    },

    // Replace the user's entire cart with the posted lines
    syncCart: async (req, res) => {
        let connection;

        try {
            const userId = req.user.id;

            // A client may only replace the cart it already owns. A payload
            // that declares a different owner — or still declares itself a
            // guest cart — has not been reconciled against this session, and
            // adopting it would attach one shopper's basket to another's
            // account.
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

            // /cart/sync is replace-all: drop the user's current reservations
            // up front so the ones created below match the synced lines.
            await inventoryReservationService.releaseUserLocks(userId, null, connection);

            const cartId = await cartLifecycle.resolveActiveCart(userId, connection);

            let placeholders = [];
            let values = [];

            if (lines.length) {
                const productIds = [...new Set(lines.map((line) => line.productId))];

                const [products] = await connection.query(
                    `SELECT id FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`,
                    productIds
                );

                const knownProductIds = new Set(
                    products.map((product) => safeUUID(product.id))
                );

                for (const line of lines) {
                    if (!knownProductIds.has(line.productId)) continue;

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

                    placeholders.push("(?, ?, ?, ?, ?, ?, ?)");
                    values.push(
                        userId,
                        cartId,
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
                "DELETE FROM cart_items WHERE user_id = ?",
                [userId]
            );

            if (placeholders.length) {
                await connection.query(
                    `INSERT INTO cart_items (user_id, cart_id, product_id, variant_id, color, size, quantity) VALUES ${placeholders.join(",")}`,
                    values
                );
            }

            await cartLifecycle.touchCart(cartId, connection);

            await connection.commit();

            return res.status(200).json({
                success: true,
                message: "Cart synced"
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
            const userId = req.user.id;

            // A quantity below 1 is a client error rather than something to
            // clamp, so it is read before normalization floors it.
            const quantity = safeInteger(req.body.quantity ?? 1, 0);
            const line = normalizeCartLine({ ...req.body, quantity });

            if (!line || quantity < 1) {
                return res.status(400).json({ success: false, message: "Invalid product ID or quantity" });
            }

            await connection.beginTransaction();

            const cartId = await cartLifecycle.resolveActiveCart(userId, connection);

            const reserved = await inventoryReservationService.reserveStock(userId, line.productId, line.quantity, connection, line);
            if (!reserved) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: "Requested quantity exceeds available stock or could not be reserved" });
            }

            const [existingLines] = await connection.query(
                "SELECT product_id, variant_id, color, size, quantity FROM cart_items WHERE user_id = ? AND product_id = ?",
                [userId, line.productId]
            );

            // Adding to a line that is already in the cart is the one place
            // quantities are summed, and only for the very same line.
            const key = cartLineKey(line);
            const mergedLine =
                mergeCartLines(existingLines, [line])
                    .find((candidate) => cartLineKey(candidate) === key) || line;

            // Updating cart_id on conflict also adopts any line left behind by
            // a database that predates the cart record.
            await connection.query(
                `INSERT INTO cart_items (user_id, cart_id, product_id, variant_id, color, size, quantity)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), cart_id = VALUES(cart_id)`,
                [userId, cartId, line.productId, line.variantId, line.color, line.size, mergedLine.quantity]
            );

            await cartLifecycle.touchCart(cartId, connection);

            await connection.commit();
            return res.status(200).json({ success: true, message: "Product added to cart and reserved for 15 minutes" });
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
            const userId = req.user.id;

            const quantity = safeInteger(req.body.quantity, 0);
            const line = normalizeCartLine({ ...req.body, quantity });

            if (!line || quantity < 1) {
                return res.status(400).json({ success: false, message: "Invalid product ID or quantity" });
            }

            await connection.beginTransaction();

            const [products] = await connection.query("SELECT id FROM products WHERE id = ?", [line.productId]);
            if (products.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: "Product not found" });
            }

            // Move the reservation for this line to the new quantity (release
            // then re-reserve) so held stock tracks the cart. Other variants of
            // the same product keep their own reservations.
            await inventoryReservationService.releaseLineLocks(userId, line, connection);

            const reserved = await inventoryReservationService.reserveStock(userId, line.productId, line.quantity, connection, line);
            if (!reserved) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: "Requested quantity exceeds available stock" });
            }

            const cartId = await cartLifecycle.resolveActiveCart(userId, connection);

            // Quantity only. Folding cart_id into the SET would make
            // affectedRows non-zero for a line whose quantity did not change,
            // turning today's "Product not found in cart" answer into a
            // success. Adoption of pre-#1364 lines is the migration's job.
            const [result] = await connection.query(
                "UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ? AND variant_id = ? AND color = ? AND size = ?",
                [line.quantity, userId, line.productId, line.variantId, line.color, line.size]
            );

            if (result.affectedRows === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: "Product not found in cart" });
            }

            await cartLifecycle.touchCart(cartId, connection);

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
            const userId = req.user.id;

            const line = normalizeCartLine({
                productId: req.params.productId,
                variantId: req.query.variantId,
                color: req.query.color,
                size: req.query.size
            });

            if (!line) {
                return res.status(400).json({ success: false, message: "Invalid product ID" });
            }

            const [result] = await promisePool.query(
                "DELETE FROM cart_items WHERE user_id = ? AND product_id = ? AND variant_id = ? AND color = ? AND size = ?",
                [userId, line.productId, line.variantId, line.color, line.size]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Product not found in cart" });
            }

            // The line is gone, so the stock it was holding must go with it.
            await inventoryReservationService.releaseLineLocks(userId, line);

            // Removing a line is shopper activity. Touch rather than resolve:
            // taking things out of the cart is no reason to create one.
            await cartLifecycle.touchCart(
                await cartLifecycle.findActiveCartId(userId)
            );

            return res.status(200).json({ success: true, message: "Product removed from cart" });
        } catch (error) {
            console.error("REMOVE CART ITEM ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to remove item" });
        }
    },

    // Clear the entire cart
    clearCart: async (req, res) => {
        try {
            const userId = req.user.id;
            await promisePool.query("DELETE FROM cart_items WHERE user_id = ?", [userId]);
            await inventoryReservationService.releaseUserLocks(userId);

            // The cart stays active and empty. Emptying it is a decision the
            // shopper just made, not a cart to close: closing it here would
            // report a deliberate clear-out as an abandonment.
            await cartLifecycle.touchCart(
                await cartLifecycle.findActiveCartId(userId)
            );

            return res.status(200).json({ success: true, message: "Cart cleared" });
        } catch (error) {
            console.error("CLEAR CART ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to clear cart" });
        }
    }
};

module.exports = cartController;
