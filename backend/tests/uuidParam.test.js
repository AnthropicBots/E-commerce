// backend/tests/uuidParam.test.js
//
// Regression tests for #1443.
//
// `products.id` and `orders.id` are CHAR(36) UUIDs, and both routers guarded
// `:id` with `parseInt`. That is not a weaker check than a UUID check -- it is
// a differently-wrong one, and which way it went depended on nothing but the
// first character of the key:
//
//     parseInt("550e8400-…") === 550   -> truthy -> the request went through
//     parseInt("f47ac10b-…") === NaN   -> falsy  -> 400 Invalid product ID
//
// Six of the sixteen hex digits are letters, so roughly 37% of every product
// and every order was unreachable by id, and the other 63% got past a guard
// that had validated nothing.
//
// The tests below run the real routers through a real Express app. No database
// is touched: each route is asserted only to have got *past* the param guard,
// which is the layer under test.

const express = require('express');
const request = require('supertest');

const uuidParam = require('../middleware/uuidParam');

// One UUID starting with a digit and one starting with a letter. The whole
// defect lives in the difference between these two.
const UUID_LEADING_DIGIT = '550e8400-e29b-41d4-a716-446655440000';
const UUID_LEADING_LETTER = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('uuidParam', () => {
    /**
     * Minimal app with the guard wired the way a router wires it.
     *
     * @param {object} [options] - Passed straight to uuidParam.
     * @returns {import('express').Express}
     */
    function appWithGuard(options = {}) {
        const app = express();
        const router = express.Router();

        router.param('id', uuidParam(options));
        router.get('/:id', (req, res) => {
            res.status(200).json({
                success: true,
                raw: req.params.id,
                attached: options.attachAs ? req[options.attachAs] : undefined
            });
        });

        app.use('/things', router);
        return app;
    }

    describe('accepts every well-formed UUID', () => {
        const app = appWithGuard();

        test.each([
            ['leading digit', UUID_LEADING_DIGIT],
            ['leading letter', UUID_LEADING_LETTER],
            ['all-letter first block', 'abcdef01-58cc-4372-a567-0e02b2c3d479'],
            ['uppercase', UUID_LEADING_LETTER.toUpperCase()]
        ])('%s', async (_label, id) => {
            const response = await request(app).get(`/things/${id}`);

            expect(response.status).toBe(200);
            expect(response.body.raw).toBe(id);
        });
    });

    describe('rejects what is not a UUID', () => {
        const app = appWithGuard({ resourceName: 'Product' });

        test.each([
            ['an integer', '42'],
            ['zero', '0'],
            ['a negative number', '-1'],
            ['a word', 'latest'],
            ['a truncated UUID', '550e8400-e29b-41d4-a716'],
            ['a UUID with a non-hex character', '550e8400-e29b-41d4-a716-44665544000z'],
            ['a SQL fragment', "1' OR '1'='1"]
        ])('%s', async (_label, id) => {
            const response = await request(app).get(`/things/${encodeURIComponent(id)}`);

            expect(response.status).toBe(400);
            expect(response.body).toEqual({
                success: false,
                message: 'Invalid product ID'
            });
        });
    });

    test('attaches the validated id under the requested name', async () => {
        const app = appWithGuard({ resourceName: 'Product', attachAs: 'productId' });

        const response = await request(app).get(`/things/${UUID_LEADING_LETTER}`);

        expect(response.status).toBe(200);
        // The whole id, not a number parsed off the front of it.
        expect(response.body.attached).toBe(UUID_LEADING_LETTER);
    });

    test('names the resource in its rejection message', async () => {
        const app = appWithGuard({ resourceName: 'Order' });

        const response = await request(app).get('/things/42');

        expect(response.body.message).toBe('Invalid order ID');
    });

    test('falls back to a generic message when no resource is named', async () => {
        const response = await request(appWithGuard()).get('/things/42');

        expect(response.body.message).toBe('Invalid resource ID');
    });
});

describe('productRoutes :id guard (#1443)', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/products', require('../routes/productRoutes'));

    // GET /:id is public and unauthenticated, so a UUID that clears the guard
    // reaches the controller and fails on the database instead -- a 500, not a
    // 400. The distinction is the point: 400 means the guard refused the id.
    test('does not reject a UUID beginning with a hex letter', async () => {
        const response = await request(app).get(`/api/products/${UUID_LEADING_LETTER}`);

        expect(response.status).not.toBe(400);
    });

    test('still rejects an id that is not a UUID', async () => {
        const response = await request(app).get('/api/products/42');

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid product ID');
    });

    test('rejects consistently regardless of the leading character', async () => {
        const [digit, letter] = await Promise.all([
            request(app).get(`/api/products/${UUID_LEADING_DIGIT}`),
            request(app).get(`/api/products/${UUID_LEADING_LETTER}`)
        ]);

        // Before the fix these differed: 200/500 for one, 400 for the other.
        expect(digit.status).toBe(letter.status);
    });
});

describe('orderRoutes :id guard (#1443)', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/orders', require('../routes/orderRoutes'));

    // Order routes sit behind authMiddleware, so an unauthenticated request
    // answers 401 once the param guard has passed it. 401 rather than 400 is
    // exactly the evidence wanted here.
    test('lets a UUID beginning with a hex letter reach the auth layer', async () => {
        const response = await request(app).get(`/api/orders/${UUID_LEADING_LETTER}`);

        expect(response.status).not.toBe(400);
        expect(response.status).toBe(401);
    });

    test('treats both leading characters the same', async () => {
        const [digit, letter] = await Promise.all([
            request(app).get(`/api/orders/${UUID_LEADING_DIGIT}`),
            request(app).get(`/api/orders/${UUID_LEADING_LETTER}`)
        ]);

        expect(digit.status).toBe(letter.status);
    });

    test('still rejects an integer id', async () => {
        const response = await request(app).get('/api/orders/42');

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid order ID');
    });

    // Every route that hangs off `:id`, not only the bare GET.
    test.each([
        ['timeline', '/timeline'],
        ['summary', '/summary'],
        ['status', '/status'],
        ['invoice', '/invoice']
    ])('%s is reachable with a letter-leading UUID', async (_label, suffix) => {
        const response = await request(app).get(
            `/api/orders/${UUID_LEADING_LETTER}${suffix}`
        );

        expect(response.status).not.toBe(400);
    });

    test('cancel is reachable with a letter-leading UUID', async () => {
        const response = await request(app)
            .patch(`/api/orders/${UUID_LEADING_LETTER}/cancel`)
            .send({ reason: 'changed my mind' });

        expect(response.status).not.toBe(400);
    });
});
