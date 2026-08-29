// backend/tests/adminCatalogRoutes.test.js
//
// The endpoints the admin dashboard calls (#1697).
//
// #1666 repointed frontend/scripts/admin.js at /api/admin/verify,
// /api/admin/products and /api/admin/orders. None of them were mounted, so
// verifyAdminAccess() -- the first thing that runs on admin.html -- got a 404,
// read it as "not an admin", and redirected. Nothing in the suite noticed,
// because nothing in the suite knew which paths the client calls.
//
// So this pins both ends. The first describe reads the paths out of admin.js
// and asserts the router answers them; the rest cover the behaviour of the
// handlers themselves. Without the first, the endpoints could be renamed and
// the dashboard would break again with every test still green.

let mockUser = { id: '55555555-5555-4555-8555-555555555555', role: 'admin' };

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

// Every db.query the router makes lands here. `adminMiddleware` re-reads the
// user before it looks at the role, so the users lookup is answered from
// `mockUser`; everything else is driven per-test through `mockQueryHandler`.
let mockQueryHandler = () => [[]];

jest.mock('../config/db', () => ({
    query: jest.fn(async (sql, params) => {
        if (/FROM users/i.test(sql) && mockUser && params?.[0] === mockUser.id) {
            return [
                [
                    {
                        id: mockUser.id,
                        email: `${mockUser.role}@example.test`,
                        name: mockUser.role,
                        role: mockUser.role,
                        is_active: 1,
                        is_verified: 1
                    }
                ]
            ];
        }
        return mockQueryHandler(sql, params);
    }),
    getConnection: jest.fn()
}));

// Real rate limiting would make these order-dependent for no benefit.
jest.mock('../middleware/authLimiter', () => ({
    adminLimiter: (req, res, next) => next(),
    authLimiter: (req, res, next) => next(),
    contactFormLimiter: (req, res, next) => next()
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const db = require('../config/db');
const adminRoutes = require('../routes/adminRoutes');
const adminCatalog = require('../controllers/adminCatalogController');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);

const ADMIN = { id: '55555555-5555-4555-8555-555555555555', role: 'admin' };
const SUPERADMIN = { id: '77777777-7777-4777-8777-777777777777', role: 'superadmin' };
const SHOPPER = { id: '66666666-6666-4666-8666-666666666666', role: 'user' };

/** Answer a COUNT(*) with `total`, and the row query with `rows`. */
const respondWith = (rows, total = rows.length) => (sql) => {
    if (/COUNT\(\*\)/i.test(sql)) return [[{ total }]];
    return [rows];
};

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = ADMIN;
    mockQueryHandler = () => [[]];
});

