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

// refresh token
const refreshAccessToken =
    async () => {

        try {

            const refreshToken =
                getRefreshToken();

            if (
                !refreshToken
            ) {

                clearAuthData();

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

                clearAuthData();

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

// cart helpers
const CART_UPDATED_EVENT =
    "cartUpdated";

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
        qty
    };
};

const getCart = () => {

    let storedCart = [];

    try {

        const value =
            localStorage.getItem(
                CONFIG.STORAGE_KEYS.CART
            );

        storedCart =
            value
                ? JSON.parse(value)
                : [];

    } catch (error) {

        console.warn(
            `getCart error for key "${CONFIG.STORAGE_KEYS.CART}":`,
            error
        );

        removeStorage(
            CONFIG.STORAGE_KEYS.CART
        );

        return [];
    }

    if (
        !Array.isArray(
            storedCart
        )
    ) {

        removeStorage(
            CONFIG.STORAGE_KEYS.CART
        );

        return [];
    }

    const cart =
        storedCart
            .map(
                normalizeCartItem
            )
            .filter(
                Boolean
            );

    if (
        cart.length !==
        storedCart.length
    ) {

        setJSON(
            CONFIG.STORAGE_KEYS.CART,
            cart
        );
    }

    return cart;
};

const saveCart = (
    cart,
    { sync = true } = {}
) => {

    const normalizedCart =
        safeArray(cart)
            .map(
                normalizeCartItem
            )
            .filter(
                Boolean
            );

    const saved =
        setJSON(
            CONFIG.STORAGE_KEYS.CART,
            normalizedCart
        );

    if (
        saved
    ) {

        window.dispatchEvent(
            new CustomEvent(
                CART_UPDATED_EVENT,
                {
                    detail: {
                        cart:
                            normalizedCart
                    }
                }
            )
        );
    }

    // Signed-in users: mirror every mutation to the persistent backend cart.
    // `sync: false` is used when the local mirror is being hydrated FROM the
    // backend, to avoid an echo write.
    if (sync && isAuthenticated()) {
        syncCartWithBackend(normalizedCart);
    }

    return normalizedCart;
};

const getCartItemKey = (
    item
) => {

    return [
        String(
            item?.id
        ),
        item?.color || "",
        item?.size || ""
    ].join("|");
};

const addCartItem = (
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

    const cart =
        getCart();

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

    // Signed-in users: reserve stock through the backend. This is the only
    // endpoint that creates the 15-minute inventory lock the checkout flow
    // later validates, so add must route through it (not just /cart/sync).
    if (isAuthenticated()) {
        apiRequest(
            "/cart/add",
            {
                method: "POST",
                body: JSON.stringify({
                    productId: item.id,
                    quantity: item.qty
                })
            }
        ).catch((error) => {
            console.warn(
                "Cart reservation failed:",
                error
            );
        });
    }

    return saveCart(
        cart
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

const isAuthenticated = () =>
    Boolean(getToken() && getUser());

// Collapse the local cart (which keys lines by id|color|size) into the
// product-level shape the backend cart stores (one row per product).
const aggregateCartForBackend = (cart) => {
    const totals = new Map();

    safeArray(cart).forEach((item) => {
        if (item?.id === undefined || item?.id === null) {
            return;
        }

        const key = String(item.id);
        const qty = Math.max(1, safeInteger(item.qty, 1));

        totals.set(key, (totals.get(key) || 0) + qty);
    });

    return Array.from(
        totals,
        ([productId, qty]) => ({ productId, qty })
    );
};

// Debounced full-cart push. /cart/sync is replace-all, so it reconciles the
// server with the authoritative local cart after any mutation — including bulk
// edits made directly through saveCart outside the helpers above.
const syncCartWithBackend = debounce((cart) => {
    if (!isAuthenticated()) {
        return;
    }

    apiRequest("/cart/sync", {
        method: "POST",
        body: JSON.stringify({
            items: aggregateCartForBackend(cart)
        })
    }).catch((error) => {
        console.warn("Cart backend sync failed:", error);
    });
}, 600);

// Merge two carts by line key, summing quantities. Folds a guest cart into the
// account cart on login.
const mergeCarts = (primary, secondary) => {
    const merged = safeArray(primary)
        .map(normalizeCartItem)
        .filter(Boolean);

    safeArray(secondary)
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

// Hydrate the local cart mirror from the persistent backend cart. Called on
// login and on page load for signed-in users. `retry` is disabled on the fetch
// so an expired session never force-redirects a browsing user off a public
// page; a real mutation will trigger the normal refresh/redirect flow instead.
const loadUserCollections = async () => {
    if (!isAuthenticated()) {
        return getCart();
    }

    let serverCart = [];

    try {
        const data = await apiRequest("/cart", {}, false);

        if (data && data.success) {
            serverCart = safeArray(data.cart);
        }
    } catch (error) {
        console.warn("Failed to load backend cart:", error);
        return getCart();
    }

    const guestCart = getCart();
    const merged = mergeCarts(serverCart, guestCart);

    // Persist the merged view locally without echoing it straight back.
    saveCart(merged, { sync: false });

    // If the user brought a guest cart, push the merge so other devices
    // converge on the combined state.
    if (guestCart.length) {
        syncCartWithBackend(merged);
    }

    return merged;
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

const validateCoupon = (
    code
) => {

    const normalizedCode =
        String(
            code || ""
        )
            .trim()
            .toUpperCase();

    const coupons = {
        SAVE10: 10,
        SAVE20: 20
    };

    if (
        !normalizedCode
    ) {

        return {
            valid: false,
            code: "",
            percent: 0,
            message:
                "Enter a coupon code."
        };
    }

    if (
        !coupons[normalizedCode]
    ) {

        return {
            valid: false,
            code:
                normalizedCode,
            percent: 0,
            message:
                "Invalid coupon code."
        };
    }

    return {
        valid: true,
        code:
            normalizedCode,
        percent:
            coupons[normalizedCode],
        message:
            `${normalizedCode} applied successfully.`
    };
};

const calculateCartTotals = (
    cart = getCart(),
    couponCode = ""
) => {

    const subtotal =
        safeArray(
            cart
        ).reduce(
            (
                sum,
                item
            ) =>
                sum +
                (
                    safeNumber(
                        item.price,
                        0
                    ) *
                    Math.max(
                        1,
                        safeInteger(
                            item.qty,
                            1
                        )
                    )
                ),
            0
        );

    const coupon =
        validateCoupon(
            couponCode
        );

    const discount =
        coupon.valid
            ? subtotal *
                (
                    coupon.percent / 100
                )
            : 0;

    const discountedSubtotal =
        Math.max(
            0,
            subtotal - discount
        );

    const tax =
        discountedSubtotal * 0.18;

    const shipping =
        discountedSubtotal > 0
        &&
        discountedSubtotal < 999
            ? 49
            : 0;

    const total =
        discountedSubtotal +
        tax +
        shipping;

    return {
        subtotal,
        coupon:
            coupon.valid
                ? coupon
                : null,
        discount,
        tax,
        shipping,
        total
    };
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
    getCartCount,
    isAuthenticated,
    syncCartWithBackend,
    loadUserCollections,
    validateCoupon,
    calculateCartTotals,
    getWishlist,
    saveWishlist
};

// backward compatibility assignments
window.API_BASE = CONFIG.API_BASE;
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

// Hydrate the persistent backend cart for already–signed-in users on load, so
// a cart created on another device/session follows them here. Listeners on
// CART_UPDATED_EVENT (cart page, drawer, navbar count) refresh automatically.
if (getToken() && getUser()) {
    loadUserCollections().catch((error) => {
        console.warn("Initial cart hydration failed:", error);
    });
}
