// Declarative source of truth for how delivery options are resolved.
//
// The options themselves live in `shipping_methods`, because adding one is an
// operational decision rather than a deployment. What lives here is the
// handful of settings the resolution *code* needs: which code is the fallback
// when the table cannot be read, and how long a read of it may be reused.
//
// The fallback matters more than it looks. Checkout must not fail because a
// reference table is briefly unavailable or because a deployment has not run
// the migration yet, and the shape it falls back to has to charge exactly what
// this store charged before delivery options existed -- otherwise an outage
// silently changes what people pay.

const PRICING_CONFIG = require("./pricingConfig");

const SHIPPING_CONFIG = Object.freeze({
    // The option a checkout gets when it does not choose one, and the option
    // whose rate a free-shipping entitlement covers.
    DEFAULT_METHOD_CODE: "standard",

    // Delivery options change on the scale of campaigns, not requests, so they
    // are read once and reused. Short enough that an operator changing a rate
    // sees it take effect without a restart.
    CACHE_TTL_MS: Number(process.env.SHIPPING_METHOD_CACHE_TTL_MS) || 60_000,

    // Used only when `shipping_methods` cannot be read. The rate is the flat
    // rate the pricing engine has always applied, so a store running on the
    // fallback charges what it charged before this existed.
    FALLBACK_METHOD: Object.freeze({
        code: "standard",
        label: "Standard delivery",
        description: "Arrives in three to six days.",
        rate: PRICING_CONFIG.SHIPPING_FLAT_RATE,
        isDefault: true,
        sortOrder: 10,
    }),
});

module.exports = SHIPPING_CONFIG;
