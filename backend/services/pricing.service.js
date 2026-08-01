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
const crypto = require("crypto");

const { DISCOUNT_TYPES, ROUNDING } = PRICING_CONFIG;

const ROUNDING_FACTOR = 10 ** ROUNDING.DECIMAL_PLACES;

// The smallest representable money difference; used by callers that need to
// compare a claimed total against a computed one.
const MINOR_UNIT = 1 / ROUNDING_FACTOR;

const QUOTE_MISMATCH_CODE = "PRICING_QUOTE_MISMATCH";
const QUOTE_EXPIRED_CODE = "PRICING_QUOTE_EXPIRED";
const QUOTE_MISSING_CODE = "PRICING_QUOTE_MISSING";

const QUOTE_SECRET =
    process.env.PRICING_QUOTE_SECRET ||
    process.env.JWT_SECRET ||
    "pricing-quote-dev-secret";

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
        pricingVersion: PRICING_CONFIG.VERSION,
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

/**
 * Versioned rules document — the only place frontends may sync display hints (#1386).
 */
const getRulesDocument = () =>
    Object.freeze({
        version: PRICING_CONFIG.VERSION,
        currency: {
            code: PRICING_CONFIG.CURRENCY.code,
            symbol: PRICING_CONFIG.CURRENCY.symbol,
            locale: PRICING_CONFIG.CURRENCY.locale,
            minorUnitExponent: PRICING_CONFIG.CURRENCY.minorUnitExponent
        },
        applicationOrder: PRICING_CONFIG.APPLICATION_ORDER,
        taxRate: PRICING_CONFIG.TAX_RATE,
        shippingFlatRate: PRICING_CONFIG.SHIPPING_FLAT_RATE,
        freeShippingThreshold: PRICING_CONFIG.FREE_SHIPPING_THRESHOLD,
        taxableBase: PRICING_CONFIG.TAXABLE_BASE,
        shippingBase: PRICING_CONFIG.SHIPPING_BASE,
        rounding: PRICING_CONFIG.ROUNDING,
        quoteTtlSec: PRICING_CONFIG.QUOTE_TTL_SEC,
        authoritative: true,
        note:
            "Chargeable totals must come from /api/pricing/quote (or /api/checkout/quote). " +
            "Client-side PRICING constants are display hints only."
    });

/**
 * Stable fingerprint of basket lines so a quote cannot be reused on a different cart.
 */
const fingerprintItems = (items = []) => {
    const normalized = (Array.isArray(items) ? items : [])
        .map((item) => {
            const id = String(item.id ?? item.product_id ?? "");
            const qty = toQuantity(item.qty ?? item.quantity);
            const variant = String(item.variantId ?? item.variant_id ?? "");
            const color = String(item.color || "");
            const size = String(item.size || "");
            return `${id}:${qty}:${variant}:${color}:${size}`;
        })
        .filter((row) => !row.startsWith(":"))
        .sort();
    return crypto.createHash("sha256").update(normalized.join("|")).digest("hex");
};

function signPayload(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto
        .createHmac("sha256", QUOTE_SECRET)
        .update(body)
        .digest("base64url");
    return `${body}.${sig}`;
}

function verifySignedToken(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) {
        const err = new Error("Pricing quote token is required");
        err.status = 400;
        err.code = QUOTE_MISSING_CODE;
        throw err;
    }
    const [body, sig] = token.split(".");
    const expected = crypto
        .createHmac("sha256", QUOTE_SECRET)
        .update(body)
        .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        const err = new Error("Pricing quote signature is invalid");
        err.status = 400;
        err.code = QUOTE_MISMATCH_CODE;
        throw err;
    }
    try {
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch (_) {
        const err = new Error("Pricing quote token is malformed");
        err.status = 400;
        err.code = QUOTE_MISMATCH_CODE;
        throw err;
    }
}

/**
 * Attach a signed, TTL'd quote envelope to a breakdown (#1386).
 */
const createSignedQuote = (breakdown, { items = [], ttlSec = null } = {}) => {
    const now = Date.now();
    const ttl = Math.max(60, ttlSec || PRICING_CONFIG.QUOTE_TTL_SEC);
    const quoteId = crypto.randomUUID();
    const payload = {
        v: 1,
        quoteId,
        pricingVersion: PRICING_CONFIG.VERSION,
        itemFingerprint: fingerprintItems(items.length ? items : breakdown.lines || []),
        subtotal: breakdown.subtotal,
        discount: breakdown.discount,
        tax: breakdown.tax,
        shipping: breakdown.shipping,
        total: breakdown.total,
        promoCode: breakdown.promoCode || null,
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttl * 1000).toISOString()
    };
    const token = signPayload(payload);
    return {
        ...breakdown,
        quoteId,
        quoteToken: token,
        quote: {
            ...payload,
            ttlSec: ttl,
            token
        }
    };
};

/**
 * Validate a client-presented quote before order capture.
 * Recomputes nothing here — callers still re-price the basket and compare totals.
 */
const verifySignedQuote = (
    token,
    {
        quoteId = null,
        expectedTotal = null,
        items = null,
        pricingVersion = PRICING_CONFIG.VERSION
    } = {}
) => {
    const payload = verifySignedToken(token);

    if (payload.v !== 1) {
        const err = new Error("Unsupported pricing quote version");
        err.status = 400;
        err.code = QUOTE_MISMATCH_CODE;
        throw err;
    }

    if (quoteId && payload.quoteId !== quoteId) {
        const err = new Error("Pricing quote id does not match the signed token");
        err.status = 409;
        err.code = QUOTE_MISMATCH_CODE;
        throw err;
    }

    if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        const err = new Error(
            "Pricing quote has expired. Refresh the checkout summary and try again."
        );
        err.status = 409;
        err.code = QUOTE_EXPIRED_CODE;
        throw err;
    }

    if (payload.pricingVersion !== pricingVersion) {
        const err = new Error(
            "Pricing rules changed since this quote was issued. Refresh checkout."
        );
        err.status = 409;
        err.code = QUOTE_MISMATCH_CODE;
        throw err;
    }

    if (items) {
        const fp = fingerprintItems(items);
        if (fp !== payload.itemFingerprint) {
            const err = new Error(
                "Cart contents no longer match the signed pricing quote"
            );
            err.status = 409;
            err.code = QUOTE_MISMATCH_CODE;
            throw err;
        }
    }

    if (expectedTotal != null) {
        const verification = verifyClaimedTotal(expectedTotal, payload.total);
        if (!verification.isAcceptable) {
            const err = new Error(verification.message);
            err.status = 409;
            err.code = QUOTE_MISMATCH_CODE;
            err.submittedTotal = verification.claimed;
            err.computedTotal = verification.computed;
            throw err;
        }
    }

    return payload;
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
    QUOTE_MISMATCH_CODE,
    QUOTE_EXPIRED_CODE,
    QUOTE_MISSING_CODE,
    roundMoney,
    priceLineItems,
    applyDiscount,
    calculateTax,
    calculateShipping,
    quote,
    verifyClaimedTotal,
    getRulesDocument,
    fingerprintItems,
    createSignedQuote,
    verifySignedQuote,
};
