// backend/tests/routeAudit.test.js
//
// The audit is driven with routers built here rather than with the real ones:
// requiring the application's routers pulls in controllers, services and a
// connection pool, and the point of a structural check is that it needs none
// of that. `loadAuditedMounts` is therefore exercised only for its shape.

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

const express = require('express');

const {
    collectRoutes,
    collectMountedRoutes,
    findUnprotectedRoutes,
    findUndeclaredGuestRoutes,
    assertRoutesProtected,
    assertGuestRoutesDeclared,
    runStartupAudit
} = require('../middleware/routeAudit');
const { AUDITED_MOUNTS } = require('../config/routePolicy');
const { PERMISSIONS, authorize, markPolicyMiddleware } = require('../config/policy');

const ok = (req, res) => res.json({ success: true });
const guard = markPolicyMiddleware((req, res, next) => next(), { authentication: true });
const guestGuard = markPolicyMiddleware(
    (req, res, next) => next(),
    { authentication: 'optional', guest: true }
);

describe('collectRoutes', () => {
    test('reports every method registered on a path', () => {
        const router = express.Router();
        router.get('/things', ok);
        router.post('/things', ok);

        const routes = collectRoutes(router, '/api');

        expect(routes.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
            'GET /api/things',
            'POST /api/things'
        ]);
    });

    test('collapses the mount root rather than emitting a trailing slash', () => {
        const router = express.Router();
        router.get('/', ok);

        expect(collectRoutes(router, '/api/cart')[0].path).toBe('/api/cart');
    });

    test('keeps parameter syntax intact', () => {
        const router = express.Router();
        router.get('/:id/reviews/:reviewId', ok);

        expect(collectRoutes(router, '/api/products')[0].path)
            .toBe('/api/products/:id/reviews/:reviewId');
    });

    test('sees a guard attached to the route', () => {
        const router = express.Router();
        router.get('/orders', guard, ok);
        router.get('/catalog', ok);

        const [orders, catalog] = collectRoutes(router, '/api');

        expect(orders.isProtected).toBe(true);
        expect(catalog.isProtected).toBe(false);
    });

    // A router that guards everything once at the top is the common shape in
    // this codebase; reading route layers in isolation would report all of its
    // routes as wide open.
    test('sees a guard applied to the whole router', () => {
        const router = express.Router();
        router.use(guard);
        router.get('/conversations', ok);

        expect(collectRoutes(router, '/api/chat')[0].isProtected).toBe(true);
    });

    test('does not credit routes declared before the router-level guard', () => {
        const router = express.Router();
        router.get('/before', ok);
        router.use(guard);
        router.get('/after', ok);

        const [before, after] = collectRoutes(router, '/api');

        expect(before.isProtected).toBe(false);
        expect(after.isProtected).toBe(true);
    });

    test('is not fooled by an ordinary handler', () => {
        const router = express.Router();
        router.get('/orders', function checkAccess(req, res, next) { next(); }, ok);

        expect(collectRoutes(router, '/api')[0].isProtected).toBe(false);
    });

    test('counts a permission gate as a policy', () => {
        const router = express.Router();
        router.post('/products', authorize(PERMISSIONS.CATALOG_MANAGE), ok);

        expect(collectRoutes(router, '/api')[0].isProtected).toBe(true);
    });

    test('returns nothing for something that is not a router', () => {
        expect(collectRoutes(undefined)).toEqual([]);
        expect(collectRoutes({})).toEqual([]);
    });
});

describe('findUnprotectedRoutes', () => {
    const buildMounts = () => {
        const products = express.Router();
        products.get('/', ok);
        products.get('/:id', ok);
        products.post('/', guard, ok);

        const orders = express.Router();
        orders.get('/:id', ok);

        return [
            { basePath: '/api/products', router: products },
            { basePath: '/api/orders', router: orders }
        ];
    };

    test('flags a guarded-by-nothing route that nobody declared public', () => {
        expect(findUnprotectedRoutes(buildMounts())).toEqual([
            { method: 'GET', path: '/api/orders/:id' }
        ]);
    });

    test('stays quiet about routes on the public allowlist', () => {
        const unprotected = findUnprotectedRoutes(buildMounts());

        expect(unprotected).not.toContainEqual({ method: 'GET', path: '/api/products' });
        expect(unprotected).not.toContainEqual({ method: 'GET', path: '/api/products/:id' });
    });

    test('handles an empty mount table', () => {
        expect(findUnprotectedRoutes([])).toEqual([]);
        expect(collectMountedRoutes(undefined)).toEqual([]);
    });
});

