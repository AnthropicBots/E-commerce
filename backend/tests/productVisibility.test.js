// backend/tests/productVisibility.test.js
//
// Which products a shopper may see (#1456).
//
// `products` has two visibility columns, `deleted_at` and `status`. Every
// public query filtered on the first and none of them read the second, so
// drafts were on sale and an admin marking a product `inactive` changed
// nothing. The autocomplete query filtered on neither.
//
// The tests are split in two: the shared condition itself, and each caller
// actually using it. The second half is the part that matters -- the bug was
// never that the condition was wrong, it was that three call sites each wrote
// their own and two of them forgot something.

jest.mock('../config/db', () => ({
    query: jest.fn().mockResolvedValue([[]]),
    getConnection: jest.fn()
}));

jest.mock('../services/productService', () => ({
    // The detail and list paths wrap their query in a cache. Run the loader
    // straight through so the SQL under test is the SQL that executes.
    withProductCache: jest.fn(async (_key, loader) => loader()),
    invalidateProductCaches: jest.fn().mockResolvedValue(undefined),
    onCategoryMutation: jest.fn().mockResolvedValue(undefined),
    getCategoryTree: jest.fn().mockResolvedValue([])
}));

jest.mock('../services/stockCounterService', () => ({
    getVariantRollup: jest.fn().mockResolvedValue({ variantCount: 0, stock: 0 })
}));

const db = require('../config/db');
const {
    PRODUCT_STATUSES,
    PUBLIC_PRODUCT_STATUSES,
    DEFAULT_PRODUCT_STATUS,
    isValidProductStatus,
    normalizeProductStatus,
    publicProductCondition
} = require('../constants/productVisibility');

const {
    getProducts,
    getSingleProduct,
    getProductSuggestions,
    createProduct,
    updateProduct
} = require('../controllers/productController');

const PRODUCT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** A res double that records the status and body. */
const makeRes = () => ({
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
});

/** Every SQL string the controller sent during a test. */
const executedSql = () => db.query.mock.calls.map(([sql]) => String(sql));

/** The first executed statement matching a fragment, with its parameters. */
const statementMatching = (fragment) =>
    db.query.mock.calls.find(([sql]) => String(sql).includes(fragment));

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([[]]);
});

describe('the shared condition', () => {
    test('restricts to undeleted products in a public status', () => {
        const { sql, params } = publicProductCondition('p');

        expect(sql).toContain('p.deleted_at IS NULL');
        expect(sql).toContain('p.status IN (?)');
        expect(params).toEqual([...PUBLIC_PRODUCT_STATUSES]);
    });

    test('binds the statuses rather than interpolating them', () => {
        // Placeholders, not literals, so the fragment stays safe if the public
        // set ever becomes configurable.
        const { sql } = publicProductCondition('p');
        for (const status of PUBLIC_PRODUCT_STATUSES) {
            expect(sql).not.toContain(`'${status}'`);
        }
    });

    test('supports an unaliased table', () => {
        // The suggestions query selects from `products` with no alias.
        const { sql } = publicProductCondition('');

        expect(sql).toContain('deleted_at IS NULL');
        expect(sql).not.toContain('.deleted_at');
    });

    test('only "active" is public', () => {
        expect([...PUBLIC_PRODUCT_STATUSES]).toEqual(['active']);
        for (const status of ['draft', 'inactive', 'archived']) {
            expect(PUBLIC_PRODUCT_STATUSES).not.toContain(status);
        }
    });

    test('the status list matches the column definition', () => {
        // If the enum in migrations/0001 ever gains a member, this is the list
        // that has to learn about it.
        expect([...PRODUCT_STATUSES])
            .toEqual(['draft', 'active', 'inactive', 'archived']);
    });
});

describe('status validation', () => {
    test.each(PRODUCT_STATUSES)('accepts %s', (status) => {
        expect(isValidProductStatus(status)).toBe(true);
        expect(normalizeProductStatus(status)).toBe(status);
    });

    test('is case and whitespace insensitive', () => {
        expect(normalizeProductStatus('  ACTIVE ')).toBe('active');
        expect(normalizeProductStatus('Draft')).toBe('draft');
    });

    test('rejects anything outside the enum', () => {
        // MySQL in strict mode refuses a value outside an enum, so a bad value
        // has to be caught before the statement rather than after it.
        for (const bad of ['published', 'live', 'ACTIVE ; DROP', 1, true, {}, []]) {
            expect(normalizeProductStatus(bad)).toBeNull();
        }
    });

    test('distinguishes "not supplied" from "supplied but wrong"', () => {
        // Both come back null, which is why the callers check for the empty
        // cases first -- the difference decides between a default and a 400.
        expect(normalizeProductStatus(undefined)).toBeNull();
        expect(normalizeProductStatus('')).toBeNull();
        expect(normalizeProductStatus('nonsense')).toBeNull();
    });
});

