// backend/tests/productRepository.test.js
//
// productRepository named two columns `products` does not have (#1565).
//
// The schema declares `category_id INT` and `views_count INT DEFAULT 0`
// (0001_baseline_schema.sql:150-188). The repository asked for `category` and
// `views`, so findByCategory, getRelatedProducts and incrementViews each threw
// ER_BAD_FIELD_ERROR on every call rather than returning the wrong rows.
//
// The second theme here is the soft-delete column. The constructor has declared
// `softDeleteColumn: 'deleted_at'` since #1457, which is what stopped the
// withdraw path cascading -- but not one read filtered on it, so a withdrawn
// product came straight back out of search, featured, related and by-id
// lookups. The assertions below pin both halves.

jest.mock('../config/db', () => ({
    promise: { query: jest.fn() },
    withTransaction: jest.fn()
}));

const productRepo = require('../repositories/productRepository');

const PRODUCT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** The statement most recently sent, whitespace collapsed for matching. */
const lastSql = () => {
    const calls = productRepo.db.query.mock.calls;
    return String(calls[calls.length - 1][0]).replace(/\s+/g, ' ').trim();
};

/** Every statement sent, whitespace collapsed. */
const allSql = () =>
    productRepo.db.query.mock.calls.map(([sql]) =>
        String(sql).replace(/\s+/g, ' ').trim());

/** The parameters of the statement most recently sent. */
const lastParams = () => {
    const calls = productRepo.db.query.mock.calls;
    return calls[calls.length - 1][1];
};

beforeEach(() => {
    productRepo.db = { query: jest.fn().mockResolvedValue([[], []]) };
    productRepo.clearCache();
});

describe('column names that products actually has', () => {
    test('findByCategory filters on category_id, not category', async () => {
        await productRepo.findByCategory(7);

        expect(lastSql()).toMatch(/WHERE category_id = \?/i);
        expect(lastSql()).not.toMatch(/WHERE category = \?/i);
        expect(lastParams()[0]).toBe(7);
    });

    test('incrementViews writes views_count, not views', async () => {
        await productRepo.incrementViews(PRODUCT_ID);

        expect(lastSql()).toMatch(/SET views_count = views_count \+ 1/i);
        expect(lastSql()).not.toMatch(/SET views = views \+ 1/i);
    });

    test('getRelatedProducts matches on the loaded product\'s category_id', async () => {
        productRepo.db.query
            .mockResolvedValueOnce([[{ id: PRODUCT_ID, category_id: 4 }], []])
            .mockResolvedValueOnce([[], []]);

        await productRepo.getRelatedProducts(PRODUCT_ID);

        expect(lastSql()).toMatch(/WHERE category_id = \?/i);
        // Previously `product.category`, which is always undefined.
        expect(lastParams()[0]).toBe(4);
    });

    test('getRelatedProducts returns nothing for an uncategorised product', async () => {
        // category_id = NULL would otherwise match every other uncategorised
        // product in the catalogue.
        productRepo.db.query.mockResolvedValueOnce([
            [{ id: PRODUCT_ID, category_id: null }], []
        ]);

        await expect(productRepo.getRelatedProducts(PRODUCT_ID)).resolves.toEqual([]);
        expect(productRepo.db.query).toHaveBeenCalledTimes(1);
    });

    test('getRelatedProducts still returns nothing for a product that is gone', async () => {
        productRepo.db.query.mockResolvedValueOnce([[], []]);

        await expect(productRepo.getRelatedProducts(PRODUCT_ID)).resolves.toEqual([]);
    });
});

describe('withdrawn products stay withdrawn', () => {
    const readsThatMustFilter = [
        ['findByCategory', () => productRepo.findByCategory(1)],
        ['findByPriceRange', () => productRepo.findByPriceRange(0, 100)],
        ['search', () => productRepo.search('shirt')],
        ['getLowStockProducts', () => productRepo.getLowStockProducts()],
        ['getFeatured', () => productRepo.getFeatured()],
        ['findByIds', () => productRepo.findByIds([PRODUCT_ID])]
    ];

    test.each(readsThatMustFilter)('%s excludes soft-deleted rows', async (_name, run) => {
        await run();

        expect(lastSql()).toMatch(/deleted_at IS NULL/i);
    });

    test('findWithReviews excludes a deleted product', async () => {
        productRepo.db.query.mockResolvedValue([[{ id: PRODUCT_ID }], []]);

        await productRepo.findWithReviews(PRODUCT_ID);

        expect(allSql()[0]).toMatch(/p\.deleted_at IS NULL/i);
    });

    test('incrementViews does not resurrect a deleted product\'s counter', async () => {
        await productRepo.incrementViews(PRODUCT_ID);

        expect(lastSql()).toMatch(/deleted_at IS NULL/i);
    });
});

describe('review aggregates count only visible reviews', () => {
    beforeEach(() => {
        productRepo.db.query.mockResolvedValue([[{ id: PRODUCT_ID }], []]);
    });

    test('the aggregate skips deleted and unapproved reviews', async () => {
        await productRepo.findWithReviews(PRODUCT_ID);

        const aggregate = allSql()[0];
        expect(aggregate).toMatch(/r\.deleted_at IS NULL/i);
        expect(aggregate).toMatch(/r\.is_approved = 1/i);
    });

    test('those predicates stay in the JOIN, not the WHERE', async () => {
        // Moving them to WHERE turns the LEFT JOIN into an inner one and drops
        // the product as soon as it has no visible reviews.
        await productRepo.findWithReviews(PRODUCT_ID);

        const aggregate = allSql()[0];
        const joinClause = aggregate.slice(
            aggregate.search(/LEFT JOIN/i),
            aggregate.search(/WHERE/i)
        );
        expect(joinClause).toMatch(/r\.deleted_at IS NULL/i);
        expect(joinClause).toMatch(/r\.is_approved = 1/i);
    });

    test('the review list applies the same rule', async () => {
        await productRepo.findWithReviews(PRODUCT_ID);

        const list = allSql()[1];
        expect(list).toMatch(/FROM reviews/i);
        expect(list).toMatch(/deleted_at IS NULL/i);
        expect(list).toMatch(/is_approved = 1/i);
    });
});

describe('search terms are not read as LIKE patterns', () => {
    test('a percent sign in the term is escaped', async () => {
        await productRepo.search('50%');

        expect(lastParams()[0]).toBe('%50\\%%');
        expect(lastSql()).toMatch(/ESCAPE/i);
    });

    test('an underscore is escaped too', async () => {
        await productRepo.search('a_b');

        expect(lastParams()[0]).toBe('%a\\_b%');
    });

    test('a backslash is escaped before anything else', async () => {
        // Escaping it last would double-escape the escapes added for % and _.
        await productRepo.search('a\\%');

        expect(lastParams()[0]).toBe('%a\\\\\\%%');
    });

    test('an ordinary term is unchanged', async () => {
        await productRepo.search('shirt');

        expect(lastParams()[0]).toBe('%shirt%');
    });

    test('both LIKE parameters carry the same escaped term', async () => {
        await productRepo.search('50%');

        const [name, description] = lastParams();
        expect(name).toBe(description);
    });
});
