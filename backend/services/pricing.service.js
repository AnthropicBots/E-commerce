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
 * Shipping due on a post-discount subtotal for a chosen delivery method.
 *
 * The charge is the rate the caller resolved for the chosen option. A waiver —
 * a rule the basket satisfies, or a `free_shipping` promo — covers
 * `waiverRate` of it and no more, which is what "free shipping" has always
 * meant here: the store absorbs the standard cost of delivery. A shopper who
 * has earned it and then upgrades to a faster option pays the difference
 * rather than nothing at all.
 *
 * Whether a waiver has been earned is the caller's to decide, because since
 * the rate rules landed the free-shipping threshold is a rule like any other
 * and can depend on more than basket value. A caller that expresses no opinion
 * gets the configured threshold instead, which reproduces the pre-#1430
 * figure exactly: nothing below it, free at or above it. That is what lets a
 * caller with no rules to hand keep pricing baskets the way it always has.
 *
 * An empty basket never attracts a shipping charge.
 *
 * @param {number} postDiscountSubtotal
 * @param {{ isShippingWaived?: boolean, isWaiverEarned?: boolean, methodRate?: number, waiverRate?: number }} [options]
 * @returns {number}
 */
const calculateShipping = (postDiscountSubtotal, options = {}) => {
    const base = Math.max(0, roundMoney(postDiscountSubtotal));

    if (base <= 0) {
        return 0;
    }

    const rate = Math.max(
        0,
        roundMoney(
            options.methodRate === undefined || options.methodRate === null
                ? PRICING_CONFIG.SHIPPING_FLAT_RATE
                : options.methodRate,
        ),
    );

    const isEarned =
        options.isWaiverEarned === undefined
            ? base >= PRICING_CONFIG.FREE_SHIPPING_THRESHOLD
            : Boolean(options.isWaiverEarned);

    if (!options.isShippingWaived && !isEarned) {
        return rate;
    }

    const waiver = Math.max(
        0,
        roundMoney(
            options.waiverRate === undefined || options.waiverRate === null
                ? PRICING_CONFIG.SHIPPING_FLAT_RATE
                : options.waiverRate,
        ),
    );

    return roundMoney(Math.max(0, rate - waiver));
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
 * @param {Object|null} [input.shippingMethod] - resolved delivery method,
 *        carrying the `rate` the rules produced for it, how much of that a
 *        waiver covers, and whether one was earned. Omitted, the flat rate and
 *        the configured threshold apply, which is what every caller got before
 *        there was a choice of delivery.
 * @returns {Object} breakdown
 */
const quote = ({
    items = [],
    promo = null,
    promoCode = null,
    shippingMethod = null,
} = {}) => {
    const { lines, subtotal } = priceLineItems(items);

    const discount = applyDiscount(promo, subtotal);
    const taxableBase = roundMoney(Math.max(0, subtotal - discount.amount));
    const tax = calculateTax(taxableBase);
    const shipping = calculateShipping(taxableBase, {
        isShippingWaived: discount.isShippingWaived,
        isWaiverEarned: shippingMethod?.isWaiverEarned,
        methodRate: shippingMethod?.rate,
        waiverRate: shippingMethod?.waiverRate,
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
        // What was charged for, alongside what it cost. An order that records
        // a figure without recording which option produced it cannot be
        // reconciled against fulfilment.
        shippingMethod: shippingMethod
            ? { code: shippingMethod.code, label: shippingMethod.label }
            : null,
        total: roundMoney(taxableBase + tax + shipping),
    };
};

/**
 * Check a client-submitted total against the engine's own figure.
 *
 * A total that arrives in a request body is a claim, not a value to trust, so
 * every order creation path runs it through here. Drift of up to one minor
 * unit is tolerated because a browser rounding at a different boundary can
 * legitimately land a paisa away; anything larger means the two sides do not
 * agree about the price and the order must not proceed.
 *
 * @param {any} claimedTotal - whatever the client sent
 * @param {number} computedTotal - the engine's total
 * @returns {{ isAcceptable: boolean, claimed: number|null, computed: number, difference: number|null, message: string|null }}
 */
const verifyClaimedTotal = (claimedTotal, computedTotal) => {
    const computed = roundMoney(computedTotal);
    const symbol = PRICING_CONFIG.CURRENCY.symbol;
    const parsed = parseFloat(claimedTotal);

    if (!Number.isFinite(parsed)) {
        return {
            isAcceptable: false,
            claimed: null,
            computed,
            difference: null,
            message:
                "Order total could not be verified: no usable total was " +
                `submitted, and this order prices at ${symbol}${computed.toFixed(2)}.`,
        };
    }

    const claimed = roundMoney(parsed);
    const difference = roundMoney(Math.abs(claimed - computed));

    if (difference > MINOR_UNIT) {
        return {
            isAcceptable: false,
            claimed,
            computed,
            difference,
            message:
                `Order total mismatch: submitted ${symbol}${claimed.toFixed(2)}, ` +
                `computed ${symbol}${computed.toFixed(2)}.`,
        };
    }

    return {
        isAcceptable: true,
        claimed,
        computed,
        difference,
        message: null,
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
    verifyClaimedTotal,
};
