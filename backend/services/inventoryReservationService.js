const promisePool = require("../config/db");
const { safeArray, safeInteger, safeNumber, sanitizeString } = require("../utils/helpers");
const { NO_VARIANT_ID } = require("./cart.service");
const { cacheService } = require("./cacheService");

// Atomic reservation TTL — 10 minutes (#1260)
const LOCK_TTL_MS = parseInt(process.env.INVENTORY_LOCK_TTL_MS, 10) || 10 * 60 * 1000;
const REDIS_PRELOCK_TTL_MS = parseInt(process.env.INVENTORY_REDIS_LOCK_TTL_MS, 10) || 5000;

class InventoryConflictError extends Error {
    constructor({ productId, availableStock, requested, message }) {
        super(message || "Insufficient stock for reservation");
        this.name = "InventoryConflictError";
        this.code = "INVENTORY_CONFLICT";
        this.status = 409;
        this.productId = productId;
        this.availableStock = availableStock;
        this.requested = requested;
    }

    toJSON() {
        return {
            success: false,
            code: this.code,
            message: this.message,
            productId: this.productId,
            availableStock: this.availableStock,
            requested: this.requested
        };
    }
}

// A reservation is held against the line the shopper picked, not merely against
// the product. The key is built from what the client submitted — an explicit
// variant id when it has one, otherwise the colour/size choice — so /cart/add,
// /cart/sync and checkout all derive the same key without depending on variant
// metadata being resolvable.
function lockLine(item) {
    return {
        productId: item?.productId ?? item?.product_id ?? item?.id ?? null,
        variantId: Math.max(
            NO_VARIANT_ID,
            safeInteger(item?.variantId ?? item?.variant_id, NO_VARIANT_ID)
        ),
        color: sanitizeString(item?.color),
        size: sanitizeString(item?.size)
    };
}

function lockLineKey(line) {
    return [
        String(line.productId),
        String(line.variantId),
        line.color.toLowerCase(),
        line.size.toLowerCase()
    ].join("|");
}

function redisResourceKey(line) {
    return `inventory:${lockLineKey(line)}`;
}

function hasVariantChoice(line) {
    return line.variantId > NO_VARIANT_ID || Boolean(line.color) || Boolean(line.size);
}

async function resolveLockVariant(conn, productId, line) {
    if (!hasVariantChoice(line)) {
        return null;
    }

    try {
        if (line.variantId > NO_VARIANT_ID) {
            const [rows] = await conn.query(
                `SELECT id, stock FROM product_variants
                 WHERE id = ? AND product_id = ? AND is_active = 1
                 LIMIT 1 FOR UPDATE`,
                [line.variantId, productId]
            );

            return safeArray(rows)[0] || null;
        }

        const conditions = [];
        const params = [productId];

        if (line.color) {
            conditions.push(
                "LOWER(JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.color'))) = LOWER(?)"
            );
            params.push(line.color);
        }

        if (line.size) {
            conditions.push(
                "LOWER(JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.size'))) = LOWER(?)"
            );
            params.push(line.size);
        }

        const [rows] = await conn.query(
            `SELECT id, stock FROM product_variants
             WHERE product_id = ? AND is_active = 1
             AND ${conditions.join(" AND ")}
             LIMIT 2 FOR UPDATE`,
            params
        );

        const matches = safeArray(rows);
        return matches.length === 1 ? matches[0] : null;
    } catch {
        return null;
    }
}

/**
 * Availability check + lock insert inside an open transaction.
 * Uses SELECT ... FOR UPDATE so concurrent checkouts serialize on the row.
 * Returns a structured result for 409 Conflict responses (#1260).
 */