describe('the client and the router agree on the paths', () => {
    // Read straight from admin.js so a rename on either side shows up here.
    const adminJs = fs.readFileSync(
        path.join(__dirname, '..', '..', 'frontend', 'scripts', 'admin.js'),
        'utf8'
    );

    test('admin.js still calls the /admin/* surface', () => {
        // Guards the guard: if admin.js is ever repointed back at /products,
        // the cases below stop describing anything real.
        expect(adminJs).toMatch(/apiRequest\(\s*"\/admin\/verify"/);
        expect(adminJs).toMatch(/\/admin\/products/);
        expect(adminJs).toMatch(/\/admin\/orders/);
    });

    test.each([
        ['get', '/api/admin/verify'],
        ['get', '/api/admin/products?page=1&limit=10'],
        ['get', '/api/admin/orders?page=1&limit=10'],
    ])('%s %s is mounted', async (method, url) => {
        const res = await request(app)[method](url);

        // Anything but 404. The bug was that these did not exist at all.
        expect(res.status).not.toBe(404);
    });

    test('PATCH /api/admin/orders/:id/status is mounted', async () => {
        mockQueryHandler = () => [[{ id: 'order-1', status: 'pending' }]];

        const res = await request(app)
            .patch('/api/admin/orders/order-1/status')
            .send({ status: 'shipped' });

        expect(res.status).not.toBe(404);
    });
});

describe('GET /api/admin/verify', () => {
    test('answers with the admin identity', async () => {
        const res = await request(app).get('/api/admin/verify');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.user).toMatchObject({ id: ADMIN.id, role: 'admin' });
    });

    test('accepts superadmin', async () => {
        // admin.js accepts both roles client-side. The server has to agree, or
        // a superadmin is bounced by an endpoint whose whole job is to say yes.
        mockUser = SUPERADMIN;

        const res = await request(app).get('/api/admin/verify');

        expect(res.status).toBe(200);
        expect(res.body.user.role).toBe('superadmin');
    });

    test('refuses a shopper', async () => {
        mockUser = SHOPPER;

        const res = await request(app).get('/api/admin/verify');

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    test('refuses an anonymous caller', async () => {
        mockUser = null;

        const res = await request(app).get('/api/admin/verify');

        expect(res.status).toBe(401);
    });
});

describe('GET /api/admin/products', () => {
    const PRODUCT = {
        id: 'p-1',
        name: 'Draft Hoodie',
        sku: 'HD-1',
        price: 1999,
        stock: 4,
        status: 'draft',
        deleted_at: null
    };

    test('returns products under the key admin.js reads', async () => {
        mockQueryHandler = respondWith([PRODUCT], 1);

        const res = await request(app).get('/api/admin/products');

        expect(res.status).toBe(200);
        // admin.js does `AppUtils.safeArray(productsRes.products)`.
        expect(res.body.products).toHaveLength(1);
        expect(res.body.data.products).toHaveLength(1);
        expect(res.body.pagination).toMatchObject({ total: 1, page: 1 });
    });

    test('does not restrict the list to publicly visible products', async () => {
        // The whole reason this is not just /api/products. An operator has to
        // see drafts, inactive and archived rows -- they are the ones that need
        // attention -- so the list must not carry the public status filter.
        mockQueryHandler = respondWith([PRODUCT], 1);

        await request(app).get('/api/admin/products');

        const listSql = db.query.mock.calls
            .map(([sql]) => sql)
            .find((sql) => /FROM products/i.test(sql) && !/COUNT\(\*\)/i.test(sql));

        expect(listSql).toBeDefined();
        expect(listSql).not.toMatch(/status\s+IN/i);
    });

    test('hides soft-deleted rows by default and shows them on request', async () => {
        mockQueryHandler = respondWith([], 0);

        await request(app).get('/api/admin/products');
        const defaultSql = db.query.mock.calls
            .map(([sql]) => sql)
            .find((sql) => /FROM products/i.test(sql));
        expect(defaultSql).toMatch(/deleted_at IS NULL/i);

        jest.clearAllMocks();

        await request(app).get('/api/admin/products?includeDeleted=true');
        const inclusiveSql = db.query.mock.calls
            .map(([sql]) => sql)
            .find((sql) => /FROM products/i.test(sql));
        expect(inclusiveSql).not.toMatch(/deleted_at IS NULL/i);
    });

    test('escapes LIKE wildcards in the search term', async () => {
        // "50%" is a product name, not a wildcard. Unescaped, it matches the
        // whole catalogue.
        mockQueryHandler = respondWith([], 0);

        await request(app).get('/api/admin/products?search=50%25');

        const call = db.query.mock.calls.find(([sql]) => /name LIKE/i.test(sql));
        expect(call).toBeDefined();
        expect(call[1]).toContain('%50\\%%');
    });

    test('ignores a status filter the column does not accept', async () => {
        mockQueryHandler = respondWith([], 0);

        await request(app).get('/api/admin/products?status=bogus');

        const call = db.query.mock.calls.find(
            ([sql]) => /FROM products/i.test(sql) && !/COUNT/i.test(sql)
        );
        expect(call[0]).not.toMatch(/status = \?/);
    });

    test('caps the page size', async () => {
        mockQueryHandler = respondWith([], 0);

        await request(app).get('/api/admin/products?limit=100000');

        const call = db.query.mock.calls.find(
            ([sql]) => /FROM products/i.test(sql) && /LIMIT/i.test(sql)
        );
        expect(call[1]).toContain(adminCatalog.MAX_PAGE_SIZE);
    });

    test('refuses a shopper', async () => {
        mockUser = SHOPPER;

        const res = await request(app).get('/api/admin/products');

        expect(res.status).toBe(403);
    });
});

describe('GET /api/admin/orders', () => {
    const ORDER = {
        id: 'o-1',
        order_number: 'ORD-1',
        customer_name: 'Asha Menon',
        status: 'pending',
        total: 2499,
        item_count: 2
    };

    test('returns orders under the key admin.js reads', async () => {
        mockQueryHandler = respondWith([ORDER], 1);

        const res = await request(app).get('/api/admin/orders');

        expect(res.status).toBe(200);
        expect(res.body.orders).toHaveLength(1);
        expect(res.body.data.orders).toHaveLength(1);
    });

    test('is not scoped to the calling admin', async () => {
        // The other reason this is not just /api/orders: that route filters on
        // req.user.id, which would show an admin their own shopping.
        mockQueryHandler = respondWith([ORDER], 1);

        await request(app).get('/api/admin/orders');

        const listSql = db.query.mock.calls
            .map(([sql]) => sql)
            .find((sql) => /FROM orders/i.test(sql) && !/COUNT\(\*\)/i.test(sql));

        expect(listSql).not.toMatch(/user_id\s*=\s*\?/i);
    });

    test('refuses a shopper', async () => {
        mockUser = SHOPPER;

        const res = await request(app).get('/api/admin/orders');

        expect(res.status).toBe(403);
    });
});

describe('PATCH /api/admin/orders/:id/status', () => {
    /** Answer the order lookup with `status`, and accept the writes. */
    const orderAt = (status) => (sql) => {
        if (/SELECT id, status FROM orders/i.test(sql)) {
            return [[{ id: 'o-1', status }]];
        }
        return [{ affectedRows: 1 }];
    };

    test('moves an order forward', async () => {
        mockQueryHandler = orderAt('pending');

        const res = await request(app)
            .patch('/api/admin/orders/o-1/status')
            .send({ status: 'shipped' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ oldStatus: 'pending', newStatus: 'shipped' });

        const update = db.query.mock.calls.find(([sql]) => /UPDATE orders/i.test(sql));
        expect(update[1]).toEqual(['shipped', 'o-1']);
    });

    test('writes an audit row', async () => {
        mockQueryHandler = orderAt('pending');

        await request(app).patch('/api/admin/orders/o-1/status').send({ status: 'processing' });

        const log = db.query.mock.calls.find(([sql]) => /order_status_logs/i.test(sql));
        expect(log[1]).toEqual(['o-1', 'pending', 'processing', ADMIN.id]);
    });

    test('still succeeds when the audit table is missing', async () => {
        // order_status_logs is not in every environment's schema. Losing the
        // log entry is worth less than refusing a change the operator made.
        mockQueryHandler = (sql) => {
            if (/SELECT id, status FROM orders/i.test(sql)) return [[{ id: 'o-1', status: 'pending' }]];
            if (/order_status_logs/i.test(sql)) {
                const error = new Error("Table 'shop.order_status_logs' doesn't exist");
                error.code = 'ER_NO_SUCH_TABLE';
                throw error;
            }
            return [{ affectedRows: 1 }];
        };

        const res = await request(app)
            .patch('/api/admin/orders/o-1/status')
            .send({ status: 'shipped' });

        expect(res.status).toBe(200);
    });

    test.each(adminCatalog.ORDER_STATUSES)('accepts %s', async (status) => {
        mockQueryHandler = orderAt('pending');

        const res = await request(app)
            .patch('/api/admin/orders/o-1/status')
            .send({ status });

        expect(res.status).toBe(200);
    });

    test('refuses a status outside the list', async () => {
        mockQueryHandler = orderAt('pending');

        const res = await request(app)
            .patch('/api/admin/orders/o-1/status')
            .send({ status: 'refunded' });

        expect(res.status).toBe(400);
        expect(db.query.mock.calls.some(([sql]) => /UPDATE orders/i.test(sql))).toBe(false);
    });

    test('refuses to move a cancelled order', async () => {
        mockQueryHandler = orderAt('cancelled');

        const res = await request(app)
            .patch('/api/admin/orders/o-1/status')
            .send({ status: 'processing' });

        expect(res.status).toBe(409);
    });

    test('refuses to move a delivered order backwards', async () => {
        mockQueryHandler = orderAt('delivered');

        const res = await request(app)
            .patch('/api/admin/orders/o-1/status')
            .send({ status: 'processing' });

        expect(res.status).toBe(409);
    });

    test('allows a delivered order to be cancelled', async () => {
        // That is a return, and it is a real thing an operator does.
        mockQueryHandler = orderAt('delivered');

        const res = await request(app)
            .patch('/api/admin/orders/o-1/status')
            .send({ status: 'cancelled' });

        expect(res.status).toBe(200);
    });

    test('treats a no-op change as success without writing', async () => {
        // The dropdown fires `change` on re-selection of the same value.
        mockQueryHandler = orderAt('shipped');

        const res = await request(app)
            .patch('/api/admin/orders/o-1/status')
            .send({ status: 'shipped' });

        expect(res.status).toBe(200);
        expect(db.query.mock.calls.some(([sql]) => /UPDATE orders/i.test(sql))).toBe(false);
    });

    test('404s an unknown order', async () => {
        mockQueryHandler = () => [[]];

        const res = await request(app)
            .patch('/api/admin/orders/nope/status')
            .send({ status: 'shipped' });

        expect(res.status).toBe(404);
    });

    test('refuses a shopper', async () => {
        mockUser = SHOPPER;

        const res = await request(app)
            .patch('/api/admin/orders/o-1/status')
            .send({ status: 'cancelled' });

        expect(res.status).toBe(403);
    });
});

describe('the status list matches the order service', () => {
    test('same statuses, same order', () => {
        // order.service.js#updateOrderStatusService keeps its own copy. If the
        // two drift, the dashboard offers a status the service will reject.
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'services', 'order.service.js'),
            'utf8'
        );

        const match = source.match(/const validStatuses = \[([^\]]*)\]/);
        expect(match).not.toBeNull();

        const serviceStatuses = match[1]
            .split(',')
            .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);

        expect([...adminCatalog.ORDER_STATUSES]).toEqual(serviceStatuses);
    });
});
