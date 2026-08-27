'use strict';

/**
 * Records the redemption of a discount code against the ledger that actually
 * owns it.
 *
 * A discount code can resolve from either of two independent tables:
 *
 *   - `coupons`      + its `coupon_usage` ledger
 *   - `promo_codes`  + its `promo_usage` ledger
 *
 * Both use `INT AUTO_INCREMENT` primary keys starting at 1, so their id spaces
 * overlap completely and an id is meaningless without knowing which table it
 * came from. Writing usage without that discriminator increments a row in the
 * wrong table - consuming the budget of a campaign that was never redeemed.
 *
 * This module is the single place that decides which ledger a redemption
 * belongs to, so the routing is testable in isolation from order creation.
 */

const logger = require('../utils/logger');
const { safeNumber, safeUUID } = require('../utils/helpers');

const SOURCE_COUPONS = 'coupons';
const SOURCE_PROMO_CODES = 'promo_codes';

/**
 * Decide which table a validated discount came from.
 *
 * `couponService.validateCoupon()` reports this directly via `isPromoTable`.
 * A promo resolved through the legacy `validatePromo()` path carries no such
 * flag, so the caller states the source explicitly and this function only
 * falls back to inference when neither is available.
 *
 * @param {Object|null} promo - The validated discount object.
 * @param {string|null} [declaredSource] - Source the caller already knows.
 * @returns {string|null} One of the SOURCE_* constants, or null when unknown.
 */
function resolveDiscountSource(promo, declaredSource = null) {
    if (declaredSource === SOURCE_COUPONS || declaredSource === SOURCE_PROMO_CODES) {
        return declaredSource;
    }

    if (!promo || typeof promo !== 'object') {
        return null;
    }

    if (promo.isPromoTable === true) {
        return SOURCE_PROMO_CODES;
    }

    if (promo.isPromoTable === false) {
        return SOURCE_COUPONS;
    }

    // Columns that exist on promo_codes rows and never on coupons rows.
    if (promo.discount_type !== undefined || promo.discount_value !== undefined) {
        return SOURCE_PROMO_CODES;
    }

    return null;
}

/**
 * Increment the global counter and file the per-account row for a promo_codes
 * redemption.
 *
 * Neither write may fail an order that has already been paid for, so both are
 * logged and swallowed.
 *
 * @param {Object} connection - Database connection.
 * @param {Object} params - Redemption details.
 * @returns {Promise<void>}
 */
async function recordPromoCodeUsage(connection, params) {
    const { promoId, userId, orderId, discountAmount } = params;

    if (!promoId) {
        return;
    }

    try {
        await connection.query(
            'UPDATE promo_codes SET usage_count = usage_count + 1 WHERE id = ?',
            [promoId]
        );
    } catch (error) {
        logger.error(`Failed to increment promo_codes usage for ${promoId}: ${error.message}`);
    }

    if (!userId) {
        return;
    }

    try {
        await connection.query(
            'INSERT INTO promo_usage (promo_id, user_id, order_id, discount_amount, status) VALUES (?, ?, ?, ?, \'applied\')',
            [promoId, safeUUID(userId), orderId, safeNumber(discountAmount, 0)]
        );
        logger.info(`Recorded promo usage for user ${userId} and promo ${promoId}`);
    } catch (error) {
        logger.error(`Failed to record promo_usage for promo ${promoId}: ${error.message}`);
    }
}

/**
 * Record a redemption against whichever ledger owns the code.
 *
 * @param {Object} connection - Database connection.
 * @param {Object} params - Redemption details.
 * @param {Object|null} params.promo - The validated discount object.
 * @param {string|null} [params.source] - Known source table, if any.
 * @param {string|number|null} params.discountId - Id of the redeemed row.
 * @param {string|null} params.discountCode - Code that was redeemed.
 * @param {string|number|null} params.userId - Redeeming account, if signed in.
 * @param {string|null} params.orderId - Order the discount applied to.
 * @param {number} params.discountAmount - Discount granted.
 * @returns {Promise<string|null>} The source that was written to, or null.
 */
async function recordDiscountUsage(connection, params = {}) {
    const {
        promo = null,
        source = null,
        discountId = null,
        discountCode = null,
        userId = null,
        orderId = null,
        discountAmount = 0
    } = params;

    if (!connection || (!discountId && !discountCode)) {
        return null;
    }

    const resolved = resolveDiscountSource(promo, source);

    if (resolved === SOURCE_PROMO_CODES) {
        await recordPromoCodeUsage(connection, {
            promoId: discountId,
            userId,
            orderId,
            discountAmount
        });
        return SOURCE_PROMO_CODES;
    }

    if (resolved === SOURCE_COUPONS) {
        // couponService owns the coupons + coupon_usage writes.
        const couponService = require('./couponService');
        await couponService.recordCouponUsage(connection, discountId, discountCode, {
            userId,
            orderId,
            discountAmount
        });
        return SOURCE_COUPONS;
    }

    // An unattributable code is left alone rather than guessed at. Writing to
    // the wrong ledger is worse than not writing at all: it silently burns
    // another campaign's budget, and there is no signal that it happened.
    logger.warn(
        `Discount "${discountCode || discountId}" could not be attributed to a source table; usage not recorded`
    );
    return null;
}

module.exports = {
    SOURCE_COUPONS,
    SOURCE_PROMO_CODES,
    resolveDiscountSource,
    recordDiscountUsage,
    recordPromoCodeUsage
};
