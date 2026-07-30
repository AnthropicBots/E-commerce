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

// Global image error capture listener - guarantees automatic fallback for broken images
if (typeof window !== "undefined") {
    window.addEventListener(
        "error",
        (event) => {
            if (event.target && event.target.tagName === "IMG") {
                handleImageError(event.target);
            }
        },
        true
    );
}

// Hydrate the persistent backend cart for already–signed-in users on load, so
// a cart created on another device/session follows them here. Listeners on
// CART_UPDATED_EVENT (cart page, drawer, navbar count) refresh automatically.
if (getToken() && getUser()) {
    loadUserCollections().catch((error) => {
        console.warn("Initial cart hydration failed:", error);
    });
}