async function reserveStockInTransaction(conn, userId, productId, quantity, now, line) {
    await conn.query("DELETE FROM inventory_locks WHERE expires_at <= ?", [now]);

    const [products] = await conn.query(
        "SELECT id, stock, name FROM products WHERE id = ? FOR UPDATE",
        [productId]
    );
    if (products.length === 0) {
        return {
            ok: false,
            productId,
            availableStock: 0,
            requested: quantity,
            code: "PRODUCT_NOT_FOUND",
            message: "Product not found"
        };
    }

    let totalStock = safeNumber(products[0].stock);
    const productName = products[0].name;

    const variant = await resolveLockVariant(conn, productId, line);
    const hasVariantStock =
        Boolean(variant) && variant.stock !== null && variant.stock !== undefined;

    if (hasVariantStock) {
        totalStock = safeNumber(variant.stock);
    }

    const [locks] = hasVariantStock
        ? await conn.query(
            "SELECT SUM(quantity) as locked_qty FROM inventory_locks WHERE product_id = ? AND variant_id = ? AND color = ? AND size = ? AND expires_at > ?",
            [productId, line.variantId, line.color, line.size, now]
        )
        : await conn.query(
            "SELECT SUM(quantity) as locked_qty FROM inventory_locks WHERE product_id = ? AND expires_at > ?",
            [productId, now]
        );

    const lockedStock = locks[0].locked_qty || 0;
    const availableStock = Math.max(0, totalStock - lockedStock);

    if (quantity > availableStock) {
        return {
            ok: false,
            productId,
            availableStock,
            requested: quantity,
            code: "INVENTORY_CONFLICT",
            message: `Insufficient stock for ${sanitizeString(productName) || productId}. Available: ${availableStock}`
        };
    }

    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    await conn.query(
        "INSERT INTO inventory_locks (user_id, product_id, quantity, variant_id, color, size, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [userId, productId, quantity, line.variantId, line.color, line.size, expiresAt]
    );

    return {
        ok: true,
        productId,
        availableStock: availableStock - quantity,
        requested: quantity,
        expiresAt,
        code: "RESERVED"
    };
}

/**
 * Redis pre-lock (Redlock-style) then MySQL FOR UPDATE reservation.
 */
