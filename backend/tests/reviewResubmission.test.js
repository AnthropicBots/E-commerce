// backend/tests/reviewResubmission.test.js
//
// A review you deleted is not a review you have (#1547).
//
// Review deletion has been a soft delete since #1349, so the row survives with
// `deleted_at` set. Every read filters it out -- `listProductReviews`,
// `getRatingBreakdown` and the product's cached rating all do -- but the
// duplicate-review guard on the create path did not, so the tombstone went on
// blocking the shopper forever. They were told "you have already reviewed this
// product" while the product page showed no review of theirs, with no way out
// of that state from the UI.
//
// The database is mocked at the module boundary, as the rest of this suite
// does. What is pinned here is which rows the guard is allowed to see, that it
// takes a lock while it looks, and that both product lookups ask whether the
// product is still on sale rather than merely whether the row exists.

jest.mock("../config/db", () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

jest.mock("../services/reviewModerationService", () => {
    class ReviewError extends Error {
        constructor(message, status = 400, code = "REVIEW_ERROR") {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    return {
        ReviewError,
        REPORT_REASONS: ["spam"],
        listProductReviews: jest.fn(),
        getRatingBreakdown: jest.fn(),
        voteHelpful: jest.fn(),
        unvoteHelpful: jest.fn(),
        reportReview: jest.fn(),
        getModerationQueue: jest.fn(),
        getReviewReports: jest.fn(),
        moderateReview: jest.fn()
    };
});

jest.mock("../models/Review", () => ({}));

const db = require("../config/db");
const reviewModerationService = require("../services/reviewModerationService");
const {
    PUBLIC_PRODUCT_STATUSES
} = require("../constants/productVisibility");

const {
    createProductReview,
    getProductReviews
} = require("../controllers/reviewController");

const PRODUCT = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const USER = "11111111-1111-4111-8111-111111111111";

function mockRes() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

/**
 * A connection double answering by statement shape.
 *
 * @param {object} options
 * @param {boolean} options.productLive   does the product lookup match?
 * @param {boolean} options.hasLiveReview does the duplicate guard match?
 * @param {boolean} options.hasPurchase   does the delivered-order check match?
 */
function fakeConnection({
    productLive = true,
    hasLiveReview = false,
    hasPurchase = true
} = {}) {
    const calls = [];

    return {
        calls,
        query: jest.fn(async (sql, params = []) => {
            calls.push({ sql, params });

            if (/FROM products/.test(sql)) {
                return [productLive ? [{ id: PRODUCT }] : []];
            }

            if (/FROM reviews/.test(sql)) {
                return [hasLiveReview ? [{ id: 42 }] : []];
            }

            if (/FROM orders/.test(sql)) {
                return [hasPurchase ? [{ id: "order-1" }] : []];
            }

            if (/INSERT INTO reviews/.test(sql)) {
                return [{ insertId: 99 }];
            }

            if (/SELECT[\s\S]*AVG\(rating\)/.test(sql)) {
                return [[{ average_rating: 4.5, review_count: 2 }]];
            }

            return [{ affectedRows: 1 }];
        }),
        beginTransaction: jest.fn().mockResolvedValue(),
        commit: jest.fn().mockResolvedValue(),
        rollback: jest.fn().mockResolvedValue(),
        release: jest.fn()
    };
}

function reviewGuard(connection) {
    return connection.calls.find(
        ({ sql }) => /SELECT/.test(sql) && /FROM reviews/.test(sql)
    );
}

function productLookup(connection) {
    return connection.calls.find(({ sql }) => /FROM products/.test(sql));
}

function validRequest(overrides = {}) {
    return {
        params: { id: PRODUCT },
        user: { id: USER },
        body: {
            rating: 5,
            comment: "Arrived on time and fits well.",
            ...overrides
        }
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
});

// ----------------------------------------------------------------------
// The duplicate guard
// ----------------------------------------------------------------------

describe("createProductReview — the duplicate guard", () => {
    test("ignores a review the shopper has already deleted", async () => {
        // `hasLiveReview: false` is what the guard now sees, because the
        // tombstone no longer matches the WHERE.
        const connection = fakeConnection({ hasLiveReview: false });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await createProductReview(validRequest(), res);

        expect(res.statusCode).toBe(201);
        expect(connection.commit).toHaveBeenCalled();
    });

    test("the guard only matches rows that are not soft-deleted", async () => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        await createProductReview(validRequest(), mockRes());

        expect(reviewGuard(connection).sql).toMatch(/deleted_at IS NULL/);
    });

    test("a live review still blocks a second one", async () => {
        const connection = fakeConnection({ hasLiveReview: true });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await createProductReview(validRequest(), res);

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/already reviewed/i);
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("nothing is inserted when a live review already exists", async () => {
        const connection = fakeConnection({ hasLiveReview: true });
        db.getConnection.mockResolvedValue(connection);

        await createProductReview(validRequest(), mockRes());

        expect(
            connection.calls.some(({ sql }) => /INSERT INTO reviews/.test(sql))
        ).toBe(false);
    });

    test("the guard takes a row lock so two submissions cannot both pass it", async () => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        await createProductReview(validRequest(), mockRes());

        // There is no unique key on (product_id, user_id) to catch a race, so
        // the lock is the only thing serialising them.
        expect(reviewGuard(connection).sql).toMatch(/FOR UPDATE/);
    });

    test("the guard is scoped to this product and this shopper", async () => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        await createProductReview(validRequest(), mockRes());

        expect(reviewGuard(connection).params).toEqual([PRODUCT, USER]);
    });
});

// ----------------------------------------------------------------------
// Product visibility
// ----------------------------------------------------------------------

describe("createProductReview — product visibility", () => {
    test("the product lookup carries the visibility predicate", async () => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        await createProductReview(validRequest(), mockRes());

        const lookup = productLookup(connection);

        expect(lookup.sql).toMatch(/p\.deleted_at IS NULL/);
        expect(lookup.sql).toMatch(/p\.status IN/);
        expect(lookup.params).toEqual([PRODUCT, ...PUBLIC_PRODUCT_STATUSES]);
    });

    test("a withdrawn product cannot be reviewed", async () => {
        const connection = fakeConnection({ productLive: false });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await createProductReview(validRequest(), res);

        expect(res.statusCode).toBe(404);
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("the product check runs before the duplicate guard", async () => {
        const connection = fakeConnection({ productLive: false });
        db.getConnection.mockResolvedValue(connection);

        await createProductReview(validRequest(), mockRes());

        expect(reviewGuard(connection)).toBeUndefined();
    });

    test("GET reviews 404s for a withdrawn product", async () => {
        db.query.mockResolvedValue([[]]);

        const res = mockRes();

        await getProductReviews({ params: { id: PRODUCT }, query: {} }, res);

        expect(res.statusCode).toBe(404);
        expect(reviewModerationService.listProductReviews).not.toHaveBeenCalled();
    });

    test("GET reviews still serves a live product", async () => {
        db.query.mockResolvedValue([[{ id: PRODUCT }]]);

        reviewModerationService.listProductReviews.mockResolvedValue({
            reviews: [],
            pagination: { page: 1 },
            sort: "recent"
        });

        reviewModerationService.getRatingBreakdown.mockResolvedValue({
            average: 4.5,
            total: 2,
            verifiedCount: 2,
            distribution: {}
        });

        const res = mockRes();

        await getProductReviews({ params: { id: PRODUCT }, query: {} }, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test("the GET lookup carries the visibility predicate too", async () => {
        db.query.mockResolvedValue([[]]);

        await getProductReviews({ params: { id: PRODUCT }, query: {} }, mockRes());

        const [sql, params] = db.query.mock.calls[0];

        expect(sql).toMatch(/p\.deleted_at IS NULL/);
        expect(sql).toMatch(/p\.status IN/);
        expect(params).toEqual([PRODUCT, ...PUBLIC_PRODUCT_STATUSES]);
    });
});

// ----------------------------------------------------------------------
// Rules that must not have moved
// ----------------------------------------------------------------------

describe("createProductReview — unchanged rules", () => {
    test("still requires a delivered order containing the product", async () => {
        const connection = fakeConnection({ hasPurchase: false });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await createProductReview(validRequest(), res);

        expect(res.statusCode).toBe(403);
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("still rejects a rating outside 1-5", async () => {
        const res = mockRes();

        await createProductReview(validRequest({ rating: 9 }), res);

        expect(res.statusCode).toBe(400);
        expect(db.getConnection).not.toHaveBeenCalled();
    });

    test("still rejects an empty comment", async () => {
        const res = mockRes();

        await createProductReview(validRequest({ comment: "x" }), res);

        expect(res.statusCode).toBe(400);
    });

    test("still refreshes the product's cached rating on success", async () => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        await createProductReview(validRequest(), mockRes());

        const refresh = connection.calls.find(({ sql }) =>
            /UPDATE products/.test(sql) && /num_reviews/.test(sql)
        );

        expect(refresh).toBeDefined();
    });
});
