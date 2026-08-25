// What the wishlist reads select, and from which rows (#1523).
//
// `GET /api/wishlist` selected `p.review_count`. There is no such column on
// `products` -- the review count lives in `num_reviews` -- so MySQL refused
// every one of those queries and the handler answered 500. The wishlist page
// and the dashboard panel both fetch that endpoint, so a signed-in shopper's
// saved list came back empty from the server on every page load.
//
// The rest of these are about which rows the reads are entitled to return: a
// product the shop has withdrawn, and the account id of whoever made a public
// share link.
//
// `promisePool.query` is mocked, so a mock accepts any string and no
// behavioural assertion can see a column that does not exist. The assertions
// are therefore on the SQL, which is where the defect is.

jest.mock("../config/db", () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

jest.mock("../utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const db = require("../config/db");
const wishlistController = require("../controllers/wishlistController");

const PRODUCT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

// A fresh account per test. The handler's cache is module state and is keyed
// by user, so two tests reading page 1 as the same shopper would have the
// second one served from the first one's entry -- and assert nothing.
let accountSeq = 0;
const nextUserId = () =>
    `3f2504e0-4f89-11d3-9a0c-${(0x040000000000 + (accountSeq += 1))
        .toString(16)
        .padStart(12, "0")}`;

let USER_ID;

/**
 * A response double that records what the handler said.
 */
function mockRes() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        send(payload) {
            this.body = payload;
            return this;
        },
        setHeader(name, value) {
            this.headers[name] = value;
        }
    };
}

/** Every statement the handler issued, whitespace collapsed. */
const statements = () =>
    db.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());

/** The one statement matching a pattern, asserted to be unambiguous. */
function statementMatching(pattern) {
    const matches = statements().filter((sql) => pattern.test(sql));
    expect(matches).toHaveLength(1);
    return matches[0];
}

beforeEach(() => {
    // reset, not clear: `mockResolvedValueOnce` queues survive `mockClear`,
    // so a test that queues more replies than it consumes feeds them to the
    // next one.
    db.query.mockReset();
    USER_ID = nextUserId();
});

describe("GET /wishlist", () => {
    beforeEach(() => {
        db.query
            .mockResolvedValueOnce([[{ total: 1 }]])
            .mockResolvedValueOnce([
                [
                    {
                        id: PRODUCT_ID,
                        name: "Cotton shirt",
                        price: 1200,
                        review_count: 4,
                        added_at: "2026-01-01T00:00:00.000Z"
                    }
                ]
            ]);
    });

    test("selects num_reviews, not the column that does not exist", async () => {
        const req = { user: { id: USER_ID }, query: {} };
        const res = mockRes();

        await wishlistController.getUserWishlist(req, res);

        const listQuery = statementMatching(/added_at/);

        // The failure was `ER_BAD_FIELD_ERROR: Unknown column 'p.review_count'`.
        expect(listQuery).not.toMatch(/\bp\.review_count\b/);
        expect(listQuery).toMatch(/p\.num_reviews AS review_count/i);
    });

    test("answers 200 with the list rather than the 500 the bad column caused", async () => {
        const req = { user: { id: USER_ID }, query: {} };
        const res = mockRes();

        await wishlistController.getUserWishlist(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.items).toHaveLength(1);
    });

    test("keeps review_count as the field name clients already read", async () => {
        const req = { user: { id: USER_ID }, query: {} };
        const res = mockRes();

        await wishlistController.getUserWishlist(req, res);

        expect(res.body.data.items[0]).toHaveProperty("review_count", 4);
    });

    test("lists only products that are still on sale", async () => {
        const req = { user: { id: USER_ID }, query: {} };
        const res = mockRes();

        await wishlistController.getUserWishlist(req, res);

        const listQuery = statementMatching(/added_at/);

        expect(listQuery).toMatch(/p\.is_active = 1/);
        expect(listQuery).toMatch(/p\.deleted_at IS NULL/);
    });

    test("counts over the same rows it lists", async () => {
        const req = { user: { id: USER_ID }, query: {} };
        const res = mockRes();

        await wishlistController.getUserWishlist(req, res);

        const countQuery = statementMatching(/COUNT\(\*\) as total/);

        // Counting wishlist_items alone while listing the join gives a total
        // bigger than the list can produce: the last page comes back empty
        // with hasNextPage still true.
        expect(countQuery).toMatch(/JOIN products p/);
        expect(countQuery).toMatch(/p\.is_active = 1/);
        expect(countQuery).toMatch(/p\.deleted_at IS NULL/);
    });
});

