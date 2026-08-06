// backend/tests/productSoftDelete.test.js
//
// Withdrawing a product must not erase the history attached to it (#1457).
//
// `DELETE /api/products/:id` ran `DELETE FROM products WHERE id = ?`, and
// fourteen tables cascade off `products(id)` while two more are set to NULL. So
// one admin click threw away every review of the product, dropped it out of
// every wishlist and every open cart, deleted the stock ledger, and cut the
// link between historical `order_items` and the catalogue -- which is what
// reorder, returns and per-product reporting are built on.
//
// The strongest assertion in this file is the plain one: no statement on the
// request path says `DELETE FROM products`. Everything else describes what
// replaced it.

jest.mock('../config/db', () => ({
    query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    getConnection: jest.fn(),
    promise: { query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) },
    withTransaction: jest.fn()
}));

jest.mock('../services/productService', () => ({
    withProductCache: jest.fn(async (_key, loader) => loader()),
    invalidateProductCaches: jest.fn().mockResolvedValue(undefined),
    onCategoryMutation: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../services/stockCounterService', () => ({
    getVariantRollup: jest.fn().mockResolvedValue({ variantCount: 0, stock: 0 })
}));

const db = require('../config/db');
const productService = require('../services/productService');
const {
    deleteProduct,
    restoreProduct
} = require('../controllers/productController');

const PRODUCT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const makeRes = () => ({
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
});

/** Every statement the handler sent, whitespace collapsed for matching. */
const executedSql = () =>
    db.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());

/** The first statement containing a fragment, with its parameters. */
const statementMatching = (fragment) =>
    db.query.mock.calls.find(([sql]) =>
        String(sql).replace(/\s+/g, ' ').includes(fragment));

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    // Silence the deliberate console.error in the release helper's catch.
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    console.error.mockRestore?.();
});

