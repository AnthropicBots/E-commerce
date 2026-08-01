// backend/tests/policy.test.js
//
// The policy module is pure -- no database, no Express, no network -- so these
// exercise it directly rather than through a mounted app.

const policy = require('../config/policy');
const {
    GUEST_ROUTES,
    PUBLIC_ROUTES,
    isGuestRoute,
    isPublicRoute
} = require('../config/routePolicy');
const snapshot = require('./fixtures/policySnapshot.json');

const {
    ROLES,
    PERMISSIONS,
    ADMIN_ROLES,
    expandRoles,
    hasPermission,
    isAdminRole,
    isGuestCapableMiddleware,
    isPolicyMiddleware,
    isValidRole,
    markPolicyMiddleware,
    normalizeRole,
    permissionsForRole,
    roleOf,
    satisfiesRoles,
    authorize
} = policy;

const createMockResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
});

const sorted = (values) => [...values].sort();

describe('role vocabulary', () => {
    test('normalizes casing and padding', () => {
        expect(normalizeRole('  Admin ')).toBe('admin');
        expect(normalizeRole('SUPERADMIN')).toBe('superadmin');
    });

    test('rejects values that are not roles', () => {
        expect(normalizeRole('')).toBeNull();
        expect(normalizeRole('   ')).toBeNull();
        expect(normalizeRole(null)).toBeNull();
        expect(normalizeRole(42)).toBeNull();
        expect(isValidRole('root')).toBe(false);
    });

    test('accepts every declared role', () => {
        for (const role of Object.values(ROLES)) {
            expect(isValidRole(role)).toBe(true);
        }
    });

    test('reads the role off a user object, a User model or a bare string', () => {
        expect(roleOf({ role: 'admin' })).toBe('admin');
        expect(roleOf('SUPPORT')).toBe('support');
        expect(roleOf(null)).toBeNull();
        expect(roleOf({})).toBeNull();
    });
});

describe('isAdminRole', () => {
    test('admits both administrative roles', () => {
        expect(isAdminRole(ROLES.ADMIN)).toBe(true);
        expect(isAdminRole(ROLES.SUPERADMIN)).toBe(true);
    });

    test('rejects everything else', () => {
        expect(isAdminRole(ROLES.CUSTOMER)).toBe(false);
        expect(isAdminRole(ROLES.SUPPORT)).toBe(false);
        expect(isAdminRole(ROLES.MODERATOR)).toBe(false);
        expect(isAdminRole(undefined)).toBe(false);
    });
});

describe('hasPermission', () => {
    test('grants self-service capabilities to a customer', () => {
        expect(hasPermission({ role: 'customer' }, PERMISSIONS.ORDER_READ_OWN)).toBe(true);
        expect(hasPermission({ role: 'user' }, PERMISSIONS.CART_MANAGE_OWN)).toBe(true);
    });

    test('withholds cross-account capabilities from a customer', () => {
        expect(hasPermission({ role: 'customer' }, PERMISSIONS.ORDER_READ_ANY)).toBe(false);
        expect(hasPermission({ role: 'customer' }, PERMISSIONS.CATALOG_MANAGE)).toBe(false);
    });

    test('gives a superadmin everything an admin has', () => {
        for (const permission of Object.values(PERMISSIONS)) {
            expect(hasPermission({ role: 'admin' }, permission)).toBe(true);
            expect(hasPermission({ role: 'superadmin' }, permission)).toBe(true);
        }
    });

    test('lets support read and export orders but not manage the catalog', () => {
        expect(hasPermission({ role: 'support' }, PERMISSIONS.ORDER_READ_ANY)).toBe(true);
        expect(hasPermission({ role: 'support' }, PERMISSIONS.ORDER_EXPORT)).toBe(true);
        expect(hasPermission({ role: 'support' }, PERMISSIONS.CATALOG_MANAGE)).toBe(false);
    });

    test('denies unknown roles, absent users and unnamed permissions', () => {
        expect(hasPermission({ role: 'root' }, PERMISSIONS.USER_MANAGE)).toBe(false);
        expect(hasPermission(null, PERMISSIONS.USER_MANAGE)).toBe(false);
        expect(hasPermission({ role: 'admin' }, undefined)).toBe(false);
        expect(permissionsForRole('root')).toEqual([]);
    });
});

describe('role expansion', () => {
    // The bug this module exists to fix: a route asking for "admin" rejected a
    // superadmin, while adminMiddleware admitted one.
    test('a requirement of admin also admits a superadmin', () => {
        expect(expandRoles(['admin'])).toContain(ROLES.SUPERADMIN);
        expect(satisfiesRoles(['admin'], { role: 'superadmin' })).toBe(true);
    });

    test('does not widen in the other direction', () => {
        expect(expandRoles(['superadmin'])).not.toContain(ROLES.ADMIN);
        expect(satisfiesRoles(['superadmin'], { role: 'admin' })).toBe(false);
    });

    test('leaves unrelated roles alone', () => {
        expect(sorted(expandRoles(['support']))).toEqual(['support']);
        expect(satisfiesRoles(['admin', 'support'], { role: 'support' })).toBe(true);
        expect(satisfiesRoles(['admin'], { role: 'customer' })).toBe(false);
    });

    test('ignores empty and malformed entries', () => {
        expect(expandRoles([])).toEqual([]);
        expect(expandRoles(undefined)).toEqual([]);
        expect(expandRoles([null, '', 'admin'])).toEqual(expect.arrayContaining([ROLES.ADMIN]));
        expect(satisfiesRoles(['admin'], null)).toBe(false);
    });
});

