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

        // guard against missing keys and stale literal
        // "undefined"/"null" strings written by older code
        if (
            !value
            ||
            value === "undefined"
            ||
            value === "null"
        ) {
            return fallback;
        }

        return JSON.parse(value);

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
    return localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);
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

    // cart and wishlist belong to the account, never the browser,
    // so clear them on logout to avoid leaking into the next session
    removeStorage(
        CONFIG.STORAGE_KEYS.CART
    );

    removeStorage(
        CONFIG.STORAGE_KEYS.WISHLIST
    );
};

// redirect guests to sign in before account-bound actions (add to
// cart / wishlist). Returns true only when a user is logged in.
const requireLogin = (
    message = "Please sign in to continue"
) => {

    if (getUser()) {
        return true;
    }

    notify(
        message,
        "error"
    );

    setTimeout(
        () => {
            window.location.href =
                "signin.html";
        },
        800
    );

    return false;
};

const requireAuth = () => {

    const user =
        getUser();

    if (
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

// refresh token
const refreshAccessToken =
    async () => {

        try {

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
                        credentials: "include",
                        body: JSON.stringify({})
                    }
                );

            const data =
                await response.json();

            // invalid refresh
            if (
                !response.ok
                ||
                !data.success
            ) {

                clearAuthData();

                return null;
            }

            // save user
            if (data.user) {
                setJSON(CONFIG.STORAGE_KEYS.USER, data.user);
            }

            return data.success ? true : null;



        } catch (error) {

            console.error(
                "TOKEN REFRESH ERROR:",
                error
            );

            clearAuthData();

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

            const headers = {

                "Content-Type":
                    "application/json",

                ...(options.headers || {})
            };

            const response =
                await fetch(
                    `${CONFIG.API_BASE}${url}`,
                    {
                        ...options,
                        credentials: options.credentials || "include",
                        headers,
                        signal: controller.signal
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
            ) {

                const newToken =
                    await refreshAccessToken();

                if (
                    newToken
                ) {

                    return apiRequest(
                        url,
                        options,
                        false
                    );
                }

                clearAuthData();

                notify(
                    "Session expired. Please login again.",
                    "error"
                );

                setTimeout(
                    () => {

                        window.location.href =
                            "signin.html";

                    },
                    1000
                );

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

                throw new Error(
                    data.message
                    ||
                    `Request failed (${response.status})`
                );
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
const formatPrice = (
    price
) => {

    return `₹${parseFloat(
        price || 0
    ).toFixed(2)}`;
};

// image fallback
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
        : "assets/images/default-product.png";
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

// debounced backend sync for account-bound collections.
// Each endpoint keeps its own timer so rapid edits collapse into a
// single "replace whole collection" request. Only logged-in users sync.
const queueCollectionSync = (() => {

    const timers = {};

    return (
        endpoint,
        items
    ) => {

        if (!getUser()) {
            return;
        }

        clearTimeout(
            timers[endpoint]
        );

        timers[endpoint] =
            setTimeout(
                () => {

                    apiRequest(
                        endpoint,
                        {
                            method: "POST",
                            body: JSON.stringify({
                                items: safeArray(items)
                            })
                        }
                    ).catch((error) => {
                        console.error(
                            `Collection sync failed for ${endpoint}:`,
                            error
                        );
                    });

                },
                600
            );
    };
})();

// load the logged-in account's cart and wishlist from the backend
// into local storage. Called right after login so the next account
// sees its own items, not whatever was cached in this browser.
const loadUserCollections = async () => {

    if (!getUser()) {
        return;
    }

    try {

        const [cartResponse, wishlistResponse] =
            await Promise.all([
                apiRequest("/cart"),
                apiRequest("/wishlist")
            ]);

        if (
            cartResponse
            &&
            cartResponse.success
            &&
            Array.isArray(cartResponse.cart)
        ) {
            // setJSON (not saveCart) to avoid echoing a sync request back
            setJSON(
                CONFIG.STORAGE_KEYS.CART,
                cartResponse.cart
            );
        }

        if (
            wishlistResponse
            &&
            wishlistResponse.success
            &&
            Array.isArray(wishlistResponse.wishlist)
        ) {
            setJSON(
                CONFIG.STORAGE_KEYS.WISHLIST,
                wishlistResponse.wishlist
            );
        }

        if (typeof window.updateCartCount === "function") {
            window.updateCartCount();
        }

        if (typeof window.updateWishlistCount === "function") {
            window.updateWishlistCount();
        }

    } catch (error) {
        console.error(
            "Failed to load user collections:",
            error
        );
    }
};

// cart helpers
const getCart = () => {

    return getJSON(
        CONFIG.STORAGE_KEYS.CART,
        []
    );
};

const saveCart = (
    cart
) => {

    const safe = safeArray(cart);

    setJSON(
        CONFIG.STORAGE_KEYS.CART,
        safe
    );

    if (typeof window.updateCartCount === "function") {
        window.updateCartCount();
    }

    queueCollectionSync(
        "/cart/sync",
        safe
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

    const safe = safeArray(wishlist);

    setJSON(
        CONFIG.STORAGE_KEYS.WISHLIST,
        safe
    );

    if (typeof window.updateWishlistCount === "function") {
        window.updateWishlistCount();
    }

    queueCollectionSync(
        "/wishlist/sync",
        safe
    );
};

const getToken = () => {
    return getUser() ? "session_active" : null;
};

// app utils assignment
window.AppUtils = {
    CONFIG,
    notify,
    escapeHTML,
    getJSON,
    setJSON,
    removeStorage,

    getUser,
    getToken,
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
    getCart,
    saveCart,
    getWishlist,
    saveWishlist,
    getToken,
    requireLogin,
    loadUserCollections
};

// backward compatibility assignments
window.API_BASE = CONFIG.API_BASE;
window.requireLogin = requireLogin;
window.loadUserCollections = loadUserCollections;
window.notify = notify;
window.getJSON = getJSON;
window.setJSON = setJSON;
window.apiRequest = apiRequest;
window.$ = $;
window.$$ = $$;
window.formatPrice = formatPrice;
window.requireAuth = requireAuth;
window.defaultImage = defaultImage;
window.safeForEach = safeForEach;
window.safeMap = safeMap;