// backend/tests/moduleExports.test.js
//
// Regression tests for the non-syntax defects fixed alongside the parse
// errors: handlers that resolved to `undefined` at mount time, route ordering
// that shadowed an endpoint, unclamped limits, a leaked interval, and an
// environment validator that rejected the documented setup.
//
// These are all reachable without a live database.

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '3306';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_characters_long';

describe('approvalController (#1293)', () => {
    const controller = require('../controllers/approvalController');

    // routes/approvalRoutes.js destructures exactly these. Any one of them
    // being undefined throws at mount time, not at request time.
    const HANDLERS = [
        'requestApproval',
        'approveTransaction',
        'rejectTransaction',
        'getPendingApprovals',
        'addCheckpoint',
        'verifyCheckpoint',
        'escalateApproval',
    ];

    test.each(HANDLERS)('exports %s as a function', (name) => {
        expect(typeof controller[name]).toBe('function');
    });

    test('exports each handler exactly once', () => {
        // The file previously held three copies of every handler, which
        // disagreed on the response envelope.
        const own = Object.keys(controller);
        expect(own.sort()).toEqual([...HANDLERS].sort());
    });

    test('approvalRoutes mounts without throwing', () => {
        expect(() => require('../routes/approvalRoutes')).not.toThrow();
    });

    /**
     * Minimal Express response double.
     */
    function mockRes() {
        const res = {
            statusCode: null,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(payload) { this.body = payload; return this; },
        };
        return res;
    }

    test('rejects an unauthenticated request with 401, not a TypeError', async () => {
        const res = mockRes();
        // No req.user: the previous implementation dereferenced req.user.id.
        await controller.getPendingApprovals({ params: {}, body: {} }, res);

        expect(res.statusCode).toBe(401);
        expect(res.body.success).toBe(false);
    });

    test('rejects a missing transactionId with 400', async () => {
        const res = mockRes();
        await controller.requestApproval({ user: { id: 'u1' }, body: {} }, res);

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/transactionId/i);
    });

    test('rejects a non-positive requiredApprovals with 400', async () => {
        const res = mockRes();
        await controller.requestApproval(
            { user: { id: 'u1' }, body: { transactionId: 't1', requiredApprovals: 0 } },
            res
        );

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/positive integer/i);
    });

    test('rejects a blank approvalId with 400', async () => {
        const res = mockRes();
        await controller.approveTransaction(
            { user: { id: 'u1' }, params: { approvalId: '   ' }, body: {} },
            res
        );

        expect(res.statusCode).toBe(400);
    });

    test('responses use the { success, message } envelope', async () => {
        const res = mockRes();
        await controller.escalateApproval(
            { user: { id: 'u1' }, params: { approvalId: 'a1' }, body: {} },
            res
        );

        expect(res.body).toHaveProperty('success');
        expect(res.body).toHaveProperty('message');
        // The old copies returned an `error` field carrying raw error.message.
        expect(res.body).not.toHaveProperty('error');
    });
});

describe('wishlist routes and controller (#1295)', () => {
    const controller = require('../controllers/wishlistController');

    test('admin handlers survive module.exports', () => {
        // Previously assigned to `exports.*` and then discarded by
        // `module.exports = wishlistController`, so Express mounted undefined.
        expect(typeof controller.getAdminUserWishlist).toBe('function');
        expect(typeof controller.getWishlistStats).toBe('function');
    });

    test('router loads and mounts every route', () => {
        const router = require('../routes/wishlistRoutes');
        expect(typeof router).toBe('function');

        const routes = router.stack.filter((layer) => layer.route);
        expect(routes.length).toBeGreaterThan(10);
    });

    test('/admin/stats/all is registered before /admin/:userId', () => {
        // Express matches in registration order. The other way round, the
        // stats endpoint is captured as userId = "stats".
        const router = require('../routes/wishlistRoutes');
        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => layer.route.path);

        expect(paths).toContain('/admin/stats/all');
        expect(paths).toContain('/admin/:userId');
        expect(paths.indexOf('/admin/stats/all')).toBeLessThan(paths.indexOf('/admin/:userId'));
    });

    test('DELETE literal paths are registered before /:productId', () => {
        const router = require('../routes/wishlistRoutes');
        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => layer.route.path);

        expect(paths.indexOf('/clear/all')).toBeLessThan(paths.indexOf('/:productId'));
        expect(paths.indexOf('/cache')).toBeLessThan(paths.indexOf('/:productId'));
    });

    test('share token constants exist and match the generated format', () => {
        const {
            SHARE_TOKEN_MAX_LENGTH,
            SHARE_TOKEN_REGEX,
            MAX_WISHLIST_SYNC_LIMIT,
        } = require('../config/constants');

        // generateShareLink uses crypto.randomBytes(32).toString('hex').
        expect(SHARE_TOKEN_MAX_LENGTH).toBe(64);
        expect(MAX_WISHLIST_SYNC_LIMIT).toBeGreaterThan(0);

        expect(SHARE_TOKEN_REGEX.test('a'.repeat(64))).toBe(true);
        expect(SHARE_TOKEN_REGEX.test('A'.repeat(64))).toBe(false); // hex is lowercase
        expect(SHARE_TOKEN_REGEX.test('a'.repeat(63))).toBe(false);
        expect(SHARE_TOKEN_REGEX.test('zz')).toBe(false);
    });
});

