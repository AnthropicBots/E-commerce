// notification helper
const notify = (
    message,
    type = "info"
) => {

    if (
        typeof window.showToast ===
        "function"
    ) {

        window.showToast(
            message,
            type
        );

        return;
    }

    console[
        type === "error"
            ? "error"
            : "log"
    ](message);

    if (
        type === "error"
    ) {

        alert(message);
    }
};

// escape html
const escapeHTML = (
    value
) => {

    return String(
        value || ""
    )

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );
};

// safe local storage helpers
const getJSON = (
    key,
    fallback = null
) => {

    try {

        const value =
            localStorage.getItem(
                key
            );

        return value
            ? JSON.parse(value)
            : fallback;

    } catch (error) {

        console.error(
            `getJSON error for key "${key}":`,
            error
        );

        return fallback;
    }
};

const setJSON = (
    key,
    value
) => {

    try {

        localStorage.setItem(
            key,
            JSON.stringify(value)
        );

        return true;

    } catch (error) {

        console.error(
            `setJSON error for key "${key}":`,
            error
        );

        return false;
    }
};

const removeStorage = (
    key
) => {

    try {

        localStorage.removeItem(
            key
        );

    } catch (error) {

        console.error(
            `removeStorage error for key "${key}":`,
            error
        );
    }
};

// auth helpers
const getToken = () => {

    return localStorage.getItem(
        CONFIG.STORAGE_KEYS.TOKEN
    );
};

const getRefreshToken = () => {

    return localStorage.getItem(
        CONFIG.STORAGE_KEYS.REFRESH_TOKEN
    );
};

const getUser = () => {

    return getJSON(
        CONFIG.STORAGE_KEYS.USER,
        null
    );
};

const clearAuthData = () => {

    removeStorage(
        CONFIG.STORAGE_KEYS.TOKEN
    );

    removeStorage(
        CONFIG.STORAGE_KEYS.REFRESH_TOKEN
    );

    removeStorage(
        CONFIG.STORAGE_KEYS.USER
    );

    // Signing out must not leave a cart attached to the browser, or the next
    // shopper on this machine inherits it.
    discardCartStorage();

    dispatchCartUpdated([]);
};

const requireAuth = () => {

    const token =
        getToken();

    const user =
        getUser();

    if (
        !token
        ||
        !user
    ) {

        notify(
            "Please sign in to continue",
            "error"
        );

        setTimeout(
            () => {

                window.location.href =
                    "signin.html";

            },
            800
        );

        return null;
    }

    return user;
};

// Endpoints that establish or renew a session themselves. A 401 from one of
// these is the answer, not a signal that the session needs renewing, so they are
// never retried behind a refresh.
const SESSION_ENDPOINTS = [
    "/auth/login",
    "/auth/signup",
    "/auth/verify-signup",
    "/auth/refresh-token",
    "/auth/forgot-password",
    "/auth/reset-password"
];

const isRenewable = (
    url
) => {

    return !SESSION_ENDPOINTS.some(
        (endpoint) => url.startsWith(endpoint)
    );
};

// The renewal currently in flight, if any, and whether the shopper has already
// been told their session ended.
let pendingRefresh = null;

let hasSignedOut = false;

// Ends the session once however many requests discovered it was over.
const signOutOnce = (
    message
) => {

    if (
        hasSignedOut
    ) {

        return;
    }

    hasSignedOut = true;

    clearAuthData();

    notify(
        message
        || "Session expired. Please login again.",
        "error"
    );

    setTimeout(
        () => {

            window.location.href =
                "signin.html";

        },
        1000
    );
};

// refresh token
const performRefresh =
    async () => {

        try {

            const refreshToken =
                getRefreshToken();

            if (
                !refreshToken
            ) {

                return null;
            }

            const response =
                await fetch(
                    `${CONFIG.API_BASE}/auth/refresh-token`,
                    {

                        method:
                            "POST",

                        headers: {

                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                refreshToken
                            })
                    }
                );

            const data =
                await response.json();

            // invalid refresh
            if (
                !response.ok
                ||
                !data.accessToken
            ) {

                return null;
            }

            // save tokens
            localStorage.setItem(
                CONFIG.STORAGE_KEYS.TOKEN,
                data.accessToken
            );

            if (
                data.refreshToken
            ) {

                localStorage.setItem(
                    CONFIG.STORAGE_KEYS.REFRESH_TOKEN,
                    data.refreshToken
                );
            }

            // save user
            if (
                data.user
            ) {

                setJSON(
                    CONFIG.STORAGE_KEYS.USER,
                    data.user
                );
            }

            return data.accessToken;

        } catch (error) {

            console.error(
                "TOKEN REFRESH ERROR:",
                error
            );

            return null;
        }
    };

// Requests that hit an expired session at the same moment share one renewal and
// then continue, rather than each starting their own and racing one another into
// a sign-out.
const refreshAccessToken = () => {

    if (
        !pendingRefresh
    ) {

        pendingRefresh =
            performRefresh().finally(
                () => {

                    pendingRefresh = null;
                }
            );
    }

    return pendingRefresh;
};

