const promisePool = require("../config/db");
const { safeNumber } = require("../utils/helpers");

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
        const connection = await promisePool.getConnection();

        try {
            const userId = req.user.id;
            const items = Array.isArray(req.body.items)
                ? req.body.items
                : [];

            // normalize to productId -> quantity (last write wins, qty >= 1)
            const quantities = new Map();

            for (const item of items) {
                if (!item) continue;

                const productId = safeNumber(
                    item.productId != null ? item.productId : item.id
                );

                let qty = safeNumber(
                    item.qty != null ? item.qty : item.quantity
                );

                if (!productId || productId < 1) continue;
                if (!qty || qty < 1) qty = 1;

                quantities.set(productId, qty);
            }

            await connection.beginTransaction();

            // clear existing cart
            await connection.query(
                "DELETE FROM cart_items WHERE user_id = ?",
                [userId]
            );

            if (quantities.size) {
                const ids = [...quantities.keys()];

                // keep only products that still exist
                const [products] = await connection.query(
                    `SELECT id FROM products WHERE id IN (${ids.map(() => "?").join(",")})`,
                    ids
                );

                const validIds = new Set(products.map((p) => p.id));

                const placeholders = [];
                const values = [];

                for (const [productId, qty] of quantities) {
                    if (!validIds.has(productId)) continue;
                    placeholders.push("(?, ?, ?)");
                    values.push(userId, productId, qty);
                }

                if (placeholders.length) {
                    await connection.query(
                        `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ${placeholders.join(",")}`,
                        values
                    );
                }
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
            connection.release();
        }
    }
};

module.exports = cartController;