describe('recommendationService (#1294)', () => {
    const service = require('../services/recommendationService');

    afterAll(() => {
        service.shutdown();
    });

    test('exports a single initialized instance', () => {
        expect(service.constructor.name).toBe('RecommendationService');
        expect(service.initialized).toBe(true);
    });

    test('exposes the class API, not the removed object API', () => {
        expect(typeof service.getRecommendations).toBe('function');
        expect(typeof service.getTrendingProducts).toBe('function');
        expect(typeof service.getRelatedProducts).toBe('function');
        expect(typeof service.clearCache).toBe('function');
    });

    test('retains the cleanup timer so shutdown can clear it', () => {
        // initialize() previously created a setInterval and dropped the handle,
        // keeping the event loop alive with no way to stop it.
        expect(service.cleanupTimer).not.toBeNull();

        service.shutdown();
        expect(service.cleanupTimer).toBeNull();
        expect(service.initialized).toBe(false);

        service.initialize();
        expect(service.cleanupTimer).not.toBeNull();
    });
});

describe('envValidator url handling', () => {
    const validator = require('validator');

    test('accepts the FRONTEND_URL the docs tell contributors to use', () => {
        // validator.isURL() defaults require a TLD, so http://localhost:3000
        // was rejected and validateEnv() called process.exit(1).
        expect(validator.isURL('http://localhost:3000', { require_tld: false })).toBe(true);
        expect(validator.isURL('http://localhost:5500', { require_tld: false })).toBe(true);
    });

    test('still rejects values that are not URLs', () => {
        expect(validator.isURL('not a url', { require_tld: false })).toBe(false);
        expect(validator.isURL('', { require_tld: false })).toBe(false);
    });
});

describe('orderController (#1444)', () => {
    const fs = require('fs');
    const path = require('path');

    const controller = require('../controllers/orderController');
    const routesSource = fs.readFileSync(
        path.join(__dirname, '..', 'routes', 'orderRoutes.js'),
        'utf8'
    );

    /**
     * Every `orderController.<name>` the router reaches for.
     *
     * Derived from the source rather than hard-coded, so a handler added to a
     * route tomorrow is covered without anyone remembering to list it here.
     */
    const referenced = Array.from(
        new Set(
            Array.from(routesSource.matchAll(/orderController\.(\w+)/g), (m) => m[1])
        )
    ).sort();

    test('the router references at least the handlers we know about', () => {
        // A guard on the regex itself: if it silently stopped matching, every
        // assertion below would pass over an empty list.
        expect(referenced).toContain('createOrder');
        expect(referenced).toContain('getRecoveryReport');
        expect(referenced.length).toBeGreaterThan(10);
    });

    // getRecoveryReport was defined in the controller but missing from
    // module.exports, so it resolved to `undefined` and Express threw
    // "argument handler must be a function" while orderRoutes.js was still
    // being required. The server did not boot at all.
    test.each(referenced)('exports %s as a function', (name) => {
        expect(typeof controller[name]).toBe('function');
    });

    test('orderRoutes mounts without throwing', () => {
        expect(() => require('../routes/orderRoutes')).not.toThrow();
    });
});