// api request
const apiRequest =
    async (
        url,
        options = {},
        retry = true
    ) => {

        const controller =
            new AbortController();

        let didTimeout = false;

        const timeoutId =
            setTimeout(
                () => {
                
                    didTimeout = true;
                
                    if (
                        !controller.signal.aborted
                    ) {
                    
                        controller.abort();
                    }
                
                },
                CONFIG.REQUEST_TIMEOUT || 45000
            );

        try {

            const token =
                getToken();

            const headers = {

                "Content-Type":
                    "application/json",

                ...(token
                    ? {
                        Authorization:
                            `Bearer ${token}`
                    }
                    : {}),

                ...(options.headers || {})
            };

            const response =
                await fetch(
                    `${CONFIG.API_BASE}${url}`,
                    {

                        ...options,

                        headers,

                        signal:
                            controller.signal
                    }
                );

            clearTimeout(
                timeoutId
            );

            // unauthorized
            if (
                response.status === 401
                &&
                retry
                &&
                isRenewable(url)
            ) {

                const newToken =
                    await refreshAccessToken();

                // Replayed with `retry` off, so a request is only ever tried a
                // second time -- never a third.
                if (
                    newToken
                ) {

                    return apiRequest(
                        url,
                        options,
                        false
                    );
                }

                signOutOnce();

                return {

                    success: false,

                    message:
                        "Unauthorized"
                };
            }

            // safe json parse
            let data = {};

            try {

                data =
                    await response.json();

            } catch {

                data = {

                    success: false,

                    message:
                        "Invalid server response"
                };
            }

            if (
                !response.ok
            ) {

                const failure =
                    new Error(
                        data.message
                        ||
                        `Request failed (${response.status})`
                    );

                // Carried through the catch below so callers can branch on a
                // specific server-side condition instead of matching on text.
                failure.status =
                    response.status;

                failure.code =
                    data.code;

                throw failure;
            }

            return data;

        } catch (error) {

            clearTimeout(
                timeoutId
            );

            console.error(
                `API REQUEST ERROR (${url}):`,
                error
            );

            // network errors
            if (
                error.name ===
                "AbortError"
            ) {
            
                if (didTimeout) {
                
                    console.warn(
                        `REQUEST TIMEOUT: ${url}`
                    );
                
                    return {
                    
                        success: false,
                    
                        timeout: true,
                    
                        message:
                            "Server is waking up. Please wait a few seconds and refresh."
                    };
                }
            
                return {
                
                    success: false,
                
                    message:
                        "Request was cancelled"
                };
            }

            return {

                success: false,

                status:
                    error.status,

                code:
                    error.code,

                message:
                    error.message
                    || "Request failed"
            };
        }
    };

// dom helpers
const $ = (
    selector,
    scope = document
) => {

    return scope.querySelector(
        selector
    );
};

const $$ = (
    selector,
    scope = document
) => {

    return scope.querySelectorAll(
        selector
    );
};

// price formatter
//
// Pass the currency descriptor from a server breakdown to render an amount in
// the currency it was actually priced in; without one the local configuration
const CURRENCY_STORAGE_KEY = "activeCurrency";

const getSelectedCurrency = () => {
    return localStorage.getItem(CURRENCY_STORAGE_KEY) || CONFIG.CURRENCY_INFO.CODE;
};

const getCurrencyInfo = (code = getSelectedCurrency()) => {
    return (CONFIG.SUPPORTED_CURRENCIES && CONFIG.SUPPORTED_CURRENCIES[code]) || CONFIG.CURRENCY_INFO;
};

const setSelectedCurrency = (code) => {
    if (!CONFIG.SUPPORTED_CURRENCIES || !CONFIG.SUPPORTED_CURRENCIES[code]) return;
    localStorage.setItem(CURRENCY_STORAGE_KEY, code);
    window.dispatchEvent(new CustomEvent("currencyUpdated", { detail: { currency: code } }));
};

const formatPrice = (price, overrideCurrency = null) => {
    const numericPrice = parseFloat(price || 0);
    const currCode = typeof overrideCurrency === "string" 
        ? overrideCurrency 
        : (overrideCurrency && overrideCurrency.CODE ? overrideCurrency.CODE : getSelectedCurrency());
    const info = getCurrencyInfo(currCode);
    const convertedAmount = numericPrice * (info.RATE || 1.0);

    try {
        return new Intl.NumberFormat(info.LOCALE || "en-US", {
            style: "currency",
            currency: info.CODE || "USD",
            minimumFractionDigits: info.MINOR_UNIT_EXPONENT !== undefined ? info.MINOR_UNIT_EXPONENT : 2
        }).format(convertedAmount);
    } catch (e) {
        return `${info.SYMBOL || "$"}${convertedAmount.toFixed(2)}`;
    }
};

const initCurrencySelector = () => {
    const selector = document.getElementById("currency-selector");
    if (selector) {
        selector.value = getSelectedCurrency();
        if (!selector.dataset.currencyBound) {
            selector.dataset.currencyBound = "true";
            selector.addEventListener("change", (e) => {
                setSelectedCurrency(e.target.value);
            });
        }
    }
};

// ==================== FEATURE FLAGS (#1390) ====================

const applyFeatureFlags = (flags = {}) => {
    if (!CONFIG.FLAGS || typeof CONFIG.FLAGS !== "object") {
        CONFIG.FLAGS = {};
    }
    Object.keys(flags || {}).forEach((key) => {
        CONFIG.FLAGS[key] = Boolean(flags[key]);
    });
    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent("featureFlagsUpdated", {
                detail: { flags: { ...CONFIG.FLAGS } }
            })
        );
    }
    return CONFIG.FLAGS;
};

const bootstrapFeatureFlags = async () => {
    try {
        const user = typeof getUser === "function" ? getUser() : null;
        const qs =
            user && user.id
                ? `?userId=${encodeURIComponent(user.id)}`
                : "";
        const response = await apiRequest(`/flags/bootstrap${qs}`, {
            method: "GET"
        });
        if (response && response.success && response.flags) {
            return applyFeatureFlags(response.flags);
        }
    } catch (error) {
        console.warn(
            "Feature flag bootstrap failed:",
            error.message || error
        );
    }
    return CONFIG.FLAGS || {};
};

const isFeatureEnabled = (flagKey, defaultValue = false) => {
    if (!flagKey || !CONFIG.FLAGS) return Boolean(defaultValue);
    if (Object.prototype.hasOwnProperty.call(CONFIG.FLAGS, flagKey)) {
        return Boolean(CONFIG.FLAGS[flagKey]);
    }
    return Boolean(defaultValue);
};

