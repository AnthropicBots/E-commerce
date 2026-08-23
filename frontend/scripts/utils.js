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

// The basket of a shopper with no account lives on the server like anyone
// else's; this is the only thing that reaches it. It is sent on every request
// rather than only on cart calls, because the endpoints that will later accept
// a guest basket are not all under /cart.
const CART_TOKEN_HEADER = "X-Cart-Token";

const getCartToken = () => {

    return localStorage.getItem(
        CONFIG.STORAGE_KEYS.CART_TOKEN
    );
};

// The server returns a token only when it has just minted one, which it does
// when the request presented no usable token. So whatever comes back is the
// token that reaches the basket the request actually wrote to, and it replaces
// whatever was held before.
const rememberCartToken = (
    data
) => {

    if (
        !data
        ||
        typeof data.cartToken !== "string"
    ) {

        return;
    }

    try {

        localStorage.setItem(
            CONFIG.STORAGE_KEYS.CART_TOKEN,
            data.cartToken
        );

    } catch (error) {

        console.error(
            "Cart token storage error:",
            error
        );
    }
};

// A cart that became an order is closed, so the token that reached it no
// longer reaches anything. Dropping it means the next basket starts clean
// rather than on the back of a request the server has to refuse first.
const clearCartToken = () => {

    try {

        localStorage.removeItem(
            CONFIG.STORAGE_KEYS.CART_TOKEN
        );

    } catch (error) {

        console.error(
            "Cart token storage error:",
            error
        );
    }
};

// Reading back an order that no account owns takes the order number and the
// email it was placed with. Both are held in session storage rather than put
// in the URL of the confirmation page: the email is half of what authorises
// the lookup, and a URL ends up in history, in referrers and in access logs.
// Session storage is also scoped to the tab, so it goes when the tab does.
const GUEST_ORDER_KEY = "guestOrder";

const rememberGuestOrder = (
    orderNumber,
    email
) => {

    if (
        !orderNumber
        ||
        !email
    ) {

        return;
    }

    try {

        sessionStorage.setItem(
            GUEST_ORDER_KEY,
            JSON.stringify({
                orderNumber,
                email
            })
        );

    } catch (error) {

        console.error(
            "Guest order storage error:",
            error
        );
    }
};

