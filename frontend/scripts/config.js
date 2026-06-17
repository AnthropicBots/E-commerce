// environment detection
const hostname =
    window.location.hostname;

const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.");

const CONFIG = {
    // api base url
    API_BASE: isLocalhost
        ? "http://localhost:5000/api"
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
    CURRENCY:
        "₹",

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