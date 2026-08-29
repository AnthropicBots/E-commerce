const db = require("../config/db");
const { safeNumber, sanitizeString } = require("../utils/helpers");

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

        // Expiration check
        const expiryDate = coupon.expires_at || coupon.end_date || coupon.expiry_date || null;
        if (expiryDate && new Date(expiryDate) < new Date()) {
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
 * Increment coupon usage counter after an order is placed.
 *
 * @param {Object} connection - Database connection.
 * @param {string|number} couponId - Coupon ID.
 * @param {string} code - Coupon code.
 * @returns {Promise<void>}
 */
const recordCouponUsage = async (connection, couponId, code, isPromoTable = false) => {
    if (!connection) return;

    try {
        if (isPromoTable) {
            if (couponId) {
                await connection.query(
                    "UPDATE promo_codes SET usage_count = usage_count + 1 WHERE id = ?",
                    [couponId]
                );
            } else if (code) {
                await connection.query(
                    "UPDATE promo_codes SET usage_count = usage_count + 1 WHERE UPPER(code) = UPPER(?)",
                    [code]
                );
            }
            return;
        }

        if (couponId) {
            const [result] = await connection.query(
                "UPDATE coupons SET used_count = used_count + 1 WHERE id = ?",
                [couponId]
            );
            if (!result || result.affectedRows === 0) {
                await connection.query(
                    "UPDATE promo_codes SET usage_count = usage_count + 1 WHERE id = ?",
                    [couponId]
                );
            }
        } else if (code) {
            const [result] = await connection.query(
                "UPDATE coupons SET used_count = used_count + 1 WHERE UPPER(code) = UPPER(?)",
                [code]
            );
            if (!result || result.affectedRows === 0) {
                await connection.query(
                    "UPDATE promo_codes SET usage_count = usage_count + 1 WHERE UPPER(code) = UPPER(?)",
                    [code]
                );
            }
        }
    } catch (error) {
        console.error("RECORD COUPON USAGE ERROR:", error);
    }
};

module.exports = {
    validateCoupon,
    recordCouponUsage
};
