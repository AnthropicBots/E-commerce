// backend/tests/wishlistRepository.test.js
//
// wishlistRepository addressed a table that does not exist (#1567).
//
// The constructor named `wishlist`; the schema creates `wishlist_items`
// (0001_baseline_schema.sql:797). Every method interpolates `this.tableName`,
// so the whole class failed with ER_NO_SUCH_TABLE -- and behind that,
// findByUser selected `p.image_url`, which belongs to `categories` rather than
// `products`.
//
// The rest of this file pins the two mismatches that would have bitten the
// moment the table name was corrected: the uniqueness rule is keyed on
// variant_id, and nothing filtered deleted_at.

jest.mock('../config/db', () => ({
    promise: { query: jest.fn() },
    withTransaction: jest.fn()
}));

const wishlistRepo = require('../repositories/wishlistRepository');

const USER_ID = '9f8b7a60-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const PRODUCT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** Every statement sent, whitespace collapsed for matching. */
const allSql = () =>
    wishlistRepo.db.query.mock.calls.map(([sql]) =>
        String(sql).replace(/\s+/g, ' ').trim());

const lastSql = () => allSql()[allSql().length - 1];

const lastParams = () => {
    const calls = wishlistRepo.db.query.mock.calls;
    return calls[calls.length - 1][1];
};

beforeEach(() => {
    wishlistRepo.db = { query: jest.fn().mockResolvedValue([[], []]) };
    wishlistRepo.clearCache();
});

describe('the table is wishlist_items', () => {
    test('the repository says so', () => {
        expect(wishlistRepo.tableName).toBe('wishlist_items');
    });

    const everyMethod = [
        ['findByUser', () => wishlistRepo.findByUser(USER_ID)],
        ['remove', () => wishlistRepo.remove(USER_ID, PRODUCT_ID)],
        ['isInWishlist', () => wishlistRepo.isInWishlist(USER_ID, PRODUCT_ID)],
        ['clear', () => wishlistRepo.clear(USER_ID)],
        ['getCount', () => wishlistRepo.getCount(USER_ID)],
        ['getProductsWithDetails', () => wishlistRepo.getProductsWithDetails(USER_ID)]
    ];

    test.each(everyMethod)('%s addresses it, and never "wishlist" alone', async (_name, run) => {
        wishlistRepo.db.query.mockResolvedValue([[{ count: 0 }], []]);

        await run();

        expect(lastSql()).toMatch(/wishlist_items/i);
        expect(lastSql()).not.toMatch(/\bwishlist\b(?!_items)/i);
    });
});

describe('the product columns products actually has', () => {
    test('findByUser selects p.image, not p.image_url', async () => {
        await wishlistRepo.findByUser(USER_ID);

        expect(lastSql()).toMatch(/p\.image\b/i);
        expect(lastSql()).not.toMatch(/p\.image_url/i);
    });

    test('a withdrawn product leaves the entry in place with null details', async () => {
        // The page can then say "no longer available" rather than the saved
        // item silently disappearing.
        await wishlistRepo.findByUser(USER_ID);

        const sql = lastSql();
        const joinClause = sql.slice(sql.search(/LEFT JOIN/i), sql.search(/WHERE/i));
        expect(joinClause).toMatch(/p\.deleted_at IS NULL/i);
    });

    test('getProductsWithDetails drops it instead, since it is asked for products', async () => {
        await wishlistRepo.getProductsWithDetails(USER_ID);

        expect(lastSql()).toMatch(/INNER JOIN products/i);
        expect(lastSql()).toMatch(/p\.deleted_at IS NULL/i);
    });
});