describe('authorize middleware', () => {
    test('refuses to build a gate on a permission that does not exist', () => {
        expect(() => authorize('orders:read:everything')).toThrow(/Unknown permission/);
    });

    test('passes a caller who holds the permission', () => {
        const res = createMockResponse();
        const next = jest.fn();

        authorize(PERMISSIONS.CATALOG_MANAGE)({ user: { role: 'admin' } }, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('answers 401 when nobody is authenticated', () => {
        const res = createMockResponse();
        const next = jest.fn();

        authorize(PERMISSIONS.CATALOG_MANAGE)({}, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('answers 403 when the caller lacks the permission', () => {
        const res = createMockResponse();
        const next = jest.fn();

        authorize(PERMISSIONS.CATALOG_MANAGE)({ user: { role: 'customer' } }, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            errorCode: 'ADMIN_ROLE_REQUIRED'
        }));
        expect(next).not.toHaveBeenCalled();
    });

    test('is recognisable to the route audit', () => {
        expect(isPolicyMiddleware(authorize(PERMISSIONS.CATALOG_MANAGE))).toBe(true);
        expect(isPolicyMiddleware((req, res, next) => next())).toBe(false);
        expect(isPolicyMiddleware(null)).toBe(false);
    });
});

describe('guest-capable guards', () => {
    // "Guarded" and "requires an account" are different claims, and a guard
    // that stops being the second while staying the first is exactly the
    // change the unprotected-route check cannot see.
    test('a guard says for itself whether it admits a caller with no account', () => {
        const admitsGuests = markPolicyMiddleware(
            (req, res, next) => next(),
            { authentication: 'optional', guest: true }
        );
        const requiresAccount = markPolicyMiddleware(
            (req, res, next) => next(),
            { authentication: true }
        );

        expect(isGuestCapableMiddleware(admitsGuests)).toBe(true);
        expect(isGuestCapableMiddleware(requiresAccount)).toBe(false);
    });

    test('an unmarked handler claims nothing, whatever it is called', () => {
        expect(isGuestCapableMiddleware(function allowGuests(req, res, next) { next(); })).toBe(false);
        expect(isGuestCapableMiddleware(null)).toBe(false);
    });
});

describe('pinned policy', () => {
    // A permission grant that widens by accident is invisible in a diff of the
    // map alone; requiring the snapshot to be edited too makes it deliberate.
    test('each role holds exactly the permissions on record', () => {
        for (const [role, permissions] of Object.entries(snapshot.rolePermissions)) {
            expect(sorted(permissionsForRole(role))).toEqual(sorted(permissions));
        }
    });

    test('the snapshot covers every declared role', () => {
        expect(sorted(Object.keys(snapshot.rolePermissions))).toEqual(sorted(Object.values(ROLES)));
    });

    test('the administrative roles are the ones on record', () => {
        expect(sorted(ADMIN_ROLES)).toEqual(sorted(snapshot.adminRoles));
    });

    test('the public routes are the ones on record', () => {
        const declared = PUBLIC_ROUTES.map(({ method, path }) => `${method} ${path}`);
        expect(sorted(declared)).toEqual(sorted(snapshot.publicRoutes));
    });

    test('every public route carries a reason', () => {
        for (const route of PUBLIC_ROUTES) {
            expect(typeof route.reason).toBe('string');
            expect(route.reason.length).toBeGreaterThan(0);
        }
    });

    test('the allowlist matches on method as well as path', () => {
        expect(isPublicRoute('GET', '/api/products')).toBe(true);
        expect(isPublicRoute('get', '/api/products')).toBe(true);
        expect(isPublicRoute('DELETE', '/api/products')).toBe(false);
        expect(isPublicRoute('GET', '/api/orders')).toBe(false);
    });

    test('the routes reachable without an account are the ones on record', () => {
        const declared = GUEST_ROUTES.map(({ method, path }) => `${method} ${path}`);
        expect(sorted(declared)).toEqual(sorted(snapshot.guestRoutes));
    });

    test('every guest route carries a reason', () => {
        for (const route of GUEST_ROUTES) {
            expect(typeof route.reason).toBe('string');
            expect(route.reason.length).toBeGreaterThan(0);
        }
    });

    // Serving a guest is not the same as serving everybody: the cart routes
    // still decide which cart the caller reaches.
    test('a guest route is not thereby a public one', () => {
        expect(isGuestRoute('GET', '/api/cart')).toBe(true);
        expect(isPublicRoute('GET', '/api/cart')).toBe(false);
        expect(isGuestRoute('POST', '/api/cart')).toBe(false);
        expect(isGuestRoute('GET', '/api/orders')).toBe(false);
    });
});
