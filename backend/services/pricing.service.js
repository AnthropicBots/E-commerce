// The single owner of order pricing arithmetic.
//
// Everything here is pure: no database, no logger, no clock. Promo *validation*
// (is the code real, active, in date, above its minimum) still belongs to
// promo.service because it needs the database; this module only takes the
// already-validated promo descriptor and does the maths. That split is what
// makes the pricing rules testable on their own.
//
// Ordering, which the three previous pricing paths disagreed on, is resolved
// here as: discount first, then tax on the discounted base, then shipping from
// the discounted subtotal. That matches the figures the storefront has always
// shown shoppers, so moving ownership to the server does not silently change
// anyone's bill. pricingConfig.APPLICATION_ORDER records the decision and the
// tests pin it.
//
// Rounding happens at defined boundaries only — each line total, then each
// component — so that the per-line figures a customer sees always add up to
// the total that gets charged and recorded.

const PRICING_CONFIG = require("../config/pricingConfig");

const { DISCOUNT_TYPES, ROUNDING } = PRICING_CONFIG;

const ROUNDING_FACTOR = 10 ** ROUNDING.DECIMAL_PLACES;

// The smallest representable money difference; used by callers that need to
// compare a claimed total against a computed one.
const MINOR_UNIT = 1 / ROUNDING_FACTOR;

// helpers.js is not reused here because it pulls in third-party validation and
// crypto, which would give this module a dependency graph it does not need.
const toFiniteNumber = (value, fallback = 0) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toQuantity = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

/**
 * Round to the configured precision, half away from zero.
 *
 * Scaling by a power of ten lands values such as 1.005 on 100.49999999999999
 * in binary floating point, which a plain Math.round would send *down* and
 * break the reconciliation invariant. Nudging by one unit in the last place
 * before rounding keeps the half-up boundary honest.
 */
const roundMoney = (value) => {
    const amount = toFiniteNumber(value);
    const scaled = Math.abs(amount) * ROUNDING_FACTOR;
    const rounded = Math.round(scaled + Number.EPSILON * scaled) / ROUNDING_FACTOR;
    return amount < 0 ? -rounded : rounded;
};

/**
 * Price a set of line items.
 *
 * Each line is rounded on its own and the subtotal is the sum of those already
 * rounded figures, so a receipt printed from `lines` can never disagree with
 * `subtotal`.
 *
 * @param {Array<Object>} items - objects carrying at least a price and a quantity
 * @returns {{ lines: Array<Object>, subtotal: number }}
 */
const priceLineItems = (items) => {
    const lines = (Array.isArray(items) ? items : []).map((item) => {
        const source = item || {};
        // The unit price is multiplied out before it is rounded: rounding it
        // first would lose sub-minor-unit prices and hand the customer a line
        // total that does not match quantity times price.
        const unitPrice = toFiniteNumber(source.price ?? source.unitPrice);
        const quantity = toQuantity(source.qty ?? source.quantity);

        return {
            id: source.id ?? null,
            name: source.name ?? null,
            unitPrice,
            quantity,
            lineTotal: roundMoney(unitPrice * quantity),
        };
    });

    const subtotal = roundMoney(
        lines.reduce((sum, line) => sum + line.lineTotal, 0),
    );

    return { lines, subtotal };
};

/**
 * Apply an already-validated promo to a base amount.
 *
 * Percentage and fixed semantics mirror promo.service.calculateDiscount: a
 * percentage is capped by `maximum_discount` when one is set, and no discount
 * may exceed the base. `free_shipping`, which that function silently treated
 * as a fixed discount of its (zero) value, is handled explicitly here as a
 * shipping waiver.
 *
 * @param {Object|null} promo - validated promo descriptor
 * @param {number} baseAmount
 * @returns {{ amount: number, isShippingWaived: boolean }}
 */
const applyDiscount = (promo, baseAmount) => {
    const base = Math.max(0, roundMoney(baseAmount));

    if (!promo) {
        return { amount: 0, isShippingWaived: false };
    }

    const type = String(promo.discount_type ?? promo.discountType ?? "")
        .trim()
        .toLowerCase();

    if (type === DISCOUNT_TYPES.FREE_SHIPPING) {
        return { amount: 0, isShippingWaived: true };
    }

    const value = toFiniteNumber(promo.discount_value ?? promo.discountValue);
    let amount = type === DISCOUNT_TYPES.PERCENTAGE ? base * (value / 100) : value;

    const cap = toFiniteNumber(promo.maximum_discount ?? promo.maximumDiscount);
    if (type === DISCOUNT_TYPES.PERCENTAGE && cap > 0) {
        amount = Math.min(amount, cap);
    }

    amount = Math.min(Math.max(0, amount), base);

    return { amount: roundMoney(amount), isShippingWaived: false };
};

/**
 * Tax due on a taxable base.
 *
 * @param {number} taxableBase
 * @returns {number}
 */
const calculateTax = (taxableBase) =>
    roundMoney(Math.max(0, roundMoney(taxableBase)) * PRICING_CONFIG.TAX_RATE);

/**
 * Shipping due on a post-discount subtotal. An empty basket never attracts a
 * shipping charge, and a `free_shipping` promo waives it outright.
 *
 * @param {number} postDiscountSubtotal
 * @param {{ isShippingWaived?: boolean }} [options]
 * @returns {number}
 */
const calculateShipping = (postDiscountSubtotal, options = {}) => {
    const base = Math.max(0, roundMoney(postDiscountSubtotal));

    if (options.isShippingWaived || base <= 0) {
        return 0;
    }

    return base >= PRICING_CONFIG.FREE_SHIPPING_THRESHOLD
        ? 0
        : roundMoney(PRICING_CONFIG.SHIPPING_FLAT_RATE);
};

/**
 * Price a basket end to end and return the complete breakdown.
 *
 * The returned figures reconcile exactly: the line totals sum to `subtotal`,
 * and `subtotal - discount + tax + shipping` equals `total`.
 *
 * @param {Object} input
 * @param {Array<Object>} input.items
 * @param {Object|null} [input.promo] - validated promo descriptor, if any
 * @param {string|null} [input.promoCode] - code to echo back on the breakdown
 * @returns {Object} breakdown
 */
const quote = ({ items = [], promo = null, promoCode = null } = {}) => {
    const { lines, subtotal } = priceLineItems(items);

    const discount = applyDiscount(promo, subtotal);
    const taxableBase = roundMoney(Math.max(0, subtotal - discount.amount));
    const tax = calculateTax(taxableBase);
    const shipping = calculateShipping(taxableBase, {
        isShippingWaived: discount.isShippingWaived,
    });

    return {
        currency: PRICING_CONFIG.CURRENCY,
        appliedOrder: PRICING_CONFIG.APPLICATION_ORDER,
        lines,
        subtotal,
        discount: discount.amount,
        isShippingWaived: discount.isShippingWaived,
        promoCode: promoCode ?? promo?.code ?? null,
        taxableBase,
        tax,
        shipping,
        total: roundMoney(taxableBase + tax + shipping),
    };
};

module.exports = {
    MINOR_UNIT,
    roundMoney,
    priceLineItems,
    applyDiscount,
    calculateTax,
    calculateShipping,
    quote,
};
