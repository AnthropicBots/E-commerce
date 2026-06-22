const promisePool = require("../config/db");
const { safeNumber } = require("../utils/helpers");

const wishlistController = {
    // Get user wishlist
    getUserWishlist: async (req, res) => {
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
                    w.created_at as added_at
                FROM wishlist_items w
                JOIN products p ON w.product_id = p.id
                WHERE w.user_id = ?
                ORDER BY w.created_at DESC
            `, [userId]);

            return res.status(200).json({
                success: true,
                wishlist: rows
            });

        } catch (error) {
            console.error("GET WISHLIST ERROR:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch wishlist"
            });
        }
    },

    // Add to wishlist
    addToWishlist: async (req, res) => {
        try {
            const userId = req.user.id;
            const productId = safeNumber(req.body.productId);

            if (!productId || productId < 1) {
                return res.status(400).json({
                    success: false,
                    message: "Valid product ID is required"
                });
            }

            // Check if product exists
            const [products] = await promisePool.query(
                "SELECT id FROM products WHERE id = ?",
                [productId]
            );

            if (!products.length) {
                return res.status(404).json({
                    success: false,
                    message: "Product not found"
                });
            }

            // Insert, ignore if already exists (unique constraint handles this, but we'll use INSERT IGNORE)
            await promisePool.query(`
                INSERT IGNORE INTO wishlist_items (user_id, product_id)
                VALUES (?, ?)
            `, [userId, productId]);

            return res.status(200).json({
                success: true,
                message: "Added to wishlist"
            });

        } catch (error) {
            console.error("ADD TO WISHLIST ERROR:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to add to wishlist"
            });
        }
    },

    // Remove from wishlist
    removeFromWishlist: async (req, res) => {
        try {
            const userId = req.user.id;
            const productId = safeNumber(req.body.productId);

            if (!productId || productId < 1) {
                return res.status(400).json({
                    success: false,
                    message: "Valid product ID is required"
                });
            }

            const [result] = await promisePool.query(`
                DeleteE FROM wishlist_items 
                WHERE user_id = ? AND product_id = ?
            `, [userId, productId]);

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Item not found in wishlist"
                });
            }

            return res.status(200).json({
                success: true,
                message: "Removed from wishlist"
            });

        } catch (error) {
            console.error("REMOVE FROM WISHLIST ERROR:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to remove from wishlist"
            });
        }
    },

    // Replace the user's entire wishlist with the posted items
    syncWishlist: async (req, res) => {
        const connection = await promisePool.getConnection();

        try {
            const userId = req.user.id;
            const items = Array.isArray(req.body.items)
                ? req.body.items
                : [];

            // normalize to a unique set of product ids
            const productIds = new Set();

            for (const item of items) {
                if (!item) continue;

                const productId = safeNumber(
                    item.productId != null ? item.productId : item.id
                );

                if (!productId || productId < 1) continue;

                productIds.add(productId);
            }

            await connection.beginTransaction();

            // clear existing wishlist
            await connection.query(
                "DELETE FROM wishlist_items WHERE user_id = ?",
                [userId]
            );

            if (productIds.size) {
                const ids = [...productIds];

                // keep only products that still exist
                const [products] = await connection.query(
                    `SELECT id FROM products WHERE id IN (${ids.map(() => "?").join(",")})`,
                    ids
                );

                const validIds = products.map((p) => p.id);

                if (validIds.length) {
                    const placeholders = validIds
                        .map(() => "(?, ?)")
                        .join(",");

                    const values = [];
                    validIds.forEach((productId) => {
                        values.push(userId, productId);
                    });

                    await connection.query(
                        `INSERT INTO wishlist_items (user_id, product_id) VALUES ${placeholders}`,
                        values
                    );
                }
            }

            await connection.commit();

            return res.status(200).json({
                success: true,
                message: "Wishlist synced"
            });

        } catch (error) {
            await connection.rollback();
            console.error("SYNC WISHLIST ERROR:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to sync wishlist"
            });
        } finally {
            connection.release();
        }
    }
};

module.exports = wishlistController;
