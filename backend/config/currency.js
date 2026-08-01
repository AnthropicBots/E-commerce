// The one place the currency is declared. Display, invoicing and payment all
// read from here, which they did not before: the storefront showed ₹, invoices
// were printed with $, and payment intents were raised in USD for the same
// order.
//
// `minorUnitExponent` is what payment providers need to convert a decimal
// amount into the smallest unit. It is 2 for the rupee, but it is 0 for the yen
// and 3 for the dinar, so nothing may assume a factor of a hundred.
//
// Multi-currency checkout (#1392): settlement (charge) currency stays INR.
// Display `rate` = units of display currency per 1 INR (storefront convention).
// Extra catalog fields are attached to the same export object, then frozen.

const FALLBACK_RATES = Object.freeze({
    INR: 1.0,
    USD: 0.012,
    EUR: 0.011,
    GBP: 0.0094,
    JPY: 1.75
});

const SUPPORTED_CURRENCIES = Object.freeze({
    INR: Object.freeze({
        code: "INR",
        symbol: "₹",
        locale: "en-IN",
        minorUnitExponent: 2,
        name: "Indian Rupee"
    }),
    USD: Object.freeze({
        code: "USD",
        symbol: "$",
        locale: "en-US",
        minorUnitExponent: 2,
        name: "US Dollar"
    }),
    EUR: Object.freeze({
        code: "EUR",
        symbol: "€",
        locale: "de-DE",
        minorUnitExponent: 2,
        name: "Euro"
    }),
    GBP: Object.freeze({
        code: "GBP",
        symbol: "£",
        locale: "en-GB",
        minorUnitExponent: 2,
        name: "British Pound"
    }),
    JPY: Object.freeze({
        code: "JPY",
        symbol: "¥",
        locale: "ja-JP",
        minorUnitExponent: 0,
        name: "Japanese Yen"
    })
});

function isSupportedCurrency(code) {
    return Boolean(SUPPORTED_CURRENCIES[String(code || "").toUpperCase()]);
}

function getCurrencyMeta(code = "INR") {
    const key = String(code || "INR").toUpperCase();
    return SUPPORTED_CURRENCIES[key] || SUPPORTED_CURRENCIES.INR;
}

function getFallbackRate(displayCurrency) {
    const key = String(displayCurrency || "INR").toUpperCase();
    if (key === "INR") return 1;
    return FALLBACK_RATES[key] ?? null;
}

const CURRENCY = {
    code: "INR",
    symbol: "₹",
    minorUnitExponent: 2,
    locale: "en-IN",
    // catalog / helpers (#1392) — same module.exports identity for require()
    FALLBACK_RATES,
    SUPPORTED_CURRENCIES,
    SETTLEMENT_CURRENCY: null, // filled below
    isSupportedCurrency,
    getCurrencyMeta,
    getFallbackRate
};

CURRENCY.SETTLEMENT_CURRENCY = CURRENCY;
CURRENCY.CURRENCY = CURRENCY;

Object.freeze(CURRENCY);

module.exports = CURRENCY;
