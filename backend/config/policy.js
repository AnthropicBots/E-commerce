// backend/config/policy.js
//
// The authorization policy: one role vocabulary, one permission map, one
// definition of "admin".
//
// Before this module the middleware and the handlers each carried their own
// answer. `rbacMiddleware.adminMiddleware` admitted `admin` and `superadmin`,
// while handlers wrote `req.user.role !== 'admin'` inline -- so a superadmin
// was rejected by the very handlers a superadmin is meant to reach. Everything
// that needs to make an access decision now resolves it here.
//
// This module is deliberately pure: no database, no Express import, no logger.
// It can be required from a route, a controller, a service or a test without
// dragging in a connection pool.

/**
 * Roles recognised by the platform.
 *
 * Both `customer` and `user` are listed because both are real:
 * `migrations/0001_baseline_schema.sql` declares the users column as
 * ENUM('customer','support','admin','seller')
 * with a 'customer' default, while `models/User.js` defaults new users to
 * 'user' and additionally allows 'superadmin' and 'moderator'. They are
 * synonyms for the same unprivileged shopper and are treated identically.
 */
const ROLES = Object.freeze({
    CUSTOMER: 'customer',
    USER: 'user',
    SELLER: 'seller',
    SUPPORT: 'support',
    MODERATOR: 'moderator',
    ADMIN: 'admin',
    SUPERADMIN: 'superadmin'
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

/**
 * Capabilities, named after what they let you do rather than after the route
 * that happens to expose them today. A route may move; the capability does not.
 */
const PERMISSIONS = Object.freeze({
    // Self-scoped: every signed-in account holds these for its own resources.
    ORDER_READ_OWN: 'order:read:own',
    ORDER_CANCEL_OWN: 'order:cancel:own',
    CART_MANAGE_OWN: 'cart:manage:own',
    ADDRESS_MANAGE_OWN: 'address:manage:own',
    PROFILE_MANAGE_OWN: 'profile:manage:own',
    REVIEW_WRITE_OWN: 'review:write:own',
    WISHLIST_MANAGE_OWN: 'wishlist:manage:own',

    // Cross-account and platform capabilities.
    ORDER_READ_ANY: 'order:read:any',
    ORDER_MANAGE: 'order:manage',
    ORDER_EXPORT: 'order:export',
    CATALOG_MANAGE: 'catalog:manage',
    USER_MANAGE: 'user:manage',
    PROMO_MANAGE: 'promo:manage',
    CACHE_MANAGE: 'cache:manage',
    REFUND_MANAGE: 'refund:manage',
    REVIEW_MODERATE: 'review:moderate',
    CHAT_MANAGE: 'chat:manage',
    SHIPMENT_READ: 'shipment:read',
    SHIPMENT_MANAGE: 'shipment:manage',
    APPROVAL_MANAGE: 'approval:manage',
    GIFT_CARD_ISSUE: 'giftcard:issue',
    LOYALTY_ADJUST: 'loyalty:adjust',
    WISHLIST_READ_ANY: 'wishlist:read:any',
    SECURITY_AUDIT: 'security:audit',
    PLATFORM_ADMIN: 'platform:admin'
});

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

const SELF_SERVICE_PERMISSIONS = Object.freeze([
    PERMISSIONS.ORDER_READ_OWN,
    PERMISSIONS.ORDER_CANCEL_OWN,
    PERMISSIONS.CART_MANAGE_OWN,
    PERMISSIONS.ADDRESS_MANAGE_OWN,
    PERMISSIONS.PROFILE_MANAGE_OWN,
    PERMISSIONS.REVIEW_WRITE_OWN,
    PERMISSIONS.WISHLIST_MANAGE_OWN
]);

/**
 * Role to permission map.
 *
 * The elevated grants below mirror the access the codebase already gave each
 * role, so migrating a handler onto this map is not a privilege change. The
 * one intended difference is that `superadmin` now holds everything `admin`
 * holds, which is what `adminMiddleware` always assumed.
 */
const ROLE_PERMISSIONS = Object.freeze({
    [ROLES.CUSTOMER]: SELF_SERVICE_PERMISSIONS,
    [ROLES.USER]: SELF_SERVICE_PERMISSIONS,
    [ROLES.SELLER]: SELF_SERVICE_PERMISSIONS,
    [ROLES.SUPPORT]: Object.freeze([
        ...SELF_SERVICE_PERMISSIONS,
        PERMISSIONS.ORDER_READ_ANY,
        PERMISSIONS.ORDER_EXPORT,
        PERMISSIONS.SHIPMENT_READ
    ]),
    [ROLES.MODERATOR]: Object.freeze([
        ...SELF_SERVICE_PERMISSIONS,
        PERMISSIONS.REVIEW_MODERATE
    ]),
    [ROLES.ADMIN]: ALL_PERMISSIONS,
    [ROLES.SUPERADMIN]: ALL_PERMISSIONS
});

/**
 * Roles that carry platform-wide authority. Anything that used to ask
 * "is this string 'admin'?" should ask `isAdminRole` instead.
 */
const ADMIN_ROLES = Object.freeze([ROLES.ADMIN, ROLES.SUPERADMIN]);

// Reused verbatim by rbacMiddleware so both entry points answer with the same
// error codes; existing clients key off these strings.
const ERROR_CODES = Object.freeze({
    USER_NOT_FOUND: 'ADMIN_USER_NOT_FOUND',
    ACCOUNT_INACTIVE: 'ADMIN_ACCOUNT_INACTIVE',
    ACCOUNT_BLOCKED: 'ADMIN_ACCOUNT_BLOCKED',
    EMAIL_NOT_VERIFIED: 'ADMIN_EMAIL_NOT_VERIFIED',
    ADMIN_ROLE_REQUIRED: 'ADMIN_ROLE_REQUIRED',
    TOKEN_INVALID: 'ADMIN_TOKEN_INVALID',
    UNAUTHORIZED: 'ADMIN_UNAUTHORIZED'
});

/**
 * Stamped onto every middleware that carries an access decision.
 *
 * The route audit needs to tell a guard from an ordinary handler, and function
 * names are not a safe signal: they survive minification badly, and a handler
 * called `checkAccess` that checks nothing would pass a name test. A symbol
 * can only be present because this module put it there.
 */
const POLICY_MARKER = Symbol.for('ecommerce.policyMiddleware');

/**
 * Declare a middleware as policy-bearing.
 *
 * @param {Function} middleware
 * @param {object} [meta] describes what the middleware enforces, for reporting
 * @returns {Function} the same middleware
 */
function markPolicyMiddleware(middleware, meta = {}) {
    middleware[POLICY_MARKER] = { ...meta };
    return middleware;
}

/**
 * @param {*} middleware
 * @returns {boolean} true when the middleware carries an access decision
 */
function isPolicyMiddleware(middleware) {
    return typeof middleware === 'function' && Boolean(middleware[POLICY_MARKER]);
}

/**
 * Reduce anything role-shaped to a comparable string.
 * Roles arrive from JWT claims and from MySQL, so casing and padding vary.
 *
 * @param {*} role
 * @returns {string|null} the canonical role string, or null if unusable
 */
function normalizeRole(role) {
    if (typeof role !== 'string') {
        return null;
    }
    const normalized = role.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}

/**
 * @param {*} role
 * @returns {boolean} true when the role is part of the known vocabulary
 */
function isValidRole(role) {
    return ALL_ROLES.includes(normalizeRole(role));
}

/**
 * The single answer to "does this role count as an admin?".
 *
 * @param {*} role
 * @returns {boolean}
 */
function isAdminRole(role) {
    return ADMIN_ROLES.includes(normalizeRole(role));
}

/**
 * Pull the role off whatever the caller has to hand: a decoded JWT payload, a
 * `models/User` instance, or a bare role string.
 *
 * @param {object|string|null|undefined} user
 * @returns {string|null}
 */
function roleOf(user) {
    if (typeof user === 'string') {
        return normalizeRole(user);
    }
    if (!user || typeof user !== 'object') {
        return null;
    }
    return normalizeRole(user.role);
}

/**
 * @param {*} role
 * @returns {string[]} permissions held by the role; empty for unknown roles
 */
function permissionsForRole(role) {
    return ROLE_PERMISSIONS[normalizeRole(role)] || [];
}

/**
 * @param {object|string|null|undefined} user
 * @param {string} permission
 * @returns {boolean}
 */
function hasPermission(user, permission) {
    if (!permission) {
        return false;
    }
    return permissionsForRole(roleOf(user)).includes(permission);
}

/**
 * Widen a required-role list to every role that satisfies it.
 *
 * `superadmin` is a strict superset of `admin`, so a route asking for `admin`
 * has always meant "admin or better". Callers that spelled out only `admin`
 * were rejecting superadmins by accident, which is the inconsistency this
 * module exists to remove.
 *
 * @param {string[]} roles
 * @returns {string[]} the effective set of accepted roles
 */
function expandRoles(roles) {
    const accepted = new Set();

    for (const role of roles || []) {
        const normalized = normalizeRole(role);
        if (!normalized) {
            continue;
        }
        accepted.add(normalized);
        if (normalized === ROLES.ADMIN) {
            accepted.add(ROLES.SUPERADMIN);
        }
    }

    return [...accepted];
}

/**
 * @param {string[]} requiredRoles
 * @param {object|string|null|undefined} user
 * @returns {boolean}
 */
function satisfiesRoles(requiredRoles, user) {
    const role = roleOf(user);
    if (!role) {
        return false;
    }
    return expandRoles(requiredRoles).includes(role);
}

/**
 * Express middleware gating a route on a named permission.
 *
 * Expects an upstream authenticator (`authMiddleware`) to have populated
 * `req.user`. Unlike `rbacMiddleware.authorizeRoles` this performs no database
 * round trip -- it answers purely from the token claims, so it suits routes
 * that only need a capability check.
 *
 * @param {string} permission one of PERMISSIONS
 * @returns {Function} express middleware
 */
function authorize(permission) {
    if (!ALL_PERMISSIONS.includes(permission)) {
        throw new Error(`Unknown permission: ${permission}`);
    }

    return markPolicyMiddleware(function authorizePermission(req, res, next) {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                errorCode: ERROR_CODES.TOKEN_INVALID,
                message: 'Authentication required. Please login again.'
            });
        }

        if (!hasPermission(req.user, permission)) {
            return res.status(403).json({
                success: false,
                errorCode: ERROR_CODES.ADMIN_ROLE_REQUIRED,
                message: `Access denied. Required permission: ${permission}`
            });
        }

        return next();
    }, { permission });
}

module.exports = {
    ROLES,
    ALL_ROLES,
    PERMISSIONS,
    ALL_PERMISSIONS,
    ROLE_PERMISSIONS,
    ADMIN_ROLES,
    ERROR_CODES,
    POLICY_MARKER,
    markPolicyMiddleware,
    isPolicyMiddleware,
    normalizeRole,
    isValidRole,
    isAdminRole,
    roleOf,
    permissionsForRole,
    hasPermission,
    expandRoles,
    satisfiesRoles,
    authorize
};
