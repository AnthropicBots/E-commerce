const db = require("../config/db");
const { safeNumber, sanitizeString } = require("../utils/helpers");

// Redemptions are counted from this table. It has existed since the baseline
// schema (migration 0001) and, until now, nothing in the codebase wrote to it.
const COUPON_USAGE_TABLE = "coupon_usage";

/**
 * Parse a date-ish column value without turning garbage into "now".
 *
 * MySQL hands back `Date` objects for DATETIME columns but strings for some
 * driver configurations, and a malformed value must not be treated as a
 * boundary that has already passed - that would reject a live coupon.
 *
 * @param {*} value - Raw column value.
 * @returns {Date|null} Parsed date, or null when unusable.
 */
const parseDate = (value) => {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Resolve the per-account redemption cap for a coupon row.
 *
 * The coupons table calls it `per_user_limit`; promo_codes rows use
 * `usage_limit_per_user`. A zero or negative cap is treated as "no cap" so a
 * mis-seeded row cannot lock every shopper out.
 *
 * @param {Object} coupon - Coupon or promo row.
 * @returns {number|null} Positive cap, or null when uncapped.
 */
const resolvePerUserLimit = (coupon) => {
    const raw = coupon.per_user_limit ?? coupon.usage_limit_per_user ?? coupon.per_user_usage_limit;

    if (raw === null || raw === undefined) {
        return null;
    }

    const limit = safeNumber(raw, 0);
    return limit > 0 ? limit : null;
};

/**
 * Normalise a user identifier to the CHAR(36) form the usage tables store.
 *
 * @param {string|number|null} userId - Caller-supplied identifier.
 * @returns {string|null} Trimmed identifier, or null when absent.
 */
const normalizeUserId = (userId) => {
    if (userId === null || userId === undefined) {
        return null;
    }

    const normalized = String(userId).trim();
    return normalized ? normalized : null;
};

/**
 * Count how many times one account has already redeemed a coupon.
 *
 * A missing ledger table must not block checkout, so a query failure is
 * reported as zero redemptions rather than propagating - the global
 * `usage_limit` still applies in that case.
 *
 * @param {Object} connection - Database connection or pool.
 * @param {string|number} couponId - Coupon identifier.
 * @param {string} userId - Account identifier.
 * @param {boolean} isPromoTable - Whether the code came from promo_codes.
 * @returns {Promise<number>} Redemptions already recorded.
 */
const countUserRedemptions = async (connection, couponId, userId, isPromoTable) => {
    if (!connection || !couponId || !userId) {
        return 0;
    }

    const table = isPromoTable ? "promo_usage" : COUPON_USAGE_TABLE;
    const idColumn = isPromoTable ? "promo_id" : "coupon_id";

    try {
        const [rows] = await connection.query(
            `SELECT COUNT(*) AS redemptions FROM ${table} WHERE ${idColumn} = ? AND user_id = ?`,
            [couponId, userId]
        );

        if (!rows || !rows.length) {
            return 0;
        }

        return safeNumber(rows[0].redemptions, 0);
    } catch (error) {
        console.error("COUNT COUPON REDEMPTIONS ERROR:", error);
        return 0;
    }
};

/**
 * Record one shopper's redemption of a coupon.
 *
 * Without this row `per_user_limit` is unenforceable, because there is nothing
 * for `countUserRedemptions` to count. Guests are skipped: the ledger's
 * user_id column is NOT NULL and a guest has no stable identity to cap.
 *
 * @param {Object} connection - Database connection or pool.
 * @param {Object} params - Redemption details.
 * @param {string|number} params.couponId - Coupon identifier.
 * @param {string|number|null} params.userId - Account identifier.
 * @param {string|number|null} params.orderId - Order the coupon was used on.
 * @param {number} params.discountAmount - Discount granted.
 * @returns {Promise<boolean>} Whether a ledger row was written.
 */
const recordUserCouponRedemption = async (connection, params = {}) => {
    const { couponId, userId, orderId, discountAmount } = params;
    const normalizedUserId = normalizeUserId(userId);

    if (!connection || !couponId || !normalizedUserId || !orderId) {
        return false;
    }

    try {
        await connection.query(
            `INSERT INTO ${COUPON_USAGE_TABLE} (coupon_id, user_id, order_id, discount_amount)
             VALUES (?, ?, ?, ?)`,
            [couponId, normalizedUserId, orderId, safeNumber(discountAmount, 0)]
        );
        return true;
    } catch (error) {
        // A failed audit write must never fail a paid order.
        console.error("RECORD COUPON REDEMPTION ERROR:", error);
        return false;
    }
};

/**
 * Validate a coupon code against the cart total and user context.
 *
 * @param {string} rawCode - Submitted coupon code.
 * @param {number} rawCartTotal - Subtotal of the cart.
 * @param {string|number|null} userId - ID of the calling user.
 * @param {Object} [connection=db] - Database connection or pool.
 * @returns {Promise<Object>} Validation result envelope.
 */
const validateCoupon = async (rawCode, rawCartTotal = 0, userId = null, connection = db) => {
    const code = sanitizeString(rawCode || "").trim();
    const cartTotal = safeNumber(rawCartTotal, 0);

    if (!code) {
        return {
            valid: false,
            message: "Coupon code is required"
        };
    }

    if (cartTotal <= 0) {
        return {
            valid: false,
            message: "Cart total must be greater than zero to apply a coupon"
        };
    }

    try {
        // Query coupons table first
        let coupon = null;
        let isPromoTable = false;

        const [rows] = await connection.query(
            "SELECT * FROM coupons WHERE UPPER(code) = UPPER(?) LIMIT 1",
            [code]
        );

        if (rows && rows.length > 0) {
            coupon = rows[0];
        } else {
            // Fallback lookup in promo_codes table
            const [promoRows] = await connection.query(
                "SELECT * FROM promo_codes WHERE UPPER(code) = UPPER(?) LIMIT 1",
                [code]
            );
            if (promoRows && promoRows.length > 0) {
                coupon = promoRows[0];
                isPromoTable = true;
            }
        }

        if (!coupon) {
            return {
                valid: false,
                code,
                message: "Invalid coupon code"
            };
        }

        // Active status check
        if (coupon.is_active === 0 || coupon.is_active === false) {
            return {
                valid: false,
                code,
                message: "Coupon code is inactive"
            };
        }

        // Soft-deleted coupons are gone as far as shoppers are concerned. The
        // baseline schema keeps the row for reporting, so the row still comes
        // back from the lookup above and has to be rejected here.
        if (coupon.deleted_at) {
            return {
                valid: false,
                code,
                message: "Invalid coupon code"
            };
        }

        const now = new Date();

        // A campaign that has not opened yet must not discount anything. The
        // column is named differently across the coupons and promo_codes
        // tables, so all three spellings are accepted.
        const startDate = coupon.start_date || coupon.starts_at || coupon.valid_from || null;
        const parsedStart = parseDate(startDate);
        if (parsedStart && parsedStart > now) {
            return {
                valid: false,
                code,
                message: "Coupon code is not active yet"
            };
        }

        // Expiration check
        const expiryDate = coupon.expires_at || coupon.end_date || coupon.expiry_date || null;
        const parsedExpiry = parseDate(expiryDate);
        if (parsedExpiry && parsedExpiry < now) {
            return {
                valid: false,
                code,
                message: "Coupon code has expired"
            };
        }

        // Usage limit check
        const usedCount = safeNumber(coupon.used_count ?? coupon.usage_count, 0);
        const usageLimit = coupon.usage_limit != null ? safeNumber(coupon.usage_limit) : null;
        if (usageLimit !== null && usedCount >= usageLimit) {
            return {
                valid: false,
                code,
                message: "Coupon code usage limit reached"
            };
        }

        // Per-user usage limit. `per_user_limit` has existed on the coupons
        // table since the baseline schema but nothing has ever read it, so a
        // "one per customer" coupon was in practice unlimited. Only enforceable
        // for a signed-in shopper - a guest has no identity to count against.
        const perUserLimit = resolvePerUserLimit(coupon);
        const normalizedUserId = normalizeUserId(userId);

        if (perUserLimit !== null && normalizedUserId) {
            const redemptions = await countUserRedemptions(
                connection,
                coupon.id,
                normalizedUserId,
                isPromoTable
            );

            if (redemptions >= perUserLimit) {
                return {
                    valid: false,
                    code,
                    message: perUserLimit === 1
                        ? "You have already used this coupon code"
                        : `This coupon code can only be used ${perUserLimit} times per account`
                };
            }
        }

        // Minimum order amount check
        const minOrder = safeNumber(coupon.minimum_order_amount, 0);
        if (minOrder > 0 && cartTotal < minOrder) {
            return {
                valid: false,
                code,
                message: `Minimum order total of ₹${minOrder} required to use this coupon`
            };
        }

        // Calculate discount amount
        const rawType = (coupon.type || coupon.discount_type || "percent").toLowerCase();
        const type = (rawType === "percentage" || rawType === "percent") ? "percent" : "fixed";
        const val = safeNumber(coupon.value ?? coupon.discount_value, 0);
        let discountAmount = 0;

        if (type === "percent") {
            discountAmount = (cartTotal * val) / 100;
            const maxDiscount = coupon.maximum_discount_amount ?? coupon.maximum_discount;
            if (maxDiscount != null && safeNumber(maxDiscount) > 0) {
                discountAmount = Math.min(discountAmount, safeNumber(maxDiscount));
            }
        } else {
            discountAmount = Math.min(val, cartTotal);
        }

        discountAmount = Number(Math.min(discountAmount, cartTotal).toFixed(2));
        const finalTotal = Number(Math.max(0, cartTotal - discountAmount).toFixed(2));

        return {
            valid: true,
            code: coupon.code,
            coupon: {
                id: coupon.id,
                code: coupon.code,
                type,
                value: val,
                discountAmount,
                finalTotal,
                perUserLimit,
                isPromoTable
            },
            message: `Coupon ${coupon.code} applied successfully`
        };
    } catch (error) {
        console.error("COUPON VALIDATION SERVICE ERROR:", error);
        return {
            valid: false,
            code,
            message: "An error occurred while validating the coupon code"
        };
    }
};

/**
 * Increment coupon usage counters after an order is placed.
 *
 * Bumps the global `used_count` and, when the caller supplies the redeeming
 * account, files the per-account ledger row that `per_user_limit` is checked
 * against. `options` is optional so existing three-argument callers keep
 * working unchanged.
 *
 * @param {Object} connection - Database connection.
 * @param {string|number} couponId - Coupon ID.
 * @param {string} code - Coupon code.
 * @param {Object} [options] - Redemption context.
 * @param {string|number|null} [options.userId] - Redeeming account.
 * @param {string|number|null} [options.orderId] - Order the coupon applied to.
 * @param {number} [options.discountAmount] - Discount granted.
 * @returns {Promise<void>}
 */
const recordCouponUsage = async (connection, couponId, code, options = {}) => {
    if (!connection) return;

    let resolvedId = couponId || null;

    try {
        if (resolvedId) {
            await connection.query(
                "UPDATE coupons SET used_count = used_count + 1 WHERE id = ?",
                [resolvedId]
            );
        } else if (code) {
            await connection.query(
                "UPDATE coupons SET used_count = used_count + 1 WHERE UPPER(code) = UPPER(?)",
                [code]
            );

            // The ledger is keyed by id, so resolve the code back to one.
            const [rows] = await connection.query(
                "SELECT id FROM coupons WHERE UPPER(code) = UPPER(?) LIMIT 1",
                [code]
            );

            if (rows && rows.length) {
                resolvedId = rows[0].id;
            }
        }
    } catch (error) {
        console.error("RECORD COUPON USAGE ERROR:", error);
        return;
    }

    await recordUserCouponRedemption(connection, {
        couponId: resolvedId,
        userId: options.userId,
        orderId: options.orderId,
        discountAmount: options.discountAmount
    });
};

module.exports = {
    validateCoupon,
    recordCouponUsage,
    recordUserCouponRedemption,
    countUserRedemptions,
    resolvePerUserLimit,
    parseDate
};