describe('a saved item is identified by its variant too', () => {
    test('add stores the variant', async () => {
        wishlistRepo.db.query
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([{ insertId: 12 }, []])
            .mockResolvedValueOnce([[{ id: 12 }], []]);

        await wishlistRepo.add(USER_ID, PRODUCT_ID, 5);

        const insert = allSql()[1];
        expect(insert).toMatch(/INSERT INTO wishlist_items \(user_id, product_id, variant_id, created_at\)/i);
        expect(wishlistRepo.db.query.mock.calls[1][1]).toEqual([USER_ID, PRODUCT_ID, 5]);
    });

    test('two sizes of one shirt are two entries, not one', async () => {
        // UNIQUE KEY user_product_unique (user_id, product_id, variant_id) --
        // the schema allows both rows, and the old duplicate check collapsed
        // them by looking only at user_id and product_id.
        wishlistRepo.db.query.mockResolvedValue([[], []]);

        await wishlistRepo.add(USER_ID, PRODUCT_ID, 5);

        expect(allSql()[0]).toMatch(/variant_id <=> \?/i);
        expect(wishlistRepo.db.query.mock.calls[0][1]).toEqual([USER_ID, PRODUCT_ID, 5]);
    });

    test('matching uses <=> so a NULL variant matches itself', async () => {
        // `variant_id = NULL` is NULL, not true, so `=` would never match a
        // product with no variants.
        await wishlistRepo.isInWishlist(USER_ID, PRODUCT_ID);

        expect(lastSql()).toMatch(/variant_id <=> \?/i);
        expect(lastParams()).toEqual([USER_ID, PRODUCT_ID, null]);
    });

    test('an absent or unusable variant becomes NULL, not 0', async () => {
        // variant_id has a foreign key onto product_variants(id); a 0 sentinel
        // would fail the constraint.
        for (const input of [undefined, null, '', 'abc', 0, -3]) {
            wishlistRepo.db.query.mockClear();
            await wishlistRepo.isInWishlist(USER_ID, PRODUCT_ID, input);
            expect(lastParams()[2]).toBeNull();
        }
    });

    test('a numeric string variant is stored as a number', async () => {
        await wishlistRepo.isInWishlist(USER_ID, PRODUCT_ID, '5');

        expect(lastParams()[2]).toBe(5);
    });

    test('remove targets the variant as well', async () => {
        wishlistRepo.db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

        await wishlistRepo.remove(USER_ID, PRODUCT_ID, 5);

        expect(lastSql()).toMatch(/variant_id <=> \?/i);
        expect(lastParams()).toEqual([USER_ID, PRODUCT_ID, 5]);
    });
});

describe('removed entries stay removed', () => {
    test('the repository declares the soft-delete column', () => {
        expect(wishlistRepo.softDeleteColumn).toBe('deleted_at');
    });

    const readsThatMustFilter = [
        ['findByUser', () => wishlistRepo.findByUser(USER_ID)],
        ['isInWishlist', () => wishlistRepo.isInWishlist(USER_ID, PRODUCT_ID)],
        ['getCount', () => wishlistRepo.getCount(USER_ID)],
        ['getProductsWithDetails', () => wishlistRepo.getProductsWithDetails(USER_ID)]
    ];

    test.each(readsThatMustFilter)('%s excludes them', async (_name, run) => {
        wishlistRepo.db.query.mockResolvedValue([[{ count: 0 }], []]);

        await run();

        expect(lastSql()).toMatch(/w?\.?deleted_at IS NULL/i);
    });

    test('remove stamps the column instead of deleting the row', async () => {
        wishlistRepo.db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

        await wishlistRepo.remove(USER_ID, PRODUCT_ID);

        expect(lastSql()).toMatch(/UPDATE wishlist_items SET deleted_at = NOW\(\)/i);
        expect(lastSql()).not.toMatch(/DELETE FROM/i);
    });

    test('remove does not re-stamp an entry already removed', async () => {
        // Otherwise the timestamp stops recording when the removal happened.
        wishlistRepo.db.query.mockResolvedValue([{ affectedRows: 0 }, []]);

        await expect(wishlistRepo.remove(USER_ID, PRODUCT_ID)).resolves.toBe(false);
        expect(lastSql()).toMatch(/deleted_at IS NULL/i);
    });

    test('clear stamps every live entry and reports how many', async () => {
        wishlistRepo.db.query.mockResolvedValue([{ affectedRows: 3 }, []]);

        await expect(wishlistRepo.clear(USER_ID)).resolves.toBe(3);
        expect(lastSql()).toMatch(/UPDATE wishlist_items SET deleted_at = NOW\(\)/i);
        expect(lastSql()).not.toMatch(/DELETE FROM/i);
    });
});

describe('re-saving something previously removed', () => {
    test('revives the row rather than inserting over the unique key', async () => {
        // UNIQUE KEY user_product_unique does not exclude soft-deleted rows, so
        // an INSERT here would fail with ER_DUP_ENTRY.
        wishlistRepo.db.query
            .mockResolvedValueOnce([[{ id: 12, deleted_at: new Date() }], []])
            .mockResolvedValueOnce([{ affectedRows: 1 }, []])
            .mockResolvedValueOnce([[{ id: 12, deleted_at: null }], []]);

        const result = await wishlistRepo.add(USER_ID, PRODUCT_ID);

        expect(allSql()[1]).toMatch(/SET deleted_at = NULL/i);
        expect(allSql().some((sql) => /^INSERT/i.test(sql))).toBe(false);
        expect(result).toEqual({ id: 12, deleted_at: null });
    });

    test('an entry that is already live is returned untouched', async () => {
        const live = { id: 12, deleted_at: null };
        wishlistRepo.db.query.mockResolvedValueOnce([[live], []]);

        await expect(wishlistRepo.add(USER_ID, PRODUCT_ID)).resolves.toBe(live);
        expect(wishlistRepo.db.query).toHaveBeenCalledTimes(1);
    });
});
