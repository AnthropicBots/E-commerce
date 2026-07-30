// Declarative source of truth for order pricing: the tax rule, the shipping
// rule, how money is rounded, and — critically — the order in which discount,
// tax and shipping are applied.
//
// The ordering is a named value rather than an implicit consequence of the
// order of statements in the engine, because the three pricing paths that
// existed before this config disagreed on it (the storefront taxed the
// discounted subtotal, the checkout route subtracted the discount after tax).
// Making it data means a change of policy is a change of this file, and the
// tests that pin the ordering fail loudly if the engine stops honouring it.

const APPLICATION_ORDER = Object.freeze(["discount", "tax", "shipping"]);

const DISCOUNT_TYPES = Object.freeze({
    PERCENTAGE: "percentage",
    FIXED: "fixed",
    FREE_SHIPPING: "free_shipping",
});

const ROUNDING = Object.freeze({
    DECIMAL_PLACES: 2,
    // Half-up (away from zero on the .5 boundary) is what shoppers see on
    // every other retail surface, and it is what the pre-existing toFixed(2)
    // calls approximated.
    MODE: "half-up",
});

const CURRENCY = Object.freeze({
    code: "INR",
    symbol: "₹",
});

const PRICING_CONFIG = Object.freeze({
    CURRENCY,
    APPLICATION_ORDER,
    DISCOUNT_TYPES,
    ROUNDING,

    TAX_RATE: 0.18,
    SHIPPING_FLAT_RATE: 49,
    // At or above this post-discount subtotal shipping is free.
    FREE_SHIPPING_THRESHOLD: 999,

    // Both the tax and the shipping rule read the subtotal *after* the
    // discount has come off. Named so the engine cannot silently switch base
    // without this file changing too.
    TAXABLE_BASE: "post_discount_subtotal",
    SHIPPING_BASE: "post_discount_subtotal",
});

module.exports = PRICING_CONFIG;