describe('GET /api/products', () => {
    test('filters on both columns', async () => {
        const res = makeRes();
        await getProducts({ query: {} }, res);

        for (const sql of executedSql()) {
            expect(sql).toContain('deleted_at IS NULL');
            expect(sql).toContain('status IN');
        }
    });

    test('binds the public statuses ahead of limit and offset', async () => {
        // The list query appends limit/offset after the filter parameters, so
        // getting the order wrong here shifts every placeholder.
        db.query.mockResolvedValue([[{ total: 0 }]]);
        const res = makeRes();
        await getProducts({ query: { page: '2', limit: '10' } }, res);

        const listCall = statementMatching('LIMIT ?');
        expect(listCall).toBeDefined();
        const params = listCall[1];
        expect(params.slice(0, PUBLIC_PRODUCT_STATUSES.length))
            .toEqual([...PUBLIC_PRODUCT_STATUSES]);
        expect(params.slice(-2)).toEqual([10, 10]);
    });

    test('the count query is filtered the same way as the page query', async () => {
        // A count that includes hidden products reports more pages than exist,
        // and the last ones come back empty.
        db.query.mockResolvedValue([[{ total: 0 }]]);
        const res = makeRes();
        await getProducts({ query: {} }, res);

        const countCall = statementMatching('COUNT(*)');
        expect(countCall).toBeDefined();
        expect(String(countCall[0])).toContain('status IN');
        expect(countCall[1]).toEqual(expect.arrayContaining([...PUBLIC_PRODUCT_STATUSES]));
    });

    test('keeps filtering when a category or search narrows the query further', async () => {
        db.query.mockResolvedValue([[{ total: 0 }]]);
        const res = makeRes();
        await getProducts(
            { query: { category: 'toys', search: 'robot', minPrice: '5' } },
            res
        );

        for (const sql of executedSql()) {
            expect(sql).toContain('status IN');
        }
    });
});

describe('GET /api/products/:id', () => {
    test('filters on both columns', async () => {
        const res = makeRes();
        await getSingleProduct({ params: { id: PRODUCT_ID } }, res);

        const [sql, params] = db.query.mock.calls[0];
        expect(String(sql)).toContain('deleted_at IS NULL');
        expect(String(sql)).toContain('status IN');
        expect(params[0]).toBe(PRODUCT_ID);
        expect(params.slice(1)).toEqual([...PUBLIC_PRODUCT_STATUSES]);
    });

    test('a non-public product is a 404, not a hidden-but-reachable page', async () => {
        // Hidden from the listing but live at its own URL is not hidden: the
        // URL is in the sitemap, in search results and in browser history.
        db.query.mockResolvedValue([[]]);
        const res = makeRes();
        await getSingleProduct({ params: { id: PRODUCT_ID } }, res);

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
    });
});

describe('GET /api/products/search-suggestions', () => {
    test('filters on both columns', async () => {
        // This query filtered on neither. It was the only read in the file that
        // skipped `deleted_at`, and its results are links to getSingleProduct,
        // which enforces it -- so the dropdown offered rows that 404.
        const res = makeRes();
        await getProductSuggestions({ query: { q: 'shirt' } }, res);

        const [sql, params] = db.query.mock.calls[0];
        expect(String(sql)).toContain('deleted_at IS NULL');
        expect(String(sql)).toContain('status IN');
        expect(params[0]).toBe('%shirt%');
        expect(params.slice(1)).toEqual([...PUBLIC_PRODUCT_STATUSES]);
    });

    test('still escapes LIKE wildcards', async () => {
        // Regression guard: the visibility fix rewrote this statement, and the
        // escaping is easy to lose in a rewrite.
        const res = makeRes();
        await getProductSuggestions({ query: { q: '100%_off' } }, res);

        expect(db.query.mock.calls[0][1][0]).toBe('%100\\%\\_off%');
    });

    test('an empty query does not reach the database', async () => {
        const res = makeRes();
        res.json = jest.fn();
        await getProductSuggestions({ query: { q: '   ' } }, res);

        expect(db.query).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith([]);
    });
});

