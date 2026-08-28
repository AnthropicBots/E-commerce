// Which quantity column is authoritative for an order line, and the only place
// that moves it.
//
// A shopper buys a variant, not a product -- a medium in blue is what leaves
// the warehouse. So where a line resolves to a variant, `product_variants.stock`
// is the counter that is checked, decremented on sale and credited back on
// return. A line with no variant keeps `products.stock` as its counter and
// behaves exactly as it always has.
//
// `products.stock` is still maintained for a product that has variants, but as
// a roll-up rather than an authority. Availability filters, recommendation
// queries, product feeds, restock alerts and merchandising all read the product
// column; teaching every one of them to sum variants would be a far larger and
// riskier change than the one that closes the oversell. Keeping the roll-up in
// step inside the same transaction keeps all of them honest without making any
// of them the arbiter.

const { NO_VARIANT_ID } = require("./cart.service");
const { safeArray, safeInteger, sanitizeString } = require("../utils/helpers");
const logger = require("../utils/logger");

const normalizeVariantId = (value) =>
    Math.max(NO_VARIANT_ID, safeInteger(value, NO_VARIANT_ID));

/**
 * Find the active variant a line refers to: by explicit id when the client sent
 * one, otherwise by the colour/size choice matched against the variant's
 * attributes.
 *
 * Everything that needs to know which counter a line touches comes through
 * here. Reservation, pricing and the sale each resolving a line their own way
 * is how the quantity that was checked and the quantity that was decremented
 * came to be two different numbers.
 *
 * An ambiguous attribute match resolves to nothing rather than a guess: putting
 * the deduction on the wrong variant is worse than falling back to the product.
 * The lookup is deliberately defensive for the same reason it always was -- a
 * deployment with no `product_variants` table still has to be able to sell.
 *
 * @param {Object} connection - pool or transactional connection
 * @param {string} productId
 * @param {Object} item - anything carrying variantId/variant_id, color, size
 * @param {{ lockRows?: boolean }} [options]
 * @returns {Promise<Object|null>} the variant row, or null
 */
const resolveVariant = async (connection, productId, item, options = {}) => {
    const { lockRows = true } = options;
    const rowLock = lockRows ? " FOR UPDATE" : "";
    const explicitVariantId = normalizeVariantId(item?.variantId ?? item?.variant_id);

    try {
        if (explicitVariantId > NO_VARIANT_ID) {
            const [rows] = await connection.query(
                `SELECT id, price, stock FROM product_variants
                 WHERE id = ? AND product_id = ? AND is_active = 1 AND deleted_at IS NULL
                 LIMIT 1${rowLock}`,
                [explicitVariantId, productId],
            );

            return safeArray(rows)[0] || null;
        }

        const color = sanitizeString(item?.color);
        const size = sanitizeString(item?.size);

        if (!color && !size) {
            return null;
        }

        const conditions = [];
        const params = [productId];

        if (color) {
            conditions.push(
                "LOWER(JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.color'))) = LOWER(?)",
            );
            params.push(color);
        }

        if (size) {
            conditions.push(
                "LOWER(JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.size'))) = LOWER(?)",
            );
            params.push(size);
        }

        const [rows] = await connection.query(
            `SELECT id, price, stock FROM product_variants
             WHERE product_id = ? AND is_active = 1 AND deleted_at IS NULL
             AND ${conditions.join(" AND ")}
             LIMIT 2${rowLock}`,
            params,
        );

        const matches = safeArray(rows);

        return matches.length === 1 ? matches[0] : null;
    } catch (error) {
        logger.warn(
            `Variant lookup skipped for product ${productId}: ${error.message}`,
        );
        return null;
    }
};

/**
 * How many units a line can draw on, and which counter that figure came from.
 *
 * @returns {{ stock: number, variantId: number }}
 */
const resolveAvailableStock = (product, variant) => {
    if (variant) {
        return {
            stock: safeInteger(variant.stock),
            variantId: normalizeVariantId(variant.id),
        };
    }

    return {
        stock: safeInteger(product?.stock),
        variantId: NO_VARIANT_ID,
    };
};

