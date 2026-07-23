const promisePool = require("../config/db");

const LOCK_TTL_MS = 15 * 60000;

// Availability check + lock insert. This MUST run inside a transaction on
// `conn`: the `FOR UPDATE` row lock only serializes concurrent reservations
// while the surrounding transaction is open, which is what closes the
// check-then-insert oversell race.
async function reserveStockInTransaction(conn, userId, productId, quantity, now) {
    // Remove expired locks
    await conn.query("DELETE FROM inventory_locks WHERE expires_at <= ?", [now]);

    // Lock the product row so competing reservations queue behind us instead
    // of all reading the same pre-insert availability.
    const [products] = await conn.query(
        "SELECT stock FROM products WHERE id = ? FOR UPDATE",
        [productId]
    );
    if (products.length === 0) return false;

    const totalStock = products[0].stock;

    const [locks] = await conn.query(
        "SELECT SUM(quantity) as locked_qty FROM inventory_locks WHERE product_id = ? AND expires_at > ?",
        [productId, now]
    );

    const lockedStock = locks[0].locked_qty || 0;
    const availableStock = totalStock - lockedStock;

    if (quantity > availableStock) {
        return false;
    }

    // Create lock for 15 minutes
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    await conn.query(
        "INSERT INTO inventory_locks (user_id, product_id, quantity, expires_at) VALUES (?, ?, ?, ?)",
        [userId, productId, quantity, expiresAt]
    );

    return true;
}

const inventoryReservationService = {
    // Acquire a lock for a product
    reserveStock: async (userId, productId, quantity, connection = null) => {
        const now = new Date();

        // Caller owns the transaction (e.g. cartController.addToCart), so the
        // FOR UPDATE row lock is already effective — just run the check+insert.
        if (connection) {
            return reserveStockInTransaction(connection, userId, productId, quantity, now);
        }

        // Standalone caller: own the transaction ourselves so FOR UPDATE
        // actually locks the row. Signature is unchanged for these callers.
        const conn = await promisePool.getConnection();
        try {
            await conn.beginTransaction();
            const reserved = await reserveStockInTransaction(conn, userId, productId, quantity, now);
            await conn.commit();
            return reserved;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
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
        const now = new Date();

        // Consume exactly item.quantity UNITS per product. A single lock row can
        // hold quantity > 1, so we walk rows (oldest-expiring first for
        // determinism) fully deleting those we can consume whole and decrementing
        // the final partially-consumed row.
        for (const item of cartItems) {
            let remaining = item.quantity;
            if (remaining <= 0) continue;

            const [locks] = await pool.query(
                "SELECT id, quantity FROM inventory_locks WHERE user_id = ? AND product_id = ? AND expires_at > ? ORDER BY expires_at ASC",
                [userId, item.productId, now]
            );

            for (const lock of locks) {
                if (remaining <= 0) break;

                if (lock.quantity <= remaining) {
                    await pool.query("DELETE FROM inventory_locks WHERE id = ?", [lock.id]);
                    remaining -= lock.quantity;
                } else {
                    await pool.query(
                        "UPDATE inventory_locks SET quantity = quantity - ? WHERE id = ?",
                        [remaining, lock.id]
                    );
                    remaining = 0;
                }
            }
        }
    }
};

module.exports = inventoryReservationService;