describe('POST /api/products', () => {
    const body = { name: 'Blue Hoodie', price: 25, category: 'Apparel', stock: 4 };

    beforeEach(() => {
        // No existing product with the name, then the category lookup.
        db.query.mockResolvedValue([[]]);
    });

    test('writes status explicitly instead of falling to the column default', async () => {
        // The INSERT did not list the column, so every product created through
        // this endpoint was a `draft` nobody chose.
        const res = makeRes();
        await createProduct({ body: { ...body } }, res);

        const insert = statementMatching('INSERT INTO products');
        expect(insert).toBeDefined();
        expect(String(insert[0])).toContain('status');
        expect(insert[1]).toContain(DEFAULT_PRODUCT_STATUS);
    });

    test('an unsupplied status defaults to on sale', async () => {
        const res = makeRes();
        await createProduct({ body: { ...body } }, res);

        expect(res.statusCode).toBe(201);
        expect(res.body.status).toBe(DEFAULT_PRODUCT_STATUS);
        expect(PUBLIC_PRODUCT_STATUSES).toContain(res.body.status);
    });

    test('a caller can stage a product as a draft', async () => {
        const res = makeRes();
        await createProduct({ body: { ...body, status: 'draft' } }, res);

        expect(res.statusCode).toBe(201);
        expect(res.body.status).toBe('draft');
        expect(statementMatching('INSERT INTO products')[1]).toContain('draft');
    });

    test('a status outside the enum is a 400, not a silent fallback', async () => {
        // Swallowing it would put the product in a state its author did not
        // choose, and MySQL would reject the write anyway in strict mode.
        const res = makeRes();
        await createProduct({ body: { ...body, status: 'published' } }, res);

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain('status must be one of');
        expect(statementMatching('INSERT INTO products')).toBeUndefined();
    });
});

describe('PUT /api/products/:id', () => {
    const body = { name: 'Blue Hoodie', price: 25 };

    beforeEach(() => {
        db.query.mockResolvedValue([{ affectedRows: 1 }]);
    });

    test('omitting status leaves it alone', async () => {
        // An admin renaming a product must not publish it as a side effect,
        // which is why the statement uses COALESCE rather than assigning.
        const res = makeRes();
        await updateProduct({ params: { id: PRODUCT_ID }, body: { ...body } }, res);

        const update = statementMatching('UPDATE products');
        expect(String(update[0])).toContain('status = COALESCE(?, status)');
        expect(update[1]).toContain(null);
    });

    test('supplying status changes it', async () => {
        const res = makeRes();
        await updateProduct(
            { params: { id: PRODUCT_ID }, body: { ...body, status: 'inactive' } },
            res
        );

        expect(statementMatching('UPDATE products')[1]).toContain('inactive');
    });

    test('a status outside the enum is a 400', async () => {
        const res = makeRes();
        await updateProduct(
            { params: { id: PRODUCT_ID }, body: { ...body, status: 'live' } },
            res
        );

        expect(res.statusCode).toBe(400);
        expect(statementMatching('UPDATE products')).toBeUndefined();
    });
});

describe('migration 0043', () => {
    const fs = require('fs');
    const path = require('path');

    const sql = fs.readFileSync(
        path.join(__dirname, '..', '..', 'migrations', '0043_publish_existing_products.sql'),
        'utf8'
    );

    test('publishes the rows that only defaulted to draft', () => {
        // Without this, turning the filter on empties the catalogue: every
        // existing row says `draft` because the INSERT never set the column.
        expect(sql).toMatch(/UPDATE\s+products/i);
        expect(sql).toMatch(/SET\s+status\s*=\s*'active'/i);
    });

    test("does not touch a status somebody actually chose", () => {
        // `inactive` and `archived` can only have been set by hand, so they are
        // deliberate. Publishing them would override a decision to withdraw.
        expect(sql).toMatch(/WHERE\s+status\s*=\s*'draft'/i);
        expect(sql).not.toMatch(/status\s*(!=|<>)\s*'active'/i);
    });

    test('does not resurrect a soft-deleted product', () => {
        expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i);
    });
});
