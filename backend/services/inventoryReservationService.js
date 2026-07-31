const promisePool = require("../config/db");
const { safeArray, safeInteger, safeNumber, sanitizeString } = require("../utils/helpers");
const { NO_VARIANT_ID } = require("./cart.service");

const LOCK_TTL_MS = 15 * 60000;

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

// Resolve the variant a line refers to, so availability can be judged against
// the chosen variant's stock instead of the parent product's total. Deliberately
// defensive: deployments without a `product_variants` table, or with ambiguous
// attributes, fall back to product-level behaviour rather than failing the
// reservation.
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

        // An ambiguous attribute match tells us nothing, so treat it as unknown.
        return matches.length === 1 ? matches[0] : null;
    } catch {
        return null;
    }
}

// Availability check + lock insert. This MUST run inside a transaction on
// `conn`: the `FOR UPDATE` row lock only serializes concurrent reservations
// while the surrounding transaction is open, which is what closes the
// check-then-insert oversell race.
async function reserveStockInTransaction(conn, userId, productId, quantity, now, line) {
    // Remove expired locks
    await conn.query("DELETE FROM inventory_locks WHERE expires_at <= ?", [now]);

    // Lock the product row so competing reservations queue behind us instead
    // of all reading the same pre-insert availability. This happens even when a
    // variant was chosen, because the variant rows hang off this product.
    const [products] = await conn.query(
        "SELECT stock FROM products WHERE id = ? FOR UPDATE",
        [productId]
    );
    if (products.length === 0) return false;

    let totalStock = safeNumber(products[0].stock);

    const variant = await resolveLockVariant(conn, productId, line);

    const hasVariantStock =
        Boolean(variant) && variant.stock !== null && variant.stock !== undefined;

    if (hasVariantStock) {
        totalStock = safeNumber(variant.stock);
    }

    // The pool of held units has to be scoped the same way as the stock figure
    // it is subtracted from: per line when the chosen variant carries its own
    // stock, otherwise across the whole product. Scoping the locks per line
    // while measuring against product stock would let each variant lock the
    // product's entire stock over again.
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
    const availableStock = totalStock - lockedStock;

    if (quantity > availableStock) {
        return false;
    }

    // Create lock for 15 minutes
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    await conn.query(
        "INSERT INTO inventory_locks (user_id, product_id, quantity, variant_id, color, size, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [userId, productId, quantity, line.variantId, line.color, line.size, expiresAt]
    );

    return true;
}

const inventoryReservationService = {
    // Acquire a lock for a cart line. `line` carries the variant choice
    // (variantId and/or colour/size); omitting it reserves at product level.
    reserveStock: async (userId, productId, quantity, connection = null, line = {}) => {
        const now = new Date();
        const reservedLine = lockLine({ ...line, productId });

        // Caller owns the transaction (e.g. cartController.addToCart), so the
        // FOR UPDATE row lock is already effective — just run the check+insert.
        if (connection) {
            return reserveStockInTransaction(connection, userId, productId, quantity, now, reservedLine);
        }

        // Standalone caller: own the transaction ourselves so FOR UPDATE
        // actually locks the row. Signature is unchanged for these callers.
        const conn = await promisePool.getConnection();
        try {
            await conn.beginTransaction();
            const reserved = await reserveStockInTransaction(conn, userId, productId, quantity, now, reservedLine);
            await conn.commit();
            return reserved;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    },

    // Release a user's reservation(s); pass a productId to target a single
    // product, omit it to clear the user's entire reservation set.
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

    // Release the reservation for one cart line, leaving the user's other
    // variants of the same product held.
    releaseLineLocks: async (userId, item, connection = null) => {
        const pool = connection || promisePool;
        const line = lockLine(item);

        await pool.query(
            "DELETE FROM inventory_locks WHERE user_id = ? AND product_id = ? AND variant_id = ? AND color = ? AND size = ?",
            [userId, line.productId, line.variantId, line.color, line.size]
        );
    },

    // Validate if the user holds locks for their entire cart
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

        // Consume exactly the line's quantity in UNITS. A single lock row can
        // hold quantity > 1, so we walk rows (oldest-expiring first for
        // determinism) fully deleting those we can consume whole and decrementing
        // the final partially-consumed row.
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
