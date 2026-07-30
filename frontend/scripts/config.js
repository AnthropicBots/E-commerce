// environment detection
const hostname =
    window.location.hostname;

const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.");

// Mirrors backend/config/currency.js. The minor-unit exponent is here so that
// anything converting to the smallest unit does not assume a factor of a
// hundred, and the locale so amounts can be formatted for the right region.
const CURRENCY_INFO = {
    CODE: "INR",
    SYMBOL: "₹",
    MINOR_UNIT_EXPONENT: 2,
    LOCALE: "en-IN"
};

const CONFIG = {
    // api base url
    API_BASE: isLocalhost
        ? `http://${window.location.hostname}:5000/api`
        : "https://e-commerce-production-d546.up.railway.app/api",
    // app info
    APP_NAME:
        "AnthropicBots E-Commerce",

    APP_VERSION:
        "2.0.0",

    // request settings
    REQUEST_TIMEOUT:
        45000,

    // pagination
    PRODUCTS_PER_PAGE:
        8,

    // currency
    CURRENCY_INFO,

    // Kept as a bare symbol string: existing scripts interpolate CONFIG.CURRENCY
    // directly.
    CURRENCY:
        CURRENCY_INFO.SYMBOL,

    // pricing rules (single source of truth for cart math)
    PRICING: {
        TAX_RATE: 0.18,
        SHIPPING_FEE: 49,
        FREE_SHIPPING_THRESHOLD: 999
    },

    // storage keys
    STORAGE_KEYS: {
        CART:
            "cart",

        WISHLIST:
            "wishlist",

        TOKEN:
            "token",

        REFRESH_TOKEN:
            "refreshToken",

        USER:
            "user",

        RECENTLY_VIEWED:
            "recentlyViewed"
    }
};

// freeze config
Object.freeze(
    CONFIG
);

Object.freeze(
    CONFIG.STORAGE_KEYS
);

Object.freeze(
    CONFIG.PRICING
);

Object.freeze(
    CONFIG.CURRENCY_INFO
);

// expose globally
window.CONFIG =
    CONFIG;

// debug info
if (
    isLocalhost
) {
    console.log(
        `%c${CONFIG.APP_NAME} v${CONFIG.APP_VERSION}`,
        "color:#088178;font-weight:bold;"
    );

    console.log(
        "API BASE:",
        CONFIG.API_BASE
    );
}