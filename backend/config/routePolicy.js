// backend/config/routePolicy.js
//
// Which routes are allowed to be public, and where the audited routers are
// mounted.
//
// The default for a new route is "protected". A route that is genuinely open
// to anonymous traffic has to be written down here, which makes shipping an
// unprotected endpoint a visible edit in a reviewed file rather than an
// omission nobody notices. The audit in middleware/routeAudit.js reads this
// list; nothing else does.

const PUBLIC_REASON = Object.freeze({
    HEALTH: 'liveness/readiness probe',
    CATALOG: 'anonymous browsing is the point of a storefront',
    AUTH_ENTRY: 'the caller has no credentials yet, by definition',
    PRE_AUTH_QUOTE: 'quoted before an account exists, so guest checkout works',
    SIGNED_TOKEN: 'authorised by an unguessable token in the URL, not by session',
    ORDER_CREDENTIALS: 'authorised by the order number and the email it was placed with',
    WEBHOOK: 'authenticated by provider signature inside the handler'
});

/**
 * Routes that may be reached without an authenticated caller.
 *
 * `path` is the full mounted path exactly as the router declares it, including
 * Express parameter syntax. `method` is upper-case, or '*' when every method on
 * the path is public.
 */
const PUBLIC_ROUTES = Object.freeze([
    { method: 'GET', path: '/health', reason: PUBLIC_REASON.HEALTH },
    { method: 'GET', path: '/api/products/status/check', reason: PUBLIC_REASON.HEALTH },
    { method: 'GET', path: '/api/orders/status/check', reason: PUBLIC_REASON.HEALTH },
    { method: 'GET', path: '/api/courier-webhooks/health', reason: PUBLIC_REASON.HEALTH },

    { method: 'GET', path: '/api/products', reason: PUBLIC_REASON.CATALOG },
    { method: 'GET', path: '/api/products/:id', reason: PUBLIC_REASON.CATALOG },
    { method: 'GET', path: '/api/products/:id/reviews', reason: PUBLIC_REASON.CATALOG },
    { method: 'GET', path: '/api/products/search-suggestions', reason: PUBLIC_REASON.CATALOG },
    { method: 'GET', path: '/api/products/categories/tree', reason: PUBLIC_REASON.CATALOG },
    { method: 'GET', path: '/api/products/:id/questions', reason: PUBLIC_REASON.CATALOG },
    { method: 'GET', path: '/api/pincode/check/:pincode', reason: PUBLIC_REASON.CATALOG },

    { method: 'GET', path: '/api/auth/status', reason: PUBLIC_REASON.AUTH_ENTRY },
    { method: 'POST', path: '/api/auth/signup', reason: PUBLIC_REASON.AUTH_ENTRY },
    { method: 'POST', path: '/api/auth/verify-signup', reason: PUBLIC_REASON.AUTH_ENTRY },
    { method: 'POST', path: '/api/auth/login', reason: PUBLIC_REASON.AUTH_ENTRY },
    { method: 'POST', path: '/api/auth/forgot-password', reason: PUBLIC_REASON.AUTH_ENTRY },
    { method: 'POST', path: '/api/auth/reset-password', reason: PUBLIC_REASON.AUTH_ENTRY },
    { method: 'POST', path: '/api/auth/refresh-token', reason: PUBLIC_REASON.AUTH_ENTRY },
    { method: 'POST', path: '/api/auth/logout', reason: PUBLIC_REASON.AUTH_ENTRY },

    { method: 'POST', path: '/api/orders/validate', reason: PUBLIC_REASON.PRE_AUTH_QUOTE },
    { method: 'POST', path: '/api/promos/validate', reason: PUBLIC_REASON.PRE_AUTH_QUOTE },
    { method: 'POST', path: '/api/checkout/quote', reason: PUBLIC_REASON.PRE_AUTH_QUOTE },

    { method: 'POST', path: '/api/orders/lookup', reason: PUBLIC_REASON.ORDER_CREDENTIALS },

    { method: 'GET', path: '/api/wishlist/share/:token', reason: PUBLIC_REASON.SIGNED_TOKEN },
    { method: 'POST', path: '/api/auth/erasure/confirm', reason: PUBLIC_REASON.SIGNED_TOKEN },
    { method: 'GET', path: '/api/auth/erasure/receipt/:receiptId', reason: PUBLIC_REASON.SIGNED_TOKEN },
    { method: 'POST', path: '/api/wishlist-notify/unsubscribe', reason: PUBLIC_REASON.SIGNED_TOKEN },

    { method: 'POST', path: '/api/courier-webhooks/:provider', reason: PUBLIC_REASON.WEBHOOK }
]);

