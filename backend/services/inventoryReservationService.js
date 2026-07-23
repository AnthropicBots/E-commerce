const promisePool = require("../config/db");

const inventoryReservationService = {
    // Acquire a lock for a product
    reserveStock: async (userId, productId, quantity, connection = null) => {
        const pool = connection || promisePool;
        
        // Remove expired locks
        const now = new Date();
        await pool.query("DELETE FROM inventory_locks WHERE expires_at <= ?", [now]);

        // Calculate available stock
        const [products] = await pool.query("SELECT stock FROM products WHERE id = ?", [productId]);
        if (products.length === 0) return false;
        
        const totalStock = products[0].stock;
        
        const [locks] = await pool.query(
            "SELECT SUM(quantity) as locked_qty FROM inventory_locks WHERE product_id = ? AND expires_at > ?", 
            [productId, now]
        );
        
        const lockedStock = locks[0].locked_qty || 0;
        const availableStock = totalStock - lockedStock;
        
        if (quantity > availableStock) {
            return false;
        }

        // Create lock for 15 minutes
        const expiresAt = new Date(now.getTime() + 15 * 60000);
        await pool.query(
            "INSERT INTO inventory_locks (user_id, product_id, quantity, expires_at) VALUES (?, ?, ?, ?)",
            [userId, productId, quantity, expiresAt]
        );
        
        return true;
    },

    // Validate if the user holds locks for their entire cart
    validateCartLocks: async (userId, cartItems, connection = null) => {
        const pool = connection || promisePool;
        const now = new Date();
        
        const [locks] = await pool.query(
            "SELECT product_id, SUM(quantity) as locked_qty FROM inventory_locks WHERE user_id = ? AND expires_at > ? GROUP BY product_id",
            [userId, now]
        );

        const lockMap = new Map();
        for (const lock of locks) {
            lockMap.set(lock.product_id, lock.locked_qty);
        }

        for (const item of cartItems) {
            const lockedQty = lockMap.get(item.productId) || 0;
            if (item.quantity > lockedQty) {
                return false;
            }
        }
        
        return true;
    },
    
    // Consume locks after purchase
    consumeLocks: async (userId, cartItems, connection = null) => {
        const pool = connection || promisePool;
        // Simply delete the user's locks for these products
        for (const item of cartItems) {
            await pool.query(
                "DELETE FROM inventory_locks WHERE user_id = ? AND product_id = ? LIMIT ?",
                [userId, item.productId, item.quantity]
            );
        }
    }
};

module.exports = inventoryReservationService;
