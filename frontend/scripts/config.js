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

const SUPPORTED_CURRENCIES = {
    INR: { CODE: "INR", SYMBOL: "₹", LOCALE: "en-IN", RATE: 1.0, NAME: "Indian Rupee" },
    USD: { CODE: "USD", SYMBOL: "$", LOCALE: "en-US", RATE: 0.012, NAME: "US Dollar" },
    EUR: { CODE: "EUR", SYMBOL: "€", LOCALE: "de-DE", RATE: 0.011, NAME: "Euro" },
    GBP: { CODE: "GBP", SYMBOL: "£", LOCALE: "en-GB", RATE: 0.0094, NAME: "British Pound" },
    JPY: { CODE: "JPY", SYMBOL: "¥", LOCALE: "ja-JP", RATE: 1.75, NAME: "Japanese Yen" }
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

    // multi-currency configuration
    CURRENCY_INFO,
    SUPPORTED_CURRENCIES,
    RATES_CACHE_EXPIRATION_MS: 3600000, // 1 hour expiration

    CURRENCY:
        CURRENCY_INFO.SYMBOL,

    // Feature flags (#1390) — hydrated at runtime via /api/flags/bootstrap
    // Object is mutable (CONFIG freeze is shallow) so bootstrap can fill keys.
    FLAGS: {
        new_checkout: false,
        ai_widgets: false
    },

    // Image CDN + responsive card defaults (#1388)
    // Set ENABLED=true and BASE_URL to your image CDN (Cloudinary/imgix/etc.).
    // When disabled, srcset still emits local URLs for future-proof markup.
    IMAGE_CDN: {
        ENABLED: false,
        BASE_URL: "",
        WIDTHS: [320, 480, 640, 800],
        CARD_WIDTH: 400,
        CARD_HEIGHT: 400,
        QUALITY: 75,
        SIZES: "(max-width: 600px) 50vw, (max-width: 1024px) 33vw, 280px"
    },

    // Display-only pricing hints (#1386). Chargeable totals MUST come from
    // /api/pricing/quote (signed). Do not submit locally recomputed totals.
    PRICING: {
        AUTHORITATIVE: false,
        VERSION: null,
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