describe("GET /wishlist/count", () => {
    test("counts what the list would show", async () => {
        db.query.mockResolvedValueOnce([[{ count: 2 }]]);

        const req = { user: { id: USER_ID }, query: {} };
        const res = mockRes();

        await wishlistController.getWishlistCount(req, res);

        const countQuery = statementMatching(/COUNT\(\*\) as count/);

        expect(countQuery).toMatch(/JOIN products p/);
        expect(countQuery).toMatch(/p\.is_active = 1/);
        expect(res.body).toMatchObject({ success: true, count: 2 });
    });
});

describe("GET /wishlist/share/:token", () => {
    beforeEach(() => {
        db.query
            .mockResolvedValueOnce([[{ user_id: USER_ID, expires_at: "2030-01-01" }]])
            .mockResolvedValueOnce([
                [{ product_id: PRODUCT_ID, name: "Cotton shirt", price: 1200 }]
            ]);
    });

    test("does not select the owner's row wholesale", async () => {
        const req = { params: { token: "a".repeat(64) } };
        const res = mockRes();

        await wishlistController.getSharedWishlist(req, res);

        const itemsQuery = statementMatching(/FROM wishlist_items w/);

        // `w.*` includes wishlist_items.user_id, so the account id of whoever
        // made the link travelled to everyone the link was forwarded to.
        // Scoped to the select list: `w.user_id = ?` in the WHERE clause is
        // how the owner's rows are found and has to stay.
        const selectList = itemsQuery.slice(0, itemsQuery.indexOf(" FROM "));

        expect(selectList).not.toMatch(/w\.\*/);
        expect(selectList).not.toMatch(/user_id/);
    });

    test("returns nothing that identifies the owner", async () => {
        const req = { params: { token: "a".repeat(64) } };
        const res = mockRes();

        await wishlistController.getSharedWishlist(req, res);

        const payload = JSON.stringify(res.body);

        expect(res.statusCode).toBe(200);
        expect(payload).not.toContain(USER_ID);
    });

    test("shows only products still on sale", async () => {
        const req = { params: { token: "a".repeat(64) } };
        const res = mockRes();

        await wishlistController.getSharedWishlist(req, res);

        const itemsQuery = statementMatching(/FROM wishlist_items w/);

        expect(itemsQuery).toMatch(/p\.is_active = 1/);
        expect(itemsQuery).toMatch(/p\.deleted_at IS NULL/);
    });

    test("still refuses an expired or unknown token", async () => {
        db.query.mockReset();
        db.query.mockResolvedValueOnce([[]]);

        const req = { params: { token: "b".repeat(64) } };
        const res = mockRes();

        await wishlistController.getSharedWishlist(req, res);

        expect(res.statusCode).toBe(404);
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

describe("adding to the wishlist", () => {
    test("refuses a product that has been withdrawn", async () => {
        // The product row is gone from the result because the filter excluded
        // it; the handler must treat that as "not available", which it did
        // already -- what was missing was deleted_at from the filter.
        db.query.mockResolvedValueOnce([[]]);

        const req = { user: { id: USER_ID }, body: { productId: PRODUCT_ID } };
        const res = mockRes();

        await wishlistController.addToWishlist(req, res);

        const lookup = statementMatching(/FROM products p/);

        expect(lookup).toMatch(/p\.is_active = 1/);
        expect(lookup).toMatch(/p\.deleted_at IS NULL/);
        expect(res.statusCode).toBe(404);
    });
});

describe("GET /wishlist/export", () => {
    test("an empty wishlist exports as an empty list, not a 404", async () => {
        db.query.mockResolvedValueOnce([[]]);

        const req = { user: { id: USER_ID }, query: { format: "json" } };
        const res = mockRes();

        await wishlistController.exportWishlist(req, res);

        // "You have nothing saved" is an answer, not a missing resource.
        expect(res.statusCode).toBe(200);
        expect(res.body.data.items).toEqual([]);
        expect(res.body.data.total).toBe(0);
    });

    test("neutralises a product name a spreadsheet would execute", async () => {
        db.query.mockResolvedValueOnce([
            [
                {
                    product_id: PRODUCT_ID,
                    name: '=HYPERLINK("http://example.invalid","Click")',
                    price: 100,
                    brand: "+ACME",
                    description: "-1+1",
                    added_date: "2026-01-01"
                }
            ]
        ]);

        const req = { user: { id: USER_ID }, query: { format: "csv" } };
        const res = mockRes();

        await wishlistController.exportWishlist(req, res);

        expect(res.headers["Content-Type"]).toBe("text/csv");
        // Prefixed with an apostrophe, which a spreadsheet reads as "this is
        // text" and does not display.
        expect(res.body).toContain("'=HYPERLINK");
        expect(res.body).toContain("'+ACME");
        expect(res.body).toContain("'-1+1");
    });

    test("leaves an ordinary name alone", async () => {
        db.query.mockResolvedValueOnce([
            [
                {
                    product_id: PRODUCT_ID,
                    name: "Cotton shirt",
                    price: 1200,
                    brand: "ACME",
                    description: "A shirt",
                    added_date: "2026-01-01"
                }
            ]
        ]);

        const req = { user: { id: USER_ID }, query: { format: "csv" } };
        const res = mockRes();

        await wishlistController.exportWishlist(req, res);

        expect(res.body).toContain("Cotton shirt");
        expect(res.body).not.toContain("'Cotton shirt");
    });

    test("exports only products still on sale", async () => {
        db.query.mockResolvedValueOnce([[]]);

        const req = { user: { id: USER_ID }, query: { format: "json" } };
        const res = mockRes();

        await wishlistController.exportWishlist(req, res);

        const exportQuery = statementMatching(/added_date/);

        expect(exportQuery).toMatch(/p\.is_active = 1/);
        expect(exportQuery).toMatch(/p\.deleted_at IS NULL/);
    });
});

describe("wishlist analytics", () => {
    test("prices and categories are drawn from live products only", async () => {
        db.query
            .mockResolvedValueOnce([[{ total: 1, min_price: 10, max_price: 20, avg_price: 15 }]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[]]);

        const req = { user: { id: USER_ID } };
        const res = mockRes();

        await wishlistController.getWishlistAnalytics(req, res);

        // A withdrawn product's price still counted towards the shopper's
        // "cheapest saved item", which is the figure the panel leads with.
        expect(statementMatching(/min_price/)).toMatch(/p\.is_active = 1/);
        expect(statementMatching(/JOIN categories c/)).toMatch(/p\.is_active = 1/);
    });
});

describe("the in-process cache", () => {
    // The Map is module state, so these run through the public handler rather
    // than reaching into it.
    const readPage = async (userId, page) => {
        db.query
            .mockResolvedValueOnce([[{ total: 0 }]])
            .mockResolvedValueOnce([[]]);

        await wishlistController.getUserWishlist(
            { user: { id: userId }, query: { page: String(page) } },
            mockRes()
        );
    };

    test("serves a repeated read from cache", async () => {
        await readPage(USER_ID, 1);
        const afterFirst = db.query.mock.calls.length;

        await wishlistController.getUserWishlist(
            { user: { id: USER_ID }, query: { page: "1" } },
            mockRes()
        );

        expect(db.query.mock.calls.length).toBe(afterFirst);
    });

    test("drops an entry once it has expired instead of keeping it forever", async () => {
        const realNow = Date.now;

        try {
            await readPage(USER_ID, 1);

            // Six minutes on; the TTL is five.
            Date.now = () => realNow() + 6 * 60 * 1000;

            const res = mockRes();
            db.query
                .mockResolvedValueOnce([[{ total: 0 }]])
                .mockResolvedValueOnce([[]]);

            await wishlistController.getUserWishlist(
                { user: { id: USER_ID }, query: { page: "1" } },
                res
            );

            // An expired entry read as a miss before this change too -- but it
            // stayed in the Map, so the Map only ever grew. The read below is
            // what proves it was removed rather than merely ignored.
            expect(res.body.cached).toBe(false);
        } finally {
            Date.now = realNow;
        }
    });

    test("a write empties that user's pages and nobody else's", async () => {
        const OTHER_USER = "3f2504e0-4f89-11d3-9a0c-0305e82c3303";

        await readPage(USER_ID, 1);
        await readPage(OTHER_USER, 1);

        db.query.mockResolvedValueOnce([[{ affectedRows: 1 }]]);
        await wishlistController.removeFromWishlist(
            { user: { id: USER_ID }, params: { productId: PRODUCT_ID }, body: {} },
            mockRes()
        );

        const before = db.query.mock.calls.length;

        // The other user's page is still cached.
        await wishlistController.getUserWishlist(
            { user: { id: OTHER_USER }, query: { page: "1" } },
            mockRes()
        );
        expect(db.query.mock.calls.length).toBe(before);

        // This user's is not.
        db.query
            .mockResolvedValueOnce([[{ total: 0 }]])
            .mockResolvedValueOnce([[]]);
        const res = mockRes();
        await wishlistController.getUserWishlist(
            { user: { id: USER_ID }, query: { page: "1" } },
            res
        );
        expect(res.body.cached).toBe(false);
    });
});