/**
 * The sellable total across a product's variants, and how many there are.
 *
 * Only variants a shopper can actually select are counted. An inactive or
 * soft-deleted row may still carry a figure, but nothing can put it in a
 * basket, so including it would overstate what is on the shelf.
 *
 * @returns {Promise<{ variantCount: number, stock: number }>}
 */
const getVariantRollup = async (connection, productId) => {
    try {
        const [rows] = await connection.query(
            `SELECT COUNT(*) AS variant_count, COALESCE(SUM(stock), 0) AS variant_stock
             FROM product_variants
             WHERE product_id = ? AND is_active = 1 AND deleted_at IS NULL`,
            [productId],
        );

        const rollup = safeArray(rows)[0];

        return {
            variantCount: safeInteger(rollup?.variant_count),
            stock: safeInteger(rollup?.variant_stock),
        };
    } catch (error) {
        logger.warn(
            `Variant roll-up skipped for product ${productId}: ${error.message}`,
        );
        return { variantCount: 0, stock: 0 };
    }
};

/**
 * Take `quantity` off the authoritative counter for a line.
 *
 * The decrement is conditional on the counter still holding enough, so two
 * checkouts racing for the last unit cannot both win: the loser changes no rows
 * and gets `ok: false`. Reading a balance and writing back the difference would
 * put that race straight back.
 *
 * Returns rather than throws so the caller can name the line in the message the
 * shopper sees. Must be given the connection the order is running on: a stock
 * movement on a second connection commits independently of the order it belongs
 * to.
 *
 * @param {Object} connection - transactional connection
 * @param {{ productId: string, variantId?: number, quantity: number }} movement
 * @returns {Promise<{ ok: boolean, productId: string, variantId: number, quantity: number }>}
 */
const deductStock = async (connection, movement) => {
    const productId = movement?.productId;
    const variantId = normalizeVariantId(movement?.variantId);
    const quantity = Math.max(0, safeInteger(movement?.quantity));

    if (!productId || quantity === 0) {
        return { ok: true, productId, variantId, quantity };
    }

    if (variantId === NO_VARIANT_ID) {
        const [result] = await connection.query(
            `UPDATE products SET stock = stock - ?
             WHERE id = ? AND stock >= ?`,
            [quantity, productId, quantity],
        );

        return { ok: result.affectedRows > 0, productId, variantId, quantity };
    }

    const [result] = await connection.query(
        `UPDATE product_variants SET stock = stock - ?
         WHERE id = ? AND product_id = ? AND stock >= ?`,
        [quantity, variantId, productId, quantity],
    );

    if (result.affectedRows === 0) {
        return { ok: false, productId, variantId, quantity };
    }

    // The roll-up follows a sale the variant has already authorised, so it
    // clamps instead of refusing. An administrator can still write
    // `products.stock` directly, and a total that has drifted below the sum of
    // its variants must not veto a sale the authoritative counter allowed --
    // nor drive the column negative and fail the whole order on its CHECK.
    await connection.query(
        "UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?",
        [quantity, productId],
    );

    return { ok: true, productId, variantId, quantity };
};

/**
 * Put `quantity` back on the counter the sale took it from -- cancellation and
 * approved returns. Unconditional: goods coming back are not a request that can
 * be refused.
 *
 * @param {Object} connection - transactional connection
 * @param {{ productId: string, variantId?: number, quantity: number }} movement
 */
const restoreStock = async (connection, movement) => {
    const productId = movement?.productId;
    const variantId = normalizeVariantId(movement?.variantId);
    const quantity = Math.max(0, safeInteger(movement?.quantity));

    if (quantity === 0) {
        return { ok: true, productId, variantId, quantity };
    }

    if (variantId > NO_VARIANT_ID) {
        await connection.query(
            "UPDATE product_variants SET stock = stock + ? WHERE id = ?",
            [quantity, variantId],
        );
    }

    if (productId) {
        await connection.query(
            "UPDATE products SET stock = stock + ? WHERE id = ?",
            [quantity, productId],
        );
    }

    return { ok: true, productId, variantId, quantity };
};

module.exports = {
    NO_VARIANT_ID,
    resolveVariant,
    resolveAvailableStock,
    getVariantRollup,
    deductStock,
    restoreStock,
};