const whenFeatureEnabled = (flagKey, fn, fallback = undefined) => {
    if (!isFeatureEnabled(flagKey)) {
        return typeof fallback === "function" ? fallback() : fallback;
    }
    return typeof fn === "function" ? fn() : fn;
};

const applyFeatureFlagDom = (root = document) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("[data-feature-flag]").forEach((el) => {
        const key = el.getAttribute("data-feature-flag");
        const enabled = isFeatureEnabled(key, false);
        el.hidden = !enabled;
        el.style.display = enabled ? "" : "none";
    });
};

if (typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", initCurrencySelector);
    window.addEventListener("componentsLoaded", initCurrencySelector);
    window.addEventListener("DOMContentLoaded", () => {
        bootstrapFeatureFlags().then(() => applyFeatureFlagDom());
        // Sync display pricing hints from canonical rules (#1386)
        apiRequest("/pricing/rules", { method: "GET" })
            .then((res) => {
                if (res && res.success && res.rules && CONFIG.PRICING) {
                    CONFIG.PRICING.VERSION = res.rules.version;
                    CONFIG.PRICING.TAX_RATE = res.rules.taxRate;
                    CONFIG.PRICING.SHIPPING_FEE = res.rules.shippingFlatRate;
                    CONFIG.PRICING.FREE_SHIPPING_THRESHOLD =
                        res.rules.freeShippingThreshold;
                }
            })
            .catch(() => {});
    });
    window.addEventListener("featureFlagsUpdated", () => applyFeatureFlagDom());
}

// image fallback constants & handlers
const FALLBACK_PRODUCT_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%23f3f4f6'/%3E%3Cg fill='%239ca3af' text-anchor='middle'%3E%3Cpath d='M160 140c0-11 9-20 20-20s20 9 20 20-9 20-20 20-20-9-20-20zm80 80H160l25-33 15 20 30-40 40 53z'/%3E%3Cpath d='M130 110h140c11 0 20 9 20 20v140c0 11-9 20-20 20H130c-11 0-20-9-20-20V130c0-11 9-20 20-20zm0 160h140V130H130v140z'/%3E%3Ctext x='200' y='310' font-family='sans-serif' font-size='16' font-weight='500'%3ENo Image Available%3C/text%3E%3C/g%3E%3C/svg%3E";

const handleImageError = (img) => {
    if (!img || img.dataset.fallbackApplied === "true") return;
    img.dataset.fallbackApplied = "true";
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.src = FALLBACK_PRODUCT_IMAGE;
};

const defaultImage = (
    url
) => {

    return (
        url
        &&
        typeof url === "string"
        &&
        url.trim()
    )
        ? url
        : FALLBACK_PRODUCT_IMAGE;
};

/**
 * Image CDN + responsive srcset helpers (#1388).
 * When CONFIG.IMAGE_CDN.ENABLED, rewrites through BASE_URL with width params.
 */
const resolveCdnImageUrl = (src, width = null) => {
    const base = defaultImage(src);
    if (!base || base.startsWith("data:")) return base;

    const cdn = (CONFIG && CONFIG.IMAGE_CDN) || {};
    if (!cdn.ENABLED || !cdn.BASE_URL) {
        return base;
    }

    try {
        const abs =
            base.startsWith("http://") || base.startsWith("https://")
                ? base
                : new URL(base, window.location.origin).href;
        const endpoint = String(cdn.BASE_URL).replace(/\/$/, "");
        const params = new URLSearchParams({
            url: abs,
            q: String(cdn.QUALITY || 75),
            fit: "cover"
        });
        if (width) params.set("w", String(width));
        return `${endpoint}?${params.toString()}`;
    } catch (_) {
        return base;
    }
};

const buildProductSrcset = (src) => {
    const cdn = (CONFIG && CONFIG.IMAGE_CDN) || {};
    const widths = Array.isArray(cdn.WIDTHS) && cdn.WIDTHS.length
        ? cdn.WIDTHS
        : [320, 480, 640, 800];

    return widths
        .map((w) => `${resolveCdnImageUrl(src, w)} ${w}w`)
        .join(", ");
};

/**
 * Stable product-card <img> markup — width/height + lazy + srcset for CLS/LCP.
 */
