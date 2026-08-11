// backend/tests/pincodeRoutes.test.js
//
// The pincode API (#1496).
//
// The router was five lines and served one of the controller's four handlers.
// `checkMultiplePincodes`, `searchPincodes` and `clearPincodeCache` were all
// exported and unreachable -- including the only one that could clear a cache,
// which is why a corrected pincode could take a day to reach the product page.
//
// The cache-clear tests are the ones that matter. Its handler used to guard
// itself with
//
//     if (req.user && !hasPermission(req.user, PERMISSIONS.CACHE_MANAGE))
//
// which refuses a signed-in non-admin and lets a caller with no `req.user`
// fall straight through to `flushAll()`. That was latent only because the
// route was not mounted -- and mounting it, which is the obvious fix for the
// paragraph above, would have published an unauthenticated cache flush behind
// a message reading "Only admins can clear pincode cache".

let mockUser = null;

jest.mock('../middleware/authMiddleware', () => {
    const stub = (req, res, next) => {
        if (!mockUser) {
            return res
                .status(401)
                .json({ success: false, message: 'Authentication required' });
        }
        req.user = mockUser;
        next();
    };
    stub.optionalAuth = (req, res, next) => {
        if (mockUser) req.user = mockUser;
        next();
    };
    return stub;
});

// Real rate limiting would make these tests order-dependent for no benefit,
// and the limiter has its own coverage. That it is *applied* is asserted
// separately, against the source, at the bottom of this file.
jest.mock('../middleware/rateLimiter', () => ({
    pincodeLookupLimiter: (req, res, next) => next()
}));

jest.mock('../models/Pincode', () => ({
    findByCode: jest.fn(),
    search: jest.fn()
}));

const express = require('express');
const request = require('supertest');

const Pincode = require('../models/Pincode');
const pincodeCache = require('../services/pincodeCache');
const pincodeRoutes = require('../routes/pincodeRoutes');

const app = express();
app.use(express.json());
app.use('/api/pincode', pincodeRoutes);

const ROW = {
    pincode: '110001',
    city: 'New Delhi',
    state: 'Delhi',
    country: 'India',
    eta_days: 2,
    is_active: 1,
    delivery_charges: 49,
    cod_available: 1
};

const ADMIN = { id: 'admin-1', role: 'admin' };
const SHOPPER = { id: 'user-1', role: 'user' };

beforeEach(() => {
    jest.clearAllMocks();
    pincodeCache.flush();
    mockUser = null;
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    console.log.mockRestore();
});

describe('GET /api/pincode/check/:pincode', () => {
    test('answers with the delivery charge and COD availability', async () => {
        Pincode.findByCode.mockResolvedValue([ROW]);

        const res = await request(app).get('/api/pincode/check/110001');

        expect(res.status).toBe(200);
        expect(res.body.deliverable).toBe(true);
        expect(res.body.delivery_charges).toBe(49);
        expect(res.body.cod_available).toBe(true);
    });

    test('keeps the top-level fields the frontend reads', async () => {
        Pincode.findByCode.mockResolvedValue([ROW]);

        const res = await request(app).get('/api/pincode/check/110001');

        // frontend/scripts/pincode.js reads `data.message` and
        // `data.deliverable` off the top level of the response. Both shapes
        // are served until that caller moves.
        expect(typeof res.body.message).toBe('string');
        expect(res.body.data.deliverable).toBe(true);
    });

    test('is public', async () => {
        Pincode.findByCode.mockResolvedValue([]);

        const res = await request(app).get('/api/pincode/check/110001');

        expect(res.status).toBe(200);
    });

    test('rejects a malformed pincode', async () => {
        const res = await request(app).get('/api/pincode/check/abc');

        expect(res.status).toBe(400);
        expect(Pincode.findByCode).not.toHaveBeenCalled();
    });

    test('serves the second identical request from the cache', async () => {
        Pincode.findByCode.mockResolvedValue([ROW]);

        const first = await request(app).get('/api/pincode/check/110001');
        const second = await request(app).get('/api/pincode/check/110001');

        expect(first.body.cached).toBe(false);
        expect(second.body.cached).toBe(true);
        expect(Pincode.findByCode).toHaveBeenCalledTimes(1);
    });
});