describe('findUndeclaredGuestRoutes', () => {
    // A guard that admits anonymous callers still satisfies the unprotected
    // check, so widening one is invisible there. This is the check that sees
    // it.
    test('flags a route that admits guests without that being declared', () => {
        const router = express.Router();
        router.use(guestGuard);
        router.get('/wishlists', ok);

        expect(findUndeclaredGuestRoutes([{ basePath: '/api', router }])).toEqual([
            { method: 'GET', path: '/api/wishlists' }
        ]);
    });

    test('stays quiet about the guest routes on record', () => {
        const router = express.Router();
        router.use(guestGuard);
        router.get('/', ok);
        router.post('/add', ok);

        expect(findUndeclaredGuestRoutes([{ basePath: '/api/cart', router }])).toEqual([]);
    });

    test('says nothing about a route that requires an account', () => {
        const router = express.Router();
        router.use(guard);
        router.get('/:id', ok);

        expect(findUndeclaredGuestRoutes([{ basePath: '/api/orders', router }])).toEqual([]);
    });

    test('names every offender at once', () => {
        const router = express.Router();
        router.use(guestGuard);
        router.get('/:id', ok);
        router.delete('/:id', ok);

        let message = '';
        try {
            assertGuestRoutesDeclared([{ basePath: '/api/orders', router }]);
        } catch (error) {
            message = error.message;
        }

        expect(message).toContain('GET /api/orders/:id');
        expect(message).toContain('DELETE /api/orders/:id');
        expect(message).toContain('routePolicy');
    });
});

describe('assertRoutesProtected', () => {
    test('passes when every route declares a policy', () => {
        const router = express.Router();
        router.use(guard);
        router.get('/', ok);

        expect(() => assertRoutesProtected([{ basePath: '/api/cart', router }])).not.toThrow();
    });

    // One bootstrap failure per missing guard would be a miserable way to find
    // out there are four of them.
    test('names every offender at once', () => {
        const router = express.Router();
        router.get('/:id', ok);
        router.delete('/:id', ok);

        let message = '';
        try {
            assertRoutesProtected([{ basePath: '/api/orders', router }]);
        } catch (error) {
            message = error.message;
        }

        expect(message).toContain('GET /api/orders/:id');
        expect(message).toContain('DELETE /api/orders/:id');
        expect(message).toContain('routePolicy');
    });
});

describe('runStartupAudit', () => {
    const buildLeakyMount = () => {
        const router = express.Router();
        router.get('/:id', ok);
        return [{ basePath: '/api/orders', router }];
    };

    test('does nothing unless the flag is set', () => {
        expect(runStartupAudit({ mode: undefined, mounts: buildLeakyMount() })).toEqual([]);
        expect(runStartupAudit({ mode: 'off', mounts: buildLeakyMount() })).toEqual([]);
    });

    test('reports without blocking in warn mode', () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        const unprotected = runStartupAudit({ mode: 'warn', mounts: buildLeakyMount() });

        expect(unprotected).toEqual([{ method: 'GET', path: '/api/orders/:id' }]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('/api/orders/:id'));

        console.warn.mockRestore();
    });

    test('refuses to start in enforce mode', () => {
        expect(() => runStartupAudit({ mode: 'enforce', mounts: buildLeakyMount() })).toThrow();
    });

    test('refuses to start on an undeclared guest route too', () => {
        const router = express.Router();
        router.use(guestGuard);
        router.get('/:id', ok);

        expect(() => runStartupAudit({
            mode: 'enforce',
            mounts: [{ basePath: '/api/orders', router }]
        })).toThrow(/without an account/i);
    });

    test('reports an undeclared guest route in warn mode', () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        const router = express.Router();
        router.use(guestGuard);
        router.get('/:id', ok);

        runStartupAudit({ mode: 'warn', mounts: [{ basePath: '/api/orders', router }] });

        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('without an account')
        );

        console.warn.mockRestore();
    });
});

describe('audit registry', () => {
    test('every mount names a base path and a module', () => {
        expect(AUDITED_MOUNTS.length).toBeGreaterThan(0);

        for (const mount of AUDITED_MOUNTS) {
            expect(mount.basePath.startsWith('/')).toBe(true);
            expect(mount.basePath.endsWith('/')).toBe(false);
            expect(mount.modulePath.startsWith('../routes/')).toBe(true);
        }
    });

    test('no base path is registered twice', () => {
        const basePaths = AUDITED_MOUNTS.map((mount) => mount.basePath);
        expect(new Set(basePaths).size).toBe(basePaths.length);
    });
});