const GUEST_REASON = Object.freeze({
    CART_TOKEN: 'the shopper holds an unguessable cart token instead of a session',
    GUEST_CHECKOUT: 'buying is what the storefront is for, and an account is not a prerequisite'
});

/**
 * Routes a caller with no account may reach, and on what evidence.
 *
 * Distinct from `PUBLIC_ROUTES`, which is the list of routes that make no
 * access decision at all. These do: they identify a resource and refuse
 * anything that is not it. What they do not require is an account.
 *
 * Serving a guest is a product decision with a security consequence, so it is
 * written down in the same reviewed file for the same reason the public list
 * is -- and the audit checks the list against the routers, so a guard that
 * quietly starts admitting anonymous callers shows up here or fails.
 */
const GUEST_ROUTES = Object.freeze([
    { method: 'GET', path: '/api/cart', reason: GUEST_REASON.CART_TOKEN },
    { method: 'POST', path: '/api/cart/sync', reason: GUEST_REASON.CART_TOKEN },
    { method: 'POST', path: '/api/cart/add', reason: GUEST_REASON.CART_TOKEN },
    { method: 'PUT', path: '/api/cart/update', reason: GUEST_REASON.CART_TOKEN },
    { method: 'DELETE', path: '/api/cart/remove/:productId', reason: GUEST_REASON.CART_TOKEN },
    { method: 'DELETE', path: '/api/cart/clear', reason: GUEST_REASON.CART_TOKEN },

    { method: 'POST', path: '/api/orders', reason: GUEST_REASON.GUEST_CHECKOUT },
    { method: 'POST', path: '/api/orders/create-payment-intent', reason: GUEST_REASON.GUEST_CHECKOUT }
]);

/**
 * The routers the audit covers, with the prefix each is mounted under.
 *
 * Express 5 discards the mount path once a router is attached -- the layer
 * keeps compiled matchers, not the string -- so the prefix cannot be recovered
 * by walking the stack and has to be stated. Keeping the list here rather than
 * inferring it also bounds what the audit claims to know: it reports on the
 * commerce surface, and stays silent about routers it was never given.
 */
const AUDITED_MOUNTS = Object.freeze([
    { basePath: '/api/products', modulePath: '../routes/productRoutes' },
    { basePath: '/api/auth', modulePath: '../routes/authRoutes' },
    { basePath: '/api/orders', modulePath: '../routes/orderRoutes' },
    { basePath: '/api/promos', modulePath: '../routes/promoRoutes' },
    { basePath: '/api/admin', modulePath: '../routes/adminRoutes' },
    { basePath: '/api/chat', modulePath: '../routes/chatRoutes' },
    { basePath: '/api/wishlist', modulePath: '../routes/wishlistRoutes' },
    { basePath: '/api/wishlist-notify', modulePath: '../routes/wishlistNotifyRoutes' },
    { basePath: '/api/cart', modulePath: '../routes/cartRoutes' },
    { basePath: '/api/checkout', modulePath: '../routes/checkoutRoutes' },
    { basePath: '/api/pincode', modulePath: '../routes/pincodeRoutes' },
    { basePath: '/api/subscriptions', modulePath: '../routes/subscriptionRoutes' },
    { basePath: '/api/courier-webhooks', modulePath: '../routes/courierWebhookRoutes' },
    { basePath: '/api/refunds', modulePath: '../routes/refundRoutes' },
    { basePath: '/api/addresses', modulePath: '../routes/addressRoutes' }
]);

/**
 * @param {string} method
 * @param {string} path
 * @returns {boolean} true when the route is on the public allowlist
 */
function isPublicRoute(method, path) {
    const wanted = String(method || '').toUpperCase();

    return PUBLIC_ROUTES.some((entry) => (
        entry.path === path && (entry.method === '*' || entry.method === wanted)
    ));
}

/**
 * @param {string} method
 * @param {string} path
 * @returns {boolean} true when the route is declared reachable without an account
 */
function isGuestRoute(method, path) {
    const wanted = String(method || '').toUpperCase();

    return GUEST_ROUTES.some((entry) => (
        entry.path === path && (entry.method === '*' || entry.method === wanted)
    ));
}

module.exports = {
    PUBLIC_REASON,
    PUBLIC_ROUTES,
    GUEST_REASON,
    GUEST_ROUTES,
    AUDITED_MOUNTS,
    isPublicRoute,
    isGuestRoute
};