describe('GET /api/pincode/search', () => {
    test('was exported and unroutable; it answers now', async () => {
        Pincode.search.mockResolvedValue([ROW]);

        const res = await request(app).get('/api/pincode/search?query=Delhi');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.total).toBe(1);
    });

    test('refuses a query under three characters', async () => {
        const res = await request(app).get('/api/pincode/search?query=De');

        expect(res.status).toBe(400);
        expect(Pincode.search).not.toHaveBeenCalled();
    });
});

describe('POST /api/pincode/check-multiple', () => {
    test('was exported and unroutable; it answers now', async () => {
        Pincode.findByCode.mockResolvedValue([ROW]);

        const res = await request(app)
            .post('/api/pincode/check-multiple')
            .send({ pincodes: ['110001', '400001'] });

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
    });

    test('reports a bad entry without failing the whole batch', async () => {
        Pincode.findByCode.mockResolvedValue([ROW]);

        const res = await request(app)
            .post('/api/pincode/check-multiple')
            .send({ pincodes: ['110001', 'nonsense'] });

        expect(res.status).toBe(200);
        expect(res.body.data[1].valid).toBe(false);
    });

    test('caps the batch', async () => {
        const res = await request(app)
            .post('/api/pincode/check-multiple')
            .send({ pincodes: Array.from({ length: 200 }, (_, i) => String(100000 + i)) });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Maximum/);
    });

    test('rejects a body that is not an array', async () => {
        const res = await request(app)
            .post('/api/pincode/check-multiple')
            .send({ pincodes: '110001' });

        expect(res.status).toBe(400);
    });
});

describe('POST /api/pincode/cache/clear', () => {
    test('refuses an anonymous caller', async () => {
        // The regression. The old in-handler check was
        // `req.user && !hasPermission(...)`, so no `req.user` meant no check
        // at all and the cache was flushed.
        mockUser = null;

        const res = await request(app).post('/api/pincode/cache/clear');

        expect(res.status).toBe(401);
    });

    test('refuses a signed-in shopper', async () => {
        mockUser = SHOPPER;

        const res = await request(app).post('/api/pincode/cache/clear');

        expect(res.status).toBe(403);
    });

    test('lets an admin through and reports what it dropped', async () => {
        mockUser = ADMIN;
        pincodeCache.set(pincodeCache.NAMESPACE_VERDICT, '110001', { deliverable: true });

        const res = await request(app).post('/api/pincode/cache/clear');

        expect(res.status).toBe(200);
        expect(res.body.data.cleared).toBe(1);
        expect(pincodeCache.get(pincodeCache.NAMESPACE_VERDICT, '110001')).toBeUndefined();
    });

    test('the anonymous refusal happens before anything is flushed', async () => {
        mockUser = null;
        pincodeCache.set(pincodeCache.NAMESPACE_VERDICT, '110001', { deliverable: true });

        await request(app).post('/api/pincode/cache/clear');

        expect(pincodeCache.get(pincodeCache.NAMESPACE_VERDICT, '110001')).toBeDefined();
    });
});

describe('what the router applies', () => {
    const fs = require('fs');
    const path = require('path');

    const source = fs.readFileSync(
        path.join(__dirname, '..', 'routes', 'pincodeRoutes.js'),
        'utf8'
    );

    test('the limiter is applied at the router, not per route', () => {
        // Router-level so a route added later cannot be missing it. These are
        // unauthenticated endpoints over a table of every area the store
        // serves; the limiter is the only thing bounding a full scan.
        expect(source).toMatch(/router\.use\(pincodeLookupLimiter\)/);
    });

    test('the cache clear is behind both a login and a permission', () => {
        expect(source).toMatch(/authMiddleware,\s*\n\s*authorize\(PERMISSIONS\.CACHE_MANAGE\)/);
    });

    test('the controller keeps no hand-rolled limiter', () => {
        const controller = fs.readFileSync(
            path.join(__dirname, '..', 'controllers', 'pincodeController.js'),
            'utf8'
        );

        // It was a module-level `Map` that inserted one entry per client
        // address and never removed one.
        expect(controller).not.toMatch(/const rateLimiter = new Map\(\)/);
        expect(controller).not.toMatch(/req\.connection\.remoteAddress/);
    });

    test('every handler the controller exports has a route', () => {
        const handlers = [
            'checkPincode',
            'checkMultiplePincodes',
            'searchPincodes',
            'clearPincodeCache'
        ];

        const unrouted = handlers.filter(
            (handler) => source.split(handler).length - 1 < 2
        );

        expect(unrouted).toEqual([]);
    });
});