describe('DELETE /api/products/:id', () => {
    test('never issues a row delete against products', async () => {
        const res = makeRes();
        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        // The whole issue in one assertion. Fourteen cascades hang off this
        // statement; none of them can fire if it is not sent.
        for (const sql of executedSql()) {
            expect(sql).not.toMatch(/DELETE\s+FROM\s+products\b/i);
        }
    });

    test('stamps deleted_at instead', async () => {
        const res = makeRes();
        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        const update = statementMatching('UPDATE products');
        expect(update).toBeDefined();
        expect(String(update[0])).toMatch(/deleted_at\s*=\s*NOW\(\)/i);
        expect(update[1]).toEqual([PRODUCT_ID]);
    });

    test('archives the status in the same statement', async () => {
        // Otherwise the two visibility columns can disagree -- a row that is
        // soft-deleted but still says `active` is a contradiction waiting for
        // whichever query reads only one of them.
        const res = makeRes();
        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        expect(String(statementMatching('UPDATE products')[0]))
            .toMatch(/status\s*=\s*'archived'/i);
    });

    test('guards on deleted_at IS NULL so a repeat call is a 404', async () => {
        // Without the guard the second call succeeds, moves the timestamp
        // forward, and loses when the deletion actually happened.
        const res = makeRes();
        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        expect(String(statementMatching('UPDATE products')[0]))
            .toMatch(/deleted_at\s+IS\s+NULL/i);
    });

    test('an unknown or already-deleted id is a 404', async () => {
        db.query.mockResolvedValue([{ affectedRows: 0 }]);
        const res = makeRes();

        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
    });

    test('a malformed id never reaches the database', async () => {
        const res = makeRes();
        await deleteProduct({ params: { id: 'not-a-uuid' } }, res);

        expect(res.statusCode).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('invalidates the product caches', async () => {
        const res = makeRes();
        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        expect(productService.invalidateProductCaches)
            .toHaveBeenCalledWith(PRODUCT_ID);
    });
});

describe('the live state that should go', () => {
    test('releases inventory locks', async () => {
        // A hold on stock for a product nobody can buy. Left alone it sits
        // until its own expiry, reserving stock against a withdrawn product.
        const res = makeRes();
        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        const statement = statementMatching('inventory_locks');
        expect(statement).toBeDefined();
        expect(statement[1]).toEqual([PRODUCT_ID]);
    });

    test('removes the product from open carts', async () => {
        // A line the shopper cannot check out. Leaving it means a basket that
        // fails at payment with no explanation.
        const res = makeRes();
        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        const statement = statementMatching('cart_items');
        expect(statement).toBeDefined();
        expect(statement[1]).toEqual([PRODUCT_ID]);
    });

    test('touches nothing that is a record of something that happened', async () => {
        const res = makeRes();
        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        const sql = executedSql().join(' | ');
        for (const table of [
            'reviews',
            'wishlist_items',
            'order_items',
            'refund_requests',
            'product_questions',
            'inventory_transactions',
            'user_interactions',
            'recently_viewed',
            'stock_alert_subscriptions',
            'product_variants'
        ]) {
            expect(sql).not.toContain(table);
        }
    });

    test('the release runs only after the withdrawal succeeds', async () => {
        db.query.mockResolvedValue([{ affectedRows: 0 }]);
        const res = makeRes();

        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        expect(res.statusCode).toBe(404);
        expect(statementMatching('inventory_locks')).toBeUndefined();
        expect(statementMatching('cart_items')).toBeUndefined();
    });

    test('a failed release does not undo the withdrawal', async () => {
        // The withdrawal is what the caller asked for and it has succeeded.
        // Reporting 500 here would invite a retry that cannot un-withdraw it,
        // and rolling back would leave a product on sale an admin has decided
        // should not be.
        db.query.mockImplementation(async (sql) => {
            if (String(sql).includes('inventory_locks')) {
                throw new Error('ER_LOCK_WAIT_TIMEOUT');
            }
            return [{ affectedRows: 1 }];
        });

        const res = makeRes();
        await deleteProduct({ params: { id: PRODUCT_ID } }, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        // And it still got as far as the second statement.
        expect(statementMatching('cart_items')).toBeDefined();
    });
});

describe('POST /api/products/:id/restore', () => {
    test('clears deleted_at', async () => {
        const res = makeRes();
        await restoreProduct({ params: { id: PRODUCT_ID } }, res);

        const update = statementMatching('UPDATE products');
        expect(String(update[0])).toMatch(/deleted_at\s*=\s*NULL/i);
        expect(update[1]).toEqual([PRODUCT_ID]);
    });

    test('brings the product back as a draft, not straight onto the shop page', async () => {
        // An admin restoring a product is undoing a mistake and wants to look
        // at it before customers do. Putting it back on sale silently is a
        // second surprise on top of the first.
        const res = makeRes();
        await restoreProduct({ params: { id: PRODUCT_ID } }, res);

        expect(String(statementMatching('UPDATE products')[0]))
            .toMatch(/status\s*=\s*'draft'/i);
        expect(res.body.status).toBe('draft');
    });

    test('guards on deleted_at IS NOT NULL', async () => {
        // So restoring a live product cannot quietly reset its status to draft.
        const res = makeRes();
        await restoreProduct({ params: { id: PRODUCT_ID } }, res);

        expect(String(statementMatching('UPDATE products')[0]))
            .toMatch(/deleted_at\s+IS\s+NOT\s+NULL/i);
    });

    test('restoring something that was never deleted is a 404', async () => {
        db.query.mockResolvedValue([{ affectedRows: 0 }]);
        const res = makeRes();

        await restoreProduct({ params: { id: PRODUCT_ID } }, res);

        expect(res.statusCode).toBe(404);
    });

    test('does not recreate the cart lines and locks that were dropped', async () => {
        // They belonged to sessions that have long since moved on; putting
        // lines back into baskets whose owners never asked for them is worse
        // than leaving them out.
        const res = makeRes();
        await restoreProduct({ params: { id: PRODUCT_ID } }, res);

        const sql = executedSql().join(' | ');
        expect(sql).not.toContain('cart_items');
        expect(sql).not.toContain('inventory_locks');
    });

    test('a malformed id never reaches the database', async () => {
        const res = makeRes();
        await restoreProduct({ params: { id: '../../etc/passwd' } }, res);

        expect(res.statusCode).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });
});

describe('the repository, which is the other door onto the same row', () => {
    // productService.deleteProduct() reaches products through the repository,
    // so fixing only the controller would have left the cascade one method
    // call away.
    const BaseRepository = require('../repositories/baseRepository');

    /** A repository whose db is a recording double. */
    const repoWith = (options) => {
        const repo = new BaseRepository('widgets', 'id', options);
        repo.db = { query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) };
        return repo;
    };

    test('a soft-delete repository stamps the column instead of deleting', async () => {
        const repo = repoWith({ softDeleteColumn: 'deleted_at' });

        await repo.delete('abc');

        const sql = repo.db.query.mock.calls[0][0].replace(/\s+/g, ' ');
        expect(sql).toMatch(/UPDATE widgets/i);
        expect(sql).toMatch(/deleted_at = NOW\(\)/i);
        expect(sql).not.toMatch(/DELETE FROM/i);
    });

    test('and excludes rows already deleted', async () => {
        const repo = repoWith({ softDeleteColumn: 'deleted_at' });

        await repo.delete('abc');

        expect(repo.db.query.mock.calls[0][0].replace(/\s+/g, ' '))
            .toMatch(/deleted_at IS NULL/i);
    });

    test('a repository without the option is unchanged', async () => {
        // orders, users and wishlist all still take this path.
        const repo = repoWith({});

        await repo.delete('abc');

        expect(repo.db.query.mock.calls[0][0]).toMatch(/DELETE FROM widgets/i);
    });

    test('hardDelete is still available, by name', async () => {
        // Erasure requests are supposed to destroy data. The point is that a
        // caller has to ask for it rather than get it by default.
        const repo = repoWith({ softDeleteColumn: 'deleted_at' });

        await repo.hardDelete('abc');

        expect(repo.db.query.mock.calls[0][0]).toMatch(/DELETE FROM widgets/i);
    });

    test('the product repository declares the column', async () => {
        const productRepo = require('../repositories/productRepository');
        expect(productRepo.softDeleteColumn).toBe('deleted_at');
        expect(productRepo.tableName).toBe('products');
    });
});
