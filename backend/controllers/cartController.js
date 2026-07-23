const promisePool = require("../config/db");
const { safeNumber, safeUUID } = require("../utils/helpers");
const inventoryReservationService = require("../services/inventoryReservationService");

function normalizeCartQuantities(items) {
    const quantities = new Map();

    for (const item of items) {
        if (!item) continue;

        const productId = safeUUID(item.productId ?? item.id);
        let qty = safeNumber(item.qty ?? item.quantity);

        if (!productId) continue;
        if (qty < 1) qty = 1;

        quantities.set(productId, qty);
    }

    return quantities;
}

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

    // Replace the user's entire cart with the posted items
    syncCart: async (req, res) => {
        let connection;

        try {
            connection = await promisePool.getConnection();

            const userId = req.user.id;
            const items = Array.isArray(req.body.items)
                ? req.body.items
                : [];
            const quantities = normalizeCartQuantities(items);

            await connection.beginTransaction();

            let placeholders = [];
            let values = [];

            if (quantities.size) {
                const ids = [...quantities.keys()];

                const [products] = await connection.query(
                    `SELECT id, stock FROM products WHERE id IN (${ids.map(() => "?").join(",")})`,
                    ids
                );

                const productMap = new Map(
                    products.map((product) => [
                        safeUUID(product.id),
                        safeNumber(product.stock)
                    ])
                );

                for (const [productId, qty] of quantities) {
                    if (!productMap.has(productId)) continue;

                    const availableStock = productMap.get(productId);

                    if (qty > availableStock) {
                        await connection.rollback();

                        return res.status(400).json({
                            success: false,
                            message: `Requested quantity exceeds available stock for product ${productId}`
                        });
                    }

                    placeholders.push("(?, ?, ?)");
                    values.push(userId, productId, qty);
                }
            }

            // clear existing cart only after validation succeeds
            await connection.query(
                "DELETE FROM cart_items WHERE user_id = ?",
                [userId]
            );

            if (placeholders.length) {
                await connection.query(
                    `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ${placeholders.join(",")}`,
                    values
                );
            }

            await connection.commit();

            return res.status(200).json({
                success: true,
                message: "Cart synced"
            });

        } catch (error) {
            await connection.rollback();
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

    // Add a single product to cart
    addToCart: async (req, res) => {
        let connection;
        try {
            connection = await promisePool.getConnection();
            const userId = req.user.id;
            const productId = safeNumber(req.body.productId);
            const quantity = safeNumber(req.body.quantity ?? 1);

            if (productId < 1 || quantity < 1) {
                return res.status(400).json({ success: false, message: "Invalid product ID or quantity" });
            }

            await connection.beginTransaction();

            const reserved = await inventoryReservationService.reserveStock(userId, productId, quantity, connection);
            if (!reserved) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: "Requested quantity exceeds available stock or could not be reserved" });
            }

            const [cartItems] = await connection.query("SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?", [userId, productId]);
            let currentQty = cartItems.length > 0 ? cartItems[0].quantity : 0;
            let newQty = currentQty + quantity;

            if (cartItems.length > 0) {
                await connection.query("UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?", [newQty, userId, productId]);
            } else {
                await connection.query("INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)", [userId, productId, newQty]);
            }

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

    // Update quantity of an item already in cart
    updateCartItem: async (req, res) => {
        let connection;
        try {
            connection = await promisePool.getConnection();
            const userId = req.user.id;
            const productId = safeNumber(req.body.productId);
            const quantity = safeNumber(req.body.quantity);

            if (productId < 1 || quantity < 1) {
                return res.status(400).json({ success: false, message: "Invalid product ID or quantity" });
            }

            await connection.beginTransaction();

            const [products] = await connection.query("SELECT id, stock FROM products WHERE id = ?", [productId]);
            if (products.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: "Product not found" });
            }
            if (quantity > products[0].stock) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: "Requested quantity exceeds available stock" });
            }

            const [result] = await connection.query("UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?", [quantity, userId, productId]);
            
            if (result.affectedRows === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: "Product not found in cart" });
            }

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

    // Remove a single product from cart
    removeCartItem: async (req, res) => {
        try {
            const userId = req.user.id;
            const productId = safeNumber(req.params.productId);

            if (productId < 1) {
                return res.status(400).json({ success: false, message: "Invalid product ID" });
            }

            const [result] = await promisePool.query("DELETE FROM cart_items WHERE user_id = ? AND product_id = ?", [userId, productId]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Product not found in cart" });
            }

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
            return res.status(200).json({ success: true, message: "Cart cleared" });
        } catch (error) {
            console.error("CLEAR CART ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to clear cart" });
        }
    }
};

module.exports = cartController;