async function reserveWithDistributedLock(userId, productId, quantity, connection, line) {
    const now = new Date();
    const reservedLine = lockLine({ ...line, productId });
    const resource = redisResourceKey(reservedLine);

    const run = async () => {
        if (connection) {
            return reserveStockInTransaction(connection, userId, productId, quantity, now, reservedLine);
        }

        const conn = await promisePool.getConnection();
        try {
            await conn.beginTransaction();
            const result = await reserveStockInTransaction(
                conn, userId, productId, quantity, now, reservedLine
            );
            if (result.ok) {
                await conn.commit();
            } else {
                await conn.rollback();
            }
            return result;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    };

    try {
        return await cacheService.withLock(resource, run, {
            ttlMs: REDIS_PRELOCK_TTL_MS,
            retries: 5,
            retryDelayMs: 20
        });
    } catch (err) {
        if (err.code === 'LOCK_NOT_ACQUIRED') {
            return {
                ok: false,
                productId,
                availableStock: null,
                requested: quantity,
                code: 'LOCK_NOT_ACQUIRED',
                message: 'Could not acquire inventory lock; please retry'
            };
        }
        throw err;
    }
}

const inventoryReservationService = {
    LOCK_TTL_MS,
    InventoryConflictError,
    lockLine,
    lockLineKey,

    /**
     * Detailed reservation (structured result for 409 responses).
     */
    reserveStockDetailed: async (userId, productId, quantity, connection = null, line = {}) => {
        return reserveWithDistributedLock(userId, productId, quantity, connection, line);
    },

    /**
     * Backward-compatible boolean API used by cartController.
     */
    reserveStock: async (userId, productId, quantity, connection = null, line = {}) => {
        const result = await reserveWithDistributedLock(
            userId, productId, quantity, connection, line
        );
        return Boolean(result.ok);
    },

    /**
     * Reserve every checkout line atomically; fails fast with conflict details.
     */
    reserveCheckoutItems: async (userId, items, connection = null) => {
        const results = [];
        for (const item of safeArray(items)) {
            const productId = item.productId ?? item.product_id ?? item.id;
            const quantity = Math.max(1, safeInteger(item.quantity ?? item.qty, 1));
            const result = await reserveWithDistributedLock(
                userId,
                productId,
                quantity,
                connection,
                item
            );
            results.push(result);
            if (!result.ok) {
                return {
                    ok: false,
                    conflict: result,
                    results
                };
            }
        }
        return { ok: true, results };
    },

    releaseUserLocks: async (userId, productId = null, connection = null) => {
        const pool = connection || promisePool;

        if (productId === null) {
            await pool.query("DELETE FROM inventory_locks WHERE user_id = ?", [userId]);
        } else {
            await pool.query(
                "DELETE FROM inventory_locks WHERE user_id = ? AND product_id = ?",
                [userId, productId]
            );
        }
    },

    releaseLineLocks: async (userId, item, connection = null) => {
        const pool = connection || promisePool;
        const line = lockLine(item);

        await pool.query(
            "DELETE FROM inventory_locks WHERE user_id = ? AND product_id = ? AND variant_id = ? AND color = ? AND size = ?",
            [userId, line.productId, line.variantId, line.color, line.size]
        );
    },

    /**
     * Validate locks; returns structured failure when insufficient.
     */
    validateCartLocksDetailed: async (userId, cartItems, connection = null) => {
        const pool = connection || promisePool;
        const now = new Date();

        const [locks] = await pool.query(
            "SELECT product_id, variant_id, color, size, SUM(quantity) as locked_qty FROM inventory_locks WHERE user_id = ? AND expires_at > ? GROUP BY product_id, variant_id, color, size",
            [userId, now]
        );

        const lockMap = new Map();
        for (const lock of locks) {
            lockMap.set(lockLineKey(lockLine(lock)), Number(lock.locked_qty) || 0);
        }

        for (const item of cartItems) {
            const line = lockLine(item);
            const lockedQty = lockMap.get(lockLineKey(line)) || 0;
            const requested = safeInteger(item.quantity ?? item.qty, 0);

            if (requested > lockedQty) {
                // Also report live available stock under FOR UPDATE when possible
                let availableStock = lockedQty;
                try {
                    const [products] = await pool.query(
                        "SELECT stock FROM products WHERE id = ? FOR UPDATE",
                        [line.productId]
                    );
                    if (products[0]) {
                        availableStock = Math.max(0, safeNumber(products[0].stock));
                    }
                } catch (_) { /* ignore */ }

                return {
                    ok: false,
                    productId: line.productId,
                    availableStock,
                    requested,
                    lockedQty,
                    code: "INVENTORY_CONFLICT",
                    message: "Inventory locks expired or insufficient stock"
                };
            }
        }

        return { ok: true };
    },

    validateCartLocks: async (userId, cartItems, connection = null) => {
        const result = await inventoryReservationService.validateCartLocksDetailed(
            userId, cartItems, connection
        );
        return Boolean(result.ok);
    },

    consumeLocks: async (userId, cartItems, connection = null) => {
        const pool = connection || promisePool;
        const now = new Date();

        for (const item of cartItems) {
            let remaining = safeInteger(item?.quantity ?? item?.qty, 0);
            if (remaining <= 0) continue;

            const line = lockLine(item);

            const [locks] = await pool.query(
                "SELECT id, quantity FROM inventory_locks WHERE user_id = ? AND product_id = ? AND variant_id = ? AND color = ? AND size = ? AND expires_at > ? ORDER BY expires_at ASC",
                [userId, line.productId, line.variantId, line.color, line.size, now]
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
    },

    /**
     * Deduct stock under the same connection after FOR UPDATE (used at checkout).
     */
    deductStockAtomic: async (connection, productId, quantity) => {
        const [result] = await connection.query(
            `UPDATE products SET stock = stock - ?
             WHERE id = ? AND stock >= ?`,
            [quantity, productId, quantity]
        );
        return {
            ok: result.affectedRows > 0,
            productId,
            requested: quantity
        };
    }
};

module.exports = inventoryReservationService;
module.exports.InventoryConflictError = InventoryConflictError;
