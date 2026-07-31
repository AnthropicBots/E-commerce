const promisePool = require("../config/db");
const { safeArray, safeInteger, safeNumber, sanitizeString } = require("../utils/helpers");
const { NO_VARIANT_ID } = require("./cart.service");
const { cacheService } = require("./cacheService");

// Issue #1260: configurable reservation TTL (default 10 minutes)
const LOCK_TTL_MS = (parseInt(process.env.INVENTORY_LOCK_TTL_MS, 10) || 10 * 60 * 1000);
const REDLOCK_TTL_MS = parseInt(process.env.INVENTORY_REDLOCK_TTL_MS, 10) || 5000;

const INSUFFICIENT_STOCK_CODE = "INSUFFICIENT_STOCK";
const LOCK_BUSY_CODE = "INVENTORY_LOCK_BUSY";

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

function hasVariantChoice(line) {
    return line.variantId > NO_VARIANT_ID || Boolean(line.color) || Boolean(line.size);
}

function failResult(overrides = {}) {
    return {
        success: false,
        reserved: false,
        code: INSUFFICIENT_STOCK_CODE,
        availableStock: 0,
        requestedQuantity: 0,
        productId: null,
        ...overrides
    };
}

function okResult(overrides = {}) {
    return {
        success: true,
        reserved: true,
        code: null,
        ...overrides
    };
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
 * Returns a structured result (never throws for soft stock conflicts).
 */
async function reserveStockInTransaction(conn, userId, productId, quantity, now, line) {
    await conn.query("DELETE FROM inventory_locks WHERE expires_at <= ?", [now]);

    const [products] = await conn.query(
        "SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE",
        [productId]
    );
    if (products.length === 0) {
        return failResult({
            code: "PRODUCT_NOT_FOUND",
            productId,
            requestedQuantity: quantity,
            message: "Product not found"
        });
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

    const lockedStock = safeNumber(locks[0].locked_qty || 0);
    const availableStock = Math.max(0, totalStock - lockedStock);

    if (quantity > availableStock) {
        return failResult({
            code: INSUFFICIENT_STOCK_CODE,
            productId,
            productName,
            requestedQuantity: quantity,
            availableStock,
            totalStock,
            lockedStock,
            message: `Only ${availableStock} unit(s) available for ${productName || productId}`
        });
    }

    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    await conn.query(
        "INSERT INTO inventory_locks (user_id, product_id, quantity, variant_id, color, size, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [userId, productId, quantity, line.variantId, line.color, line.size, expiresAt]
    );

    return okResult({
        productId,
        productName,
        requestedQuantity: quantity,
        availableStock: availableStock - quantity,
        totalStock,
        lockedStock: lockedStock + quantity,
        expiresAt,
        ttlMs: LOCK_TTL_MS
    });
}

/**
 * Redis Redlock pre-gate then MySQL FOR UPDATE reservation.
 */
async function reserveStockDetailed(userId, productId, quantity, connection = null, line = {}) {
    const now = new Date();
    const reservedLine = lockLine({ ...line, productId });
    const redlockName = `inventory:${lockLineKey(reservedLine)}`;

    const run = async (conn) =>
        reserveStockInTransaction(conn, userId, productId, quantity, now, reservedLine);

    try {
        return await cacheService.withLock(
            redlockName,
            async () => {
                if (connection) {
                    return run(connection);
                }

                const conn = await promisePool.getConnection();
                try {
                    await conn.beginTransaction();
                    const result = await run(conn);
                    if (!result.success) {
                        await conn.rollback();
                    } else {
                        await conn.commit();
                    }
                    return result;
                } catch (error) {
                    await conn.rollback();
                    throw error;
                } finally {
                    conn.release();
                }
            },
            { ttlMs: REDLOCK_TTL_MS }
        );
    } catch (error) {
        if (error.code === "LOCK_NOT_ACQUIRED") {
            return failResult({
                code: LOCK_BUSY_CODE,
                productId,
                requestedQuantity: quantity,
                availableStock: null,
                message: "Inventory is busy under high load. Please retry."
            });
        }
        throw error;
    }
}

const inventoryReservationService = {
    LOCK_TTL_MS,
    INSUFFICIENT_STOCK_CODE,
    LOCK_BUSY_CODE,

    /**
     * Backward-compatible boolean API used by cart flows.
     */
    reserveStock: async (userId, productId, quantity, connection = null, line = {}) => {
        const result = await reserveStockDetailed(
            userId,
            productId,
            quantity,
            connection,
            line
        );
        return Boolean(result.success);
    },

    /**
     * Structured reservation result for checkout 409 responses (#1260).
     */
    reserveStockDetailed,

    /**
     * Ensure every checkout line has a valid lock; reserve missing capacity.
     * Runs under Redis + MySQL locks per product line.
     */
    ensureCheckoutReservations: async (userId, cartItems, connection = null) => {
        const now = new Date();
        const pool = connection || promisePool;
        const conflicts = [];

        const [existingLocks] = await pool.query(
            `SELECT product_id, variant_id, color, size, SUM(quantity) as locked_qty
             FROM inventory_locks
             WHERE user_id = ? AND expires_at > ?
             GROUP BY product_id, variant_id, color, size`,
            [userId, now]
        );

        const lockMap = new Map();
        for (const lock of safeArray(existingLocks)) {
            lockMap.set(lockLineKey(lockLine(lock)), safeNumber(lock.locked_qty));
        }

        for (const item of safeArray(cartItems)) {
            const line = lockLine(item);
            const qty = Math.max(1, safeInteger(item.quantity ?? item.qty, 1));
            const held = lockMap.get(lockLineKey(line)) || 0;
            const need = qty - held;

            if (need <= 0) continue;

            const result = await reserveStockDetailed(
                userId,
                line.productId,
                need,
                connection,
                line
            );

            if (!result.success) {
                conflicts.push(result);
            } else {
                lockMap.set(
                    lockLineKey(line),
                    held + need
                );
            }
        }

        if (conflicts.length) {
            return {
                success: false,
                code: INSUFFICIENT_STOCK_CODE,
                message: "Unable to reserve inventory for one or more items",
                conflicts,
                // Convenience fields from the first conflict for simple clients
                availableStock: conflicts[0].availableStock,
                productId: conflicts[0].productId
            };
        }

        return { success: true, conflicts: [] };
    },

    /**
     * Atomically deduct stock for checkout lines (FOR UPDATE + stock >= qty).
     * Call inside the order transaction after reservations are confirmed.
     */
    deductStockForCheckout: async (cartItems, connection) => {
        if (!connection) {
            throw new Error("deductStockForCheckout requires a transactional connection");
        }

        const conflicts = [];

        for (const item of safeArray(cartItems)) {
            const productId = item.productId ?? item.product_id ?? item.id;
            const qty = Math.max(1, safeInteger(item.quantity ?? item.qty, 1));

            const [rows] = await connection.query(
                "SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE",
                [productId]
            );
            const product = safeArray(rows)[0];
            if (!product) {
                conflicts.push(
                    failResult({
                        code: "PRODUCT_NOT_FOUND",
                        productId,
                        requestedQuantity: qty,
                        message: "Product not found"
                    })
                );
                continue;
            }

            const availableStock = safeNumber(product.stock);
            if (availableStock < qty) {
                conflicts.push(
                    failResult({
                        productId,
                        productName: product.name,
                        requestedQuantity: qty,
                        availableStock,
                        message: `Only ${availableStock} unit(s) available for ${product.name}`
                    })
                );
                continue;
            }

            const [result] = await connection.query(
                `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`,
                [qty, productId, qty]
            );

            if (result.affectedRows === 0) {
                conflicts.push(
                    failResult({
                        productId,
                        productName: product.name,
                        requestedQuantity: qty,
                        availableStock: 0,
                        message: `Stock changed during checkout for ${product.name}`
                    })
                );
            }
        }

        if (conflicts.length) {
            return { success: false, code: INSUFFICIENT_STOCK_CODE, conflicts };
        }
        return { success: true, conflicts: [] };
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
     * Release locks created during a failed checkout (rollback companion).
     */
    releaseCheckoutLocks: async (userId, cartItems, connection = null) => {
        for (const item of safeArray(cartItems)) {
            await inventoryReservationService.releaseLineLocks(userId, item, connection);
        }
    },

    validateCartLocks: async (userId, cartItems, connection = null) => {
        const pool = connection || promisePool;
        const now = new Date();

        const [locks] = await pool.query(
            "SELECT product_id, variant_id, color, size, SUM(quantity) as locked_qty FROM inventory_locks WHERE user_id = ? AND expires_at > ? GROUP BY product_id, variant_id, color, size",
            [userId, now]
        );

        const lockMap = new Map();
        for (const lock of locks) {
            lockMap.set(lockLineKey(lockLine(lock)), lock.locked_qty);
        }

        for (const item of cartItems) {
            const lockedQty = lockMap.get(lockLineKey(lockLine(item))) || 0;
            const qty = safeInteger(item.quantity ?? item.qty, 0);

            if (qty > lockedQty) {
                return false;
            }
        }

        return true;
    },

    /**
     * Structured validation used by checkout for 409 payloads.
     */
    validateCartLocksDetailed: async (userId, cartItems, connection = null) => {
        const pool = connection || promisePool;
        const now = new Date();
        const conflicts = [];

        const [locks] = await pool.query(
            "SELECT product_id, variant_id, color, size, SUM(quantity) as locked_qty FROM inventory_locks WHERE user_id = ? AND expires_at > ? GROUP BY product_id, variant_id, color, size",
            [userId, now]
        );

        const lockMap = new Map();
        for (const lock of locks) {
            lockMap.set(lockLineKey(lockLine(lock)), safeNumber(lock.locked_qty));
        }

        for (const item of safeArray(cartItems)) {
            const line = lockLine(item);
            const qty = safeInteger(item.quantity ?? item.qty, 0);
            const lockedQty = lockMap.get(lockLineKey(line)) || 0;

            if (qty > lockedQty) {
                // Report live available stock under FOR UPDATE when possible
                let availableStock = lockedQty;
                try {
                    const [products] = await pool.query(
                        "SELECT stock FROM products WHERE id = ? FOR UPDATE",
                        [line.productId]
                    );
                    if (products[0]) {
                        const [held] = await pool.query(
                            "SELECT SUM(quantity) as locked_qty FROM inventory_locks WHERE product_id = ? AND expires_at > ?",
                            [line.productId, now]
                        );
                        availableStock = Math.max(
                            0,
                            safeNumber(products[0].stock) - safeNumber(held[0]?.locked_qty || 0)
                        );
                    }
                } catch (_) {
                    /* keep lockedQty */
                }

                conflicts.push(
                    failResult({
                        productId: line.productId,
                        requestedQuantity: qty,
                        availableStock,
                        lockedForUser: lockedQty,
                        message: "Inventory locks expired or insufficient stock"
                    })
                );
            }
        }

        return {
            success: conflicts.length === 0,
            code: conflicts.length ? INSUFFICIENT_STOCK_CODE : null,
            conflicts
        };
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
    }
};

module.exports = inventoryReservationService;