const buildProductCardImageHtml = (src, alt = "Product", options = {}) => {
    const cdn = (CONFIG && CONFIG.IMAGE_CDN) || {};
    const width = options.width || cdn.CARD_WIDTH || 400;
    const height = options.height || cdn.CARD_HEIGHT || 400;
    const lazy = options.lazy !== false;
    const sizes =
        options.sizes ||
        cdn.SIZES ||
        "(max-width: 600px) 50vw, (max-width: 1024px) 33vw, 280px";
    const safeAlt =
        typeof escapeHTML === "function"
            ? escapeHTML(alt || "Product image")
            : String(alt || "Product").replace(/"/g, "&quot;");
    const primary = resolveCdnImageUrl(src, width);
    const useSrcset = Boolean(cdn.ENABLED && cdn.BASE_URL);
    const srcset = useSrcset ? buildProductSrcset(src) : "";

    return `<img
        src="${primary}"
        ${useSrcset ? `srcset="${srcset}" sizes="${sizes}"` : ""}
        width="${width}"
        height="${height}"
        alt="${safeAlt}"
        ${lazy ? 'loading="lazy"' : 'fetchpriority="high"'}
        decoding="async"
        onerror="typeof handleImageError === 'function' && handleImageError(this)"
    >`;
};

// safe array
const safeArray = (
    value
) => {

    return Array.isArray(
        value
    )
        ? value
        : [];
};

// safe number
const safeNumber = (
    value,
    fallback = 0
) => {

    const parsed =
        Number(value);

    return Number.isFinite(
        parsed
    )
        ? parsed
        : fallback;
};

// safe integer
const safeInteger = (
    value,
    fallback = 0
) => {

    const parseIntValue =
        parseInt(
            value,
            10
        );

    return Number.isInteger(
        parseIntValue
    )
        ? parseIntValue
        : fallback;
};

// safe foreach
const safeForEach = (
    arr,
    callback
) => {

    safeArray(arr)
        .forEach(
            callback
        );
};

// safe map
const safeMap = (
    arr,
    callback
) => {

    return safeArray(
        arr
    ).map(
        callback
    );
};

// debounce
const debounce = (
    callback,
    delay = 300
) => {

    let timeoutId;

    return (
        ...args
    ) => {

        clearTimeout(
            timeoutId
        );

        timeoutId =
            setTimeout(
                () => {

                    callback(
                        ...args
                    );

                },
                delay
            );
    };
};

// throttle
const throttle = (
    callback,
    limit = 300
) => {

    let waiting =
        false;

    return (
        ...args
    ) => {

        if (
            waiting
        ) {

            return;
        }

        callback(
            ...args
        );

        waiting =
            true;

        setTimeout(
            () => {

                waiting =
                    false;

                },
            limit
        );
    };
};

// cart helpers
const CART_UPDATED_EVENT =
    "cartUpdated";

// The stored cart is an envelope rather than a bare array because it has to be
// possible to tell a genuine guest cart apart from a stale mirror of an account
// cart and from another account's leftovers.
const CART_SCHEMA_VERSION = 2;

// Not a valid user id, so it can never collide with one.
const GUEST_CART_OWNER =
    "guest";

const CART_SYNC_DEBOUNCE_MS = 600;

// The envelope this tab last wrote, used to arbitrate against another tab's
// write by timestamp.
let lastWrittenCart = null;

// The last cart the server confirmed, and therefore what a rejected change is
// rolled back to.
let serverAcknowledgedItems = null;

const isAuthenticated = () =>
    Boolean(getToken() && getUser());

const getCartOwner = () => {

    const user =
        getUser();

    return (
        getToken()
        &&
        user
        &&
        user.id !== undefined
        &&
        user.id !== null
    )
        ? String(user.id)
        : GUEST_CART_OWNER;
};

const dispatchCartUpdated = (
    cart
) => {

    window.dispatchEvent(
        new CustomEvent(
            CART_UPDATED_EVENT,
            {
                detail: {
                    cart
                }
            }
        )
    );
};

const discardCartStorage = () => {

    removeStorage(
        CONFIG.STORAGE_KEYS.CART
    );

    lastWrittenCart = null;

    serverAcknowledgedItems = null;
};

const normalizeCartItem = (
    item
) => {

    if (
        !item
        ||
        typeof item !== "object"
        ||
        item.id === undefined
        ||
        item.id === null
    ) {

        return null;
    }

    const price =
        safeNumber(
            item.price,
            0
        );

    const qty =
        Math.max(
            1,
            safeInteger(
                item.qty,
                1
            )
        );

    const variantId =
        safeInteger(
            item.variantId
            ?? item.variant_id,
            0
        );

    return {
        ...item,
        id: item.id,
        name:
            item.name || "Product",
        price,
        img:
            item.img ||
            item.image ||
            "",
        image:
            item.image ||
            item.img ||
            "",
        color:
            item.color || null,
        size:
            item.size || null,
        variantId:
            variantId > 0
                ? variantId
                : null,
        qty
    };
};

// Reads the stored envelope, or a payload handed in from a `storage` event.
// Returns null when there is nothing usable there.
const readCartEnvelope = (
    rawValue
) => {

    const isStoredRead =
        rawValue === undefined;

    let stored = null;

    try {

        const value =
            isStoredRead
                ? localStorage.getItem(
                    CONFIG.STORAGE_KEYS.CART
                )
                : rawValue;

        stored =
            value
                ? JSON.parse(value)
                : null;

    } catch (error) {

        console.warn(
            `Unreadable cart payload for key "${CONFIG.STORAGE_KEYS.CART}":`,
            error
        );

        if (
            isStoredRead
        ) {

            discardCartStorage();
        }

        return null;
    }

    // A bare array is the pre-envelope payload. It carries no owner, so the
    // only safe reading of it is "guest cart" — which keeps a returning
    // shopper's cart instead of dropping it the day this ships.
    const isLegacyPayload =
        Array.isArray(
            stored
        );

    if (
        !isLegacyPayload
        &&
        (
            !stored
            ||
            !Array.isArray(
                stored.items
            )
        )
    ) {

        if (
            isStoredRead
            &&
            stored
        ) {

            discardCartStorage();
        }

        return null;
    }

    const items =
        (
            isLegacyPayload
                ? stored
                : stored.items
        )
            .map(
                normalizeCartItem
            )
            .filter(
                Boolean
            );

    return {
        version:
            isLegacyPayload
                ? CART_SCHEMA_VERSION
                : safeInteger(
                    stored.version,
                    CART_SCHEMA_VERSION
                ),

        owner:
            isLegacyPayload
                ? GUEST_CART_OWNER
                : String(
                    stored.owner
                    || GUEST_CART_OWNER
                ),

        updatedAt:
            isLegacyPayload
                ? 0
                : safeNumber(
                    stored.updatedAt,
                    0
                ),

        guestCartMerged:
            !isLegacyPayload
            &&
            Boolean(
                stored.guestCartMerged
            ),

        items
    };
};

const CART_BROADCAST_CHANNEL = 'ecommerce_cart_channel';
let cartChannel = null;

try {
    if (typeof BroadcastChannel !== 'undefined') {
        cartChannel = new BroadcastChannel(CART_BROADCAST_CHANNEL);
        cartChannel.onmessage = (event) => {
            if (event && event.data && event.data.type === 'CART_SYNC_BROADCAST') {
                const currentOwner = getCartOwner();
                if (event.data.owner === currentOwner) {
                    const updatedCart = getCart();
                    dispatchCartUpdated(updatedCart);
                }
            }
        };
    }
} catch (err) {
    console.warn('BroadcastChannel initialization error:', err);
}

// Cross-Tab Storage Event Fallback for older browsers
window.addEventListener('storage', (event) => {
    if (event.key === CONFIG.STORAGE_KEYS.CART) {
        const updatedCart = getCart();
        dispatchCartUpdated(updatedCart);
    }
});

const writeCartEnvelope = (
    envelope
) => {

    const saved =
        setJSON(
            CONFIG.STORAGE_KEYS.CART,
            envelope
        );

    if (
        saved
    ) {

        lastWrittenCart = envelope;

        if (cartChannel) {
            try {
                cartChannel.postMessage({
                    type: 'CART_SYNC_BROADCAST',
                    owner: envelope.owner,
                    timestamp: envelope.updatedAt || Date.now()
                });
            } catch (e) {
                // Ignore broadcast post failures
            }
        }
    }

    return saved;
};

const getCart = () => {

    const envelope =
        readCartEnvelope();

    if (
        !envelope
    ) {

        return [];
    }

    if (
        envelope.owner ===
        getCartOwner()
    ) {

        return envelope.items;
    }

    // A guest cart seen by a signed-in shopper is material for the sign-in
    // merge, not this account's cart.
    if (
        envelope.owner ===
        GUEST_CART_OWNER
    ) {

        return [];
    }

    // The cart belongs to a different account, or to an account nobody is
    // signed into any more. Discarding it is the point: merging it would hand
    // one shopper's basket to another.
    discardCartStorage();

    return [];
};

// Items from a guest cart that a signed-in shopper brought with them, waiting
// to be folded into the account exactly once.
const getGuestCartCandidates = () => {

    const envelope =
        readCartEnvelope();

    return (
        envelope
        &&
        envelope.owner ===
        GUEST_CART_OWNER
    )
        ? envelope.items
        : [];
};

const saveCart = (
    cart,
    {
        sync = true,
        guestCartMerged = false
    } = {}
) => {

    const normalizedCart =
        safeArray(cart)
            .map(
                normalizeCartItem
            )
            .filter(
                Boolean
            );

    const previous =
        readCartEnvelope();

    const owner =
        getCartOwner();

    const saved =
        writeCartEnvelope({
            version:
                CART_SCHEMA_VERSION,

            owner,

            updatedAt:
                Date.now(),

            // The merge flag belongs to the account, so it only carries over a
            // write by that same account.
            guestCartMerged:
                guestCartMerged
                ||
                Boolean(
                    previous
                    &&
                    previous.owner === owner
                    &&
                    previous.guestCartMerged
                ),

            items:
                normalizedCart
        });

    if (
        saved
    ) {

        dispatchCartUpdated(
            normalizedCart
        );
    }

    // Signed-in users: mirror every mutation to the persistent backend cart.
    // `sync: false` is used when the local mirror is being hydrated FROM the
    // backend, or when the caller pushes the change itself, to avoid an echo
    // write.
    if (sync && isAuthenticated()) {
        syncCartWithBackend(normalizedCart);
    }

    return normalizedCart;
};

// A line is the product plus the variant the shopper chose, matching what the
// backend stores. Colour and size are compared case-insensitively so one choice
// spelled two ways stays one line.
const getCartItemKey = (
    item
) => {

    return [
        String(
            item?.id
        ),
        String(
            safeInteger(
                item?.variantId,
                0
            )
        ),
        String(
            item?.color || ""
        ).toLowerCase(),
        String(
            item?.size || ""
        ).toLowerCase()
    ].join("|");
};

const addCartItem = async (
    product
) => {

    const item =
        normalizeCartItem({
            ...product,
            qty:
                product?.qty || 1
        });

    if (
        !item
    ) {

        return getCart();
    }

    const previousCart =
        getCart();

    const cart =
        previousCart.map(
            (cartItem) => ({
                ...cartItem
            })
        );

    const existing =
        cart.find(
            (cartItem) =>
                getCartItemKey(
                    cartItem
                ) ===
                getCartItemKey(
                    item
                )
        );

    if (
        existing
    ) {

        existing.qty +=
            item.qty;

    } else {

        cart.push(
            item
        );
    }

    // Guests have nothing to reserve against, so the local write is the whole
    // operation.
    if (
        !isAuthenticated()
    ) {

        return saveCart(
            cart
        );
    }

    // /cart/add is the only endpoint that creates the 15-minute inventory lock
    // the checkout flow later validates, so an add has to route through it. The
    // local write is not pushed separately because this request carries it.
    const saved =
        saveCart(
            cart,
            { sync: false }
        );

    let response = null;

    try {

        response =
            await apiRequest(
                "/cart/add",
                {
                    method: "POST",
                    body: JSON.stringify({
                        productId: item.id,
                        variantId: item.variantId,
                        color: item.color,
                        size: item.size,
                        quantity: item.qty,
                        admitToken: item.admitToken || undefined
                    })
                }
            );

    } catch (error) {

        console.warn(
            "Cart reservation failed:",
            error
        );
    }

    if (
        response
        &&
        response.success
    ) {

        serverAcknowledgedItems = saved;

        return saved;
    }

    // The account does not hold this line, so the browser must stop pretending
    // it does.
    notify(
        (
            response
            &&
            response.message
        )
        || "Could not add that to your cart. Please try again.",
        "error"
    );

    return saveCart(
        previousCart,
        { sync: false }
    );
};

const updateCartItemQty = (
    index,
    qty
) => {

    const cart =
        getCart();

    if (
        !cart[index]
    ) {

        return cart;
    }

    cart[index].qty =
        Math.max(
            1,
            safeInteger(
                qty,
                1
            )
        );

    return saveCart(
        cart
    );
};

const removeCartItem = (
    index
) => {

    const cart =
        getCart();

    if (
        cart[index]
    ) {

        cart.splice(
            index,
            1
        );
    }

    return saveCart(
        cart
    );
};

const clearCart = () => {

    return saveCart(
        []
    );
};

// ---------- Backend cart integration (authenticated users) ----------
// Guests keep using localStorage only. For signed-in users every cart mutation
// is mirrored to the persistent backend cart (/api/cart) so carts survive
// across devices/sessions and the inventory-reservation workflow is exercised.
// The account is the authority: a change the server refuses does not survive
// locally.

// Real lines, one per variant choice. Flattening colour and size away here is
// what used to make the shopper's choice vanish on the round trip and left
// stock reserved against the product instead of the variant.
const cartLinesForBackend = (cart) =>
    safeArray(cart)
        .map(normalizeCartItem)
        .filter(Boolean)
        .map((item) => ({
            productId: item.id,
            variantId: item.variantId,
            color: item.color,
            size: item.size,
            qty: item.qty
        }));

const OFFLINE_CART_QUEUE_KEY = "offline_cart_queue";

const getOfflineCartQueue = () => getJSON(OFFLINE_CART_QUEUE_KEY, []);
const saveOfflineCartQueue = (queue) => setJSON(OFFLINE_CART_QUEUE_KEY, queue);

const enqueueOfflineCartMutation = (cart) => {
    const queue = getOfflineCartQueue();
    queue.push({
        cart: cartLinesForBackend(cart),
        timestamp: Date.now()
    });
    saveOfflineCartQueue(queue);
};

const processOfflineCartQueue = async () => {
    if (!navigator.onLine || !isAuthenticated()) return;
    const queue = getOfflineCartQueue();
    if (!queue.length) return;

    saveOfflineCartQueue([]);

    try {
        const currentCart = getCart();
        const synced = await pushCartToBackend(currentCart);
        if (synced) {
            notify("Reconnected: Cart synced to your account", "info");
        }
    } catch (error) {
        console.warn("Failed to sync offline cart queue:", error);
    }
};

window.addEventListener("online", () => {
    processOfflineCartQueue();
    const currentCart = getCart();
    dispatchCartUpdated(currentCart);
});

// Push the whole cart and report whether the account accepted it. /cart/sync is
// replace-all, so this reconciles the server with the local cart after any
// mutation — including bulk edits made through saveCart directly.
const pushCartToBackend = async (cart) => {
    if (!navigator.onLine) {
        enqueueOfflineCartMutation(cart);
        notify("Network offline. Cart saved locally and queued for background sync.", "warning");
        return true;
    }

    let response = null;

    try {
        response = await apiRequest("/cart/sync", {
            method: "POST",
            body: JSON.stringify({
                owner: getCartOwner(),
                items: cartLinesForBackend(cart)
            })
        });
    } catch (error) {
        console.warn("Cart backend sync failed:", error);
        enqueueOfflineCartMutation(cart);
    }

    if (response && response.success) {
        serverAcknowledgedItems = cart;
        return true;
    }

    notify(
        (response && response.message)
        || "Your cart could not be saved to your account.",
        "error"
    );

    if (serverAcknowledgedItems) {
        saveCart(serverAcknowledgedItems, { sync: false });
    }

    return false;
};

// Debounced so a run of quantity edits costs one request rather than one per
// keystroke. The returned promise settles once that request has been answered,
// so a caller that needs to know the outcome can wait for it.
let pendingCartSync = null;

const syncCartWithBackend = (cart) => {
    if (!isAuthenticated()) {
        return Promise.resolve(false);
    }

    if (pendingCartSync) {
        clearTimeout(pendingCartSync.timeoutId);
    } else {
        let settle;

        pendingCartSync = {
            promise: new Promise((resolve) => {
                settle = resolve;
            }),
            settle
        };
    }

    const scheduled = pendingCartSync;

    scheduled.timeoutId = setTimeout(() => {
        pendingCartSync = null;

        pushCartToBackend(cart).then(scheduled.settle);
    }, CART_SYNC_DEBOUNCE_MS);

    return scheduled.promise;
};

// Combining two carts is the only place quantities are summed, and only for
// lines that are genuinely the same line.
const mergeCartLines = (accountCart, guestCart) => {
    const merged = safeArray(accountCart)
        .map(normalizeCartItem)
        .filter(Boolean);

    safeArray(guestCart)
        .map(normalizeCartItem)
        .filter(Boolean)
        .forEach((item) => {
            const existing = merged.find(
                (candidate) =>
                    getCartItemKey(candidate) === getCartItemKey(item)
            );

            if (existing) {
                existing.qty += item.qty;
            } else {
                merged.push(item);
            }
        });

    return merged;
};

// `retry` is disabled on the fetch so an expired session never force-redirects
// a browsing user off a public page; a real mutation will trigger the normal
// refresh/redirect flow instead. Returns null when the cart could not be read,
// which is not the same answer as an empty cart.
const fetchServerCart = async () => {
    try {
        const data = await apiRequest("/cart", {}, false);

        if (data && data.success) {
            return safeArray(data.cart)
                .map(normalizeCartItem)
                .filter(Boolean);
        }
    } catch (error) {
        console.warn("Failed to load backend cart:", error);
    }

    return null;
};

// Page-load lifecycle: the account cart REPLACES the local mirror. Nothing is
// merged here — merging what is only a mirror of the same cart is what made
// carts inflate on their own with nobody touching them.
const hydrateCartFromServer = async () => {
    if (!isAuthenticated()) {
        return getCart();
    }

    const serverCart = await fetchServerCart();

    if (!serverCart) {
        return getCart();
    }

    serverAcknowledgedItems = serverCart;

    return saveCart(serverCart, { sync: false });
};

// Sign-in lifecycle: fold a guest cart into the account cart. This is the one
// deliberate combine, and the envelope records that it happened so a reload
// cannot repeat it.
const mergeGuestCartIntoAccount = async () => {
    if (!isAuthenticated()) {
        return getCart();
    }

    const envelope = readCartEnvelope();
    const alreadyMerged =
        envelope
        && envelope.owner === getCartOwner()
        && envelope.guestCartMerged;

    const guestCart = getGuestCartCandidates();

    if (alreadyMerged || !guestCart.length) {
        return hydrateCartFromServer();
    }

    const serverCart = await fetchServerCart();

    // Without the account cart there is nothing sound to merge into, so the
    // guest cart stays a guest cart and the next sign-in can try again.
    if (!serverCart) {
        return getCart();
    }

    serverAcknowledgedItems = serverCart;

    const merged = mergeCartLines(serverCart, guestCart);

    saveCart(merged, { sync: false, guestCartMerged: true });

    // Pushed directly rather than through the debounce: this is a one-shot step
    // and the shopper is waiting on its outcome.
    const accepted = await pushCartToBackend(merged);

    return accepted ? merged : getCart();
};

const getCartCount = (
    cart = getCart()
) => {

    return safeArray(
        cart
    ).reduce(
        (
            sum,
            item
        ) =>
            sum +
            Math.max(
                1,
                safeInteger(
                    item.qty,
                    1
                )
            ),
        0
    );
};

// Coupon validation is server-authoritative: the browser no longer knows which
// codes exist or what they're worth. It POSTs the code + current cart total to
// /promo/validate and maps the response onto the legacy { valid, code, percent,
// message } shape callers already understand. Any failure (network, timeout,
// unknown code, rate limit) resolves to a safe invalid result rather than
// throwing, so a broken promo endpoint never blocks checkout.
const validateCoupon = async (
    code,
    cartTotal = 0
) => {
    const normalizedCode = String(code || "").trim().toUpperCase();

    if (!normalizedCode) {
        return {
            valid: false,
            code: "",
            percent: 0,
            message: "Enter a coupon code."
        };
    }

    const safeCartTotal = safeNumber(cartTotal, 0);

    try {
        const response = await apiRequest("/promo/validate", {
            method: "POST",
            body: JSON.stringify({
                promoCode: normalizedCode,
                cartTotal: safeCartTotal
            })
        });

        const promo = response && response.success ? response.data : null;

        if (!promo || !promo.valid) {
            return {
                valid: false,
                code: normalizedCode,
                percent: 0,
                message:
                    (response && response.message) || "Invalid coupon code."
            };
        }

        // Express the server's discount as a percent of the submitted cart
        // total so percentage- and fixed-amount promos both flow through the
        // existing percent-based math. discountType/discountValue are stable
        // promo attributes (unlike the response's cartTotal-derived `discount`,
        // which the backend caches by code only), so this stays correct across
        // cart edits.
        const percent =
            promo.discountType === "fixed"
                ? (safeCartTotal > 0
                    ? (safeNumber(promo.discountValue, 0) / safeCartTotal) * 100
                    : 0)
                : safeNumber(promo.discountValue, 0);

        const resolvedCode = promo.promoCode || normalizedCode;

        return {
            valid: true,
            code: resolvedCode,
            percent,
            message: `${resolvedCode} applied successfully.`
        };
    } catch (error) {
        console.error("COUPON VALIDATION ERROR:", error);

        return {
            valid: false,
            code: normalizedCode,
            percent: 0,
            message: "Could not validate coupon. Please try again."
        };
    }
};

const calculateCartTotals = async (
    cart = getCart(),
    couponCode = ""
) => {
    const subtotal = safeArray(cart).reduce(
        (sum, item) =>
            sum +
            safeNumber(item.price, 0) *
                Math.max(1, safeInteger(item.qty, 1)),
        0
    );

    // Skip the round-trip when there's nothing to validate; an empty code is
    // never a coupon.
    const coupon = couponCode
        ? await validateCoupon(couponCode, subtotal)
        : null;

    const discount =
        coupon && coupon.valid ? subtotal * (coupon.percent / 100) : 0;

    const discountedSubtotal = Math.max(0, subtotal - discount);

    const tax = discountedSubtotal * CONFIG.PRICING.TAX_RATE;

    const shipping =
        discountedSubtotal > 0 &&
        discountedSubtotal < CONFIG.PRICING.FREE_SHIPPING_THRESHOLD
            ? CONFIG.PRICING.SHIPPING_FEE
            : 0;

    const total = discountedSubtotal + tax + shipping;

    return {
        subtotal,
        coupon: coupon && coupon.valid ? coupon : null,
        discount,
        tax,
        shipping,
        total
    };
};

// Ask the server what this basket costs. The server owns the tax, shipping and
// discount rules and prices from its own product records, so what comes back
// here is what checkout will charge.
//
// calculateCartTotals stays as the fallback: if the quote cannot be fetched the
// shopper still sees a plausible summary rather than a blank or zeroed one, and
// `isServerQuote` tells callers which of the two they are looking at.
const fetchCartQuote = async (
    cart = getCart(),
    couponCode = ""
) => {
    const items = safeArray(cart).map(
        (item) => ({
            id: item.id,
            qty: Math.max(1, safeInteger(item.qty, 1)),
            variantId: item.variantId || item.variant_id || null,
            color: item.color || "",
            size: item.size || ""
        })
    );

    const displayCurrency = getSelectedCurrency();

    try {
        // Canonical price engine (#1386) — /pricing/quote is authoritative
        const response = await apiRequest("/pricing/quote", {
            method: "POST",
            body: JSON.stringify({
                items,
                promoCode: couponCode || null,
                currency: displayCurrency,
                lockFx: true
            })
        });

        if (!response || !response.success || !response.breakdown) {
            throw new Error(
                (response && response.message) || "Quote unavailable"
            );
        }

        // Sync display hints from the signed quote's pricing version
        if (response.pricingVersion && CONFIG.PRICING) {
            CONFIG.PRICING.VERSION = response.pricingVersion;
        }

        return {
            ...response.breakdown,
            promoMessage: response.promoMessage || null,
            isServerQuote: true,
            displayCurrency: response.displayCurrency || displayCurrency,
            fx: response.fx || null,
            fxLock: response.fxLock || null,
            quoteId: response.quoteId || response.breakdown.quoteId || null,
            quoteToken:
                response.quoteToken ||
                response.breakdown.quoteToken ||
                (response.quote && response.quote.token) ||
                null,
            quote: response.quote || response.breakdown.quote || null,
            pricingVersion: response.pricingVersion || null
        };
    } catch (error) {
        console.error("CART QUOTE ERROR:", error);

        const fallback = await calculateCartTotals(cart, couponCode);

        return {
            ...fallback,
            isServerQuote: false,
            displayCurrency,
            fx: null,
            fxLock: null,
            quoteId: null,
            quoteToken: null,
            quote: null,
            pricingVersion: null
        };
    }
};

const getWishlist = () => {

    return getJSON(
        CONFIG.STORAGE_KEYS.WISHLIST,
        []
    );
};

const saveWishlist = (
    wishlist
) => {

    setJSON(
        CONFIG.STORAGE_KEYS.WISHLIST,
        safeArray(wishlist)
    );
}; // Fixed: Added missing closing bracket here

const getSkeletonCardHTML = (count = 4) => {
    let html = "";
    for (let i = 0; i < count; i++) {
        html += `
            <div class="pro skeleton-wrapper">
                <div class="skeleton skeleton-img"></div>
                <div class="des">
                    <div class="skeleton skeleton-text short"></div>
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text short"></div>
                    <div class="skeleton skeleton-text price"></div>
                </div>
            </div>
        `;
    }
    return html;
};

const renderSkeletonState = (container, count = 4) => {
    if (!container) return;
    container.innerHTML = getSkeletonCardHTML(count);
};

// app utils assignment
window.AppUtils = {
    CONFIG,
    notify,
    escapeHTML,
    getJSON,
    setJSON,
    removeStorage,
    getToken,
    getRefreshToken,
    getUser,
    clearAuthData,
    requireAuth,
    refreshAccessToken,
    apiRequest,
    $,
    $$,
    formatPrice,
    getSelectedCurrency,
    getCurrencyInfo,
    setSelectedCurrency,
    initCurrencySelector,
    bootstrapFeatureFlags,
    applyFeatureFlags,
    isFeatureEnabled,
    whenFeatureEnabled,
    applyFeatureFlagDom,
    defaultImage,
    resolveCdnImageUrl,
    buildProductSrcset,
    buildProductCardImageHtml,
    safeArray,
    safeNumber,
    safeInteger,
    safeForEach,
    safeMap,
    debounce,
    throttle,
    CART_UPDATED_EVENT,
    normalizeCartItem,
    getCart,
    saveCart,
    getCartItemKey,
    addCartItem,
    updateCartItemQty,
    removeCartItem,
    clearCart,
    getCartCount,
    isAuthenticated,
    syncCartWithBackend,
    mergeCartLines,
    hydrateCartFromServer,
    mergeGuestCartIntoAccount,
    validateCoupon,
    calculateCartTotals,
    fetchCartQuote,
    getWishlist,
    saveWishlist,
    getSkeletonCardHTML,
    renderSkeletonState,
    FALLBACK_PRODUCT_IMAGE,
    handleImageError
};

// backward compatibility assignments
window.API_BASE = CONFIG.API_BASE;
window.notify = notify;
window.getJSON = getJSON;
window.setJSON = setJSON;
window.getSkeletonCardHTML = getSkeletonCardHTML;
window.renderSkeletonState = renderSkeletonState;
window.apiRequest = apiRequest;
window.$ = $;
window.$$ = $$;
window.formatPrice = formatPrice;
window.requireAuth = requireAuth;
window.defaultImage = defaultImage;
window.FALLBACK_PRODUCT_IMAGE = FALLBACK_PRODUCT_IMAGE;
window.handleImageError = handleImageError;
window.safeForEach = safeForEach;
window.safeMap = safeMap;

// Side-by-side tabs converge instead of competing: whichever envelope carries
// the later timestamp is the one that stands, and everything listening on
// CART_UPDATED_EVENT re-reads it.
window.addEventListener("storage", (event) => {
    if (event.key !== CONFIG.STORAGE_KEYS.CART) {
        return;
    }

    const incoming = readCartEnvelope(event.newValue);

    if (!incoming) {
        // Another tab dropped the mirror, typically by signing out.
        lastWrittenCart = null;
    } else if (lastWrittenCart && lastWrittenCart.updatedAt > incoming.updatedAt) {
        // This tab holds the newer state. It is written back with its original
        // timestamp so the other tab adopts it and the exchange settles.
        writeCartEnvelope(lastWrittenCart);
    }

    dispatchCartUpdated(getCart());
});

// Hydrate the persistent backend cart for already–signed-in users on load, so
// a cart created on another device/session follows them here. Combining a guest
// cart into the account is a separate, deliberate step that belongs to sign-in.
if (getToken() && getUser()) {
    hydrateCartFromServer().catch((error) => {
        console.warn("Initial cart hydration failed:", error);
    });
}