const readGuestOrder = () => {

    try {

        const stored =
            JSON.parse(
                sessionStorage.getItem(
                    GUEST_ORDER_KEY
                )
                ||
                "null"
            );

        return stored
            &&
            stored.orderNumber
            &&
            stored.email
            ? stored
            : null;

    } catch (error) {

        console.error(
            "Guest order storage error:",
            error
        );

        return null;
    }
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

            const cartToken =
                getCartToken();

            const headers = {

                "Content-Type":
                    "application/json",

                ...(token
                    ? {
                        Authorization:
                            `Bearer ${token}`
                    }
                    : {}),

                ...(cartToken
                    ? {
                        [CART_TOKEN_HEADER]:
                            cartToken
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

            rememberCartToken(
                data
            );

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

if (typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", initCurrencySelector);
    window.addEventListener("componentsLoaded", initCurrencySelector);
}

// image fallback constants & handlers
const FALLBACK_PRODUCT_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%23f3f4f6'/%3E%3Cg fill='%239ca3af' text-anchor='middle'%3E%3Cpath d='M160 140c0-11 9-20 20-20s20 9 20 20-9 20-20 20-20-9-20-20zm80 80H160l25-33 15 20 30-40 40 53z'/%3E%3Cpath d='M130 110h140c11 0 20 9 20 20v140c0 11-9 20-20 20H130c-11 0-20-9-20-20V130c0-11 9-20 20-20zm0 160h140V130H130v140z'/%3E%3Ctext x='200' y='310' font-family='sans-serif' font-size='16' font-weight='500'%3ENo Image Available%3C/text%3E%3C/g%3E%3C/svg%3E";

const handleImageError = (img) => {
    if (!img || img.dataset.fallbackApplied === "true") return;
    img.dataset.fallbackApplied = "true";
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

const saveCart = (
    cart,
    {
        sync = true
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

    const owner =
        getCartOwner();

    const saved =
        writeCartEnvelope({
            version:
                CART_SCHEMA_VERSION,

            owner,

            updatedAt:
                Date.now(),

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

    // /cart/add is the only endpoint that creates the 15-minute inventory lock
    // the checkout flow later validates, so an add has to route through it. The
    // local write is not pushed separately because this request carries it.
    //
    // A guest goes the same way. There is no reservation to take against an
    // account that does not exist, but the line still has to reach the stored
    // basket, and this is the request that puts it there.
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
                        quantity: item.qty
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

    // The stored cart does not hold this line, so the browser must stop
    // pretending it does.
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

// ---------- Backend cart integration ----------
// Every cart mutation is mirrored to the persistent backend cart (/api/cart),
// whether or not the shopper has an account. For a signed-in shopper that is
// what makes a cart survive across devices and sessions and what exercises the
// inventory-reservation workflow; for a guest it is what makes the basket a
// thing the shop can see at all, rather than something that exists only in one
// browser until it is cleared. The server is the authority either way: a
// change it refuses does not survive locally.

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
    if (!navigator.onLine) return;
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
        // The server drops lines whose product has been withdrawn from sale
        // and names them (#1546). Keeping a line the server refused would
        // resurrect it on the next sync and carry it all the way to checkout,
        // so the acknowledged basket is what the server actually stored.
        const droppedIds = safeArray(response.droppedProductIds)
            .map((id) => String(id));

        if (droppedIds.length) {
            const kept = safeArray(cart).filter(
                (item) => !droppedIds.includes(String(item.id))
            );

            notify(
                droppedIds.length === 1
                    ? "An item in your cart is no longer available and has been removed."
                    : `${droppedIds.length} items in your cart are no longer available and have been removed.`,
                "warning"
            );

            serverAcknowledgedItems = kept;
            saveCart(kept, { sync: false });

            return true;
        }

        serverAcknowledgedItems = cart;
        return true;
    }

    notify(
        (response && response.message)
        || "Your cart could not be saved.",
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
            // Lines whose product has since been withdrawn are not returned
            // (#1546). The count of them is, so a basket that comes back
            // shorter than the shopper left it can say why instead of looking
            // like the cart lost their items.
            const unavailableCount = Number(data.unavailableCount) || 0;

            if (unavailableCount > 0) {
                notify(
                    unavailableCount === 1
                        ? "An item in your cart is no longer available and has been removed."
                        : `${unavailableCount} items in your cart are no longer available and have been removed.`,
                    "warning"
                );
            }

            return safeArray(data.cart)
                .map(normalizeCartItem)
                .filter(Boolean);
        }
    } catch (error) {
        console.warn("Failed to load backend cart:", error);
    }

    return null;
};

// Page-load lifecycle: the stored cart REPLACES the local mirror. Nothing is
// merged here — merging what is only a mirror of the same cart is what made
// carts inflate on their own with nobody touching them.
//
// A guest hydrates too, but only once there is a token to hydrate against. A
// visitor who has never added anything has no stored cart to read, and asking
// for one would open a basket nobody started.
const hydrateCartFromServer = async () => {
    if (!isAuthenticated() && !getCartToken()) {
        return getCart();
    }

    const serverCart = await fetchServerCart();

    if (!serverCart) {
        return getCart();
    }

    serverAcknowledgedItems = serverCart;

    return saveCart(serverCart, { sync: false });
};

// Sign-in lifecycle. The server folds the guest basket into the account's cart
// as it issues the session (#1427), so by the time this runs the account's
// cart already holds both and the only thing left to do is read it back.
//
// Combining here as well would count the guest's lines a second time, and the
// flag that used to stop a reload repeating the merge is gone with it: the
// guest cart is closed on the server, so a repeat has nothing to find. The
// token is dropped for the same reason -- the cart it reached no longer
// exists as a cart anyone can add to.
const mergeGuestCartIntoAccount = async () => {
    if (!isAuthenticated()) {
        return getCart();
    }

    clearCartToken();

    return hydrateCartFromServer();
};

// ---------- Recovery attribution (#1429) ----------
// A basket restored from a recovery link hands back a reference to the link it
// came through. Checkout sends it on, so the order can record that it was
// recovered instead of the figure being guessed from timestamps afterwards.
//
// It lives here rather than with the restore landing page because the two ends
// are on different pages: the reference is written on the cart page and read on
// the checkout page, and only utils is loaded by both.

const RECOVERY_REF_KEY = "cart_recovery_ref";

// Housekeeping, not enforcement. The server has its own attribution window and
// is the only thing that decides what counts; this just stops a reference from
// a fortnight ago riding along on every order in the meantime.
const RECOVERY_REF_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const rememberRecoveryRef = (reference) => {
    if (!reference) return;

    setJSON(RECOVERY_REF_KEY, { ref: String(reference), storedAt: Date.now() });
};

const getRecoveryRef = () => {
    const stored = getJSON(RECOVERY_REF_KEY, null);

    if (!stored || !stored.ref) return null;

    if (Date.now() - safeNumber(stored.storedAt, 0) > RECOVERY_REF_TTL_MS) {
        removeStorage(RECOVERY_REF_KEY);
        return null;
    }

    return stored.ref;
};

const clearRecoveryRef = () => removeStorage(RECOVERY_REF_KEY);

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
// /promos/validate and maps the response onto the legacy { valid, code, percent,
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
        // "/promos", plural: routes/index.js has always mounted the promo
        // router there, and the singular spelling here meant every coupon
        // anyone entered was answered by a 404 and reported as an invalid code
        // (#1445). CONFIG.API_BASE already ends in /api.
        const response = await apiRequest("/promos/validate", {
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
    couponCode = "",
    shippingMethod = null,
    destination = null
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

    try {
        const response = await apiRequest("/checkout/quote", {
            method: "POST",
            body: JSON.stringify({
                items,
                promoCode: couponCode || null,
                // A code naming a delivery option, never a rate. The server
                // decides what it costs.
                shippingMethod: shippingMethod || null,
                // Where it is going, so destination rules can apply. Null
                // until an address is known, which is the whole of the cart
                // page.
                destination: destination || null
            })
        });

        if (!response || !response.success || !response.breakdown) {
            throw new Error(
                (response && response.message) || "Quote unavailable"
            );
        }

        return {
            ...response.breakdown,
            shippingOptions: safeArray(response.shippingOptions),
            freeShipping: response.freeShipping || null,
            promoMessage: response.promoMessage || null,
            isServerQuote: true
        };
    } catch (error) {
        console.error("CART QUOTE ERROR:", error);

        const fallback = await calculateCartTotals(cart, couponCode);

        return {
            ...fallback,
            // Deliberately empty: the local fallback cannot price a delivery
            // option, and offering a choice it could not cost would show the
            // shopper a figure the server never agreed to. The same goes for
            // promising free delivery at a threshold only the server knows.
            shippingOptions: [],
            freeShipping: null,
            isServerQuote: false
        };
    }
};

// How the progress toward free delivery reads. The threshold and the shortfall
// are both the server's figures — the browser knows neither the rule nor the
// basket value it is measured against — so this only chooses the wording.
//
// Returns an empty string when there is no threshold to work toward, which is
// a perfectly ordinary configuration and should render nothing rather than an
// empty promise.
const formatFreeShippingProgress = (freeShipping, currency) => {
    if (!freeShipping) {
        return "";
    }

    if (freeShipping.qualified) {
        return "Your order qualifies for free delivery.";
    }

    return (
        `Add ${formatPrice(freeShipping.remaining, currency)} more to qualify ` +
        "for free delivery."
    );
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

const addToCompare = (productId) => {
    const id = String(productId ?? "").trim();
    if (!id) return false;

    const STORAGE_KEYS = ["compareProducts", "comparisonList"];
    let currentCompare = getJSON("compareProducts", []);
    if (!Array.isArray(currentCompare) || !currentCompare.length) {
        currentCompare = getJSON("comparisonList", []);
    }
    if (!Array.isArray(currentCompare)) currentCompare = [];

    const stringIds = currentCompare.map((item) => String(item ?? "").trim()).filter(Boolean);

    if (stringIds.includes(id)) {
        notify("Product already selected", "info");
        return false;
    }

    if (stringIds.length >= 3) {
        notify("You can compare up to 3 products only", "warning");
        return false;
    }

    stringIds.push(id);
    STORAGE_KEYS.forEach((key) => setJSON(key, stringIds));

    notify("Added for comparison", "success");
    return true;
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
    defaultImage,
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
    getCartToken,
    clearCartToken,
    rememberGuestOrder,
    readGuestOrder,
    getCartCount,
    isAuthenticated,
    syncCartWithBackend,
    mergeCartLines,
    hydrateCartFromServer,
    mergeGuestCartIntoAccount,
    rememberRecoveryRef,
    getRecoveryRef,
    clearRecoveryRef,
    validateCoupon,
    calculateCartTotals,
    fetchCartQuote,
    formatFreeShippingProgress,
    getWishlist,
    saveWishlist,
    addToCompare,
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
window.addToCompare = addToCompare;

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

// Hydrate the persistent backend cart on load, so a cart created on another
// device or session follows a signed-in shopper here and a guest's basket
// survives a reload. Combining a guest cart into an account is a separate,
// deliberate step that belongs to sign-in.
if ((getToken() && getUser()) || getCartToken()) {
    hydrateCartFromServer().catch((error) => {
        console.warn("Initial cart hydration failed:", error);
    });
}
