// backend/tests/reviewEngagementRoutes.test.js
//
// The seven review handlers that had no path (#1493).
//
// `reviewModerationService` was already covered end to end by
// reviewModeration.test.js and sat at 92% line coverage. None of it was
// reachable over HTTP: productRoutes.js imported all ten review handlers and
// registered three, so the Helpful and Report buttons on every product page
// answered 404 from the router's own fallback.
//
// That is the gap these tests close, and it is a routing gap, so they are
// routing tests: the service is mocked and what is asserted is which handler a
// verb and a path reach, what status comes back, and that the admin paths are
// gated. The service's own behaviour is not re-tested here.
//
// The ordering assertions matter as much as the wiring ones. Express matches
// in declaration order, so `/reviews/moderation/queue` has to be declared
// above `/:id`, or the parameterised product route captures "reviews" as a
// product id and the queue 400s on a uuid check. This file pins that.

// Auth middleware is a stub that injects whatever `mockUser` holds. jest only
// lets a factory closure reference `mock`-prefixed vars. The module is also a
// function with an `optionalAuth` property in the real code, and productRoutes
// destructures both, so the stub has to be shaped the same way.
let mockUser = { id: "11111111-1111-4111-8111-111111111111", role: "user" };

jest.mock("../middleware/authMiddleware", () => {
    const stub = (req, res, next) => {
        if (!mockUser) {
            return res
                .status(401)
                .json({ success: false, message: "Authentication required" });
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

// `authorizeRoles` re-reads the user from the database before it looks at the
// role, so the admin routes cannot be exercised without one. The stub answers
// the users lookup from `mockUser` and everything else with no rows.
jest.mock("../config/db", () => ({
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
        return [[]];
    }),
    getConnection: jest.fn()
}));

jest.mock("../services/reviewModerationService", () => {
    const REPORT_REASONS = Object.freeze([
        "spam",
        "offensive",
        "off_topic",
        "fake",
        "personal_info",
        "other"
    ]);

    class ReviewError extends Error {
        constructor(message, status = 400, code = "REVIEW_ERROR") {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    return {
        voteHelpful: jest.fn(),
        unvoteHelpful: jest.fn(),
        reportReview: jest.fn(),
        getModerationQueue: jest.fn(),
        getReviewReports: jest.fn(),
        moderateReview: jest.fn(),
        listProductReviews: jest.fn(),
        ReviewError,
        REPORT_REASONS
    };
});

const express = require("express");
const request = require("supertest");

const reviewModerationService = require("../services/reviewModerationService");
const { ReviewError } = require("../services/reviewModerationService");
const productRoutes = require("../routes/productRoutes");

const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN = { id: "33333333-3333-4333-8333-333333333333", role: "admin" };
const SHOPPER = { id: "11111111-1111-4111-8111-111111111111", role: "user" };

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/products", productRoutes);
    return app;
}

const app = buildApp();

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = SHOPPER;
});

// ---------------------------------------------------------------------------
// Helpful votes
// ---------------------------------------------------------------------------

describe("POST /api/products/:id/reviews/:reviewId/helpful", () => {
    test("records a vote for the signed-in caller", async () => {
        reviewModerationService.voteHelpful.mockResolvedValue({
            reviewId: 7,
            helpfulCount: 5,
            alreadyVoted: false
        });

        const res = await request(app)
            .post(`/api/products/${PRODUCT_ID}/reviews/7/helpful`)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.helpfulCount).toBe(5);
        expect(reviewModerationService.voteHelpful).toHaveBeenCalledWith(
            SHOPPER.id,
            7
        );
    });

    test("a second vote is reported rather than counted twice", async () => {
        reviewModerationService.voteHelpful.mockResolvedValue({
            reviewId: 7,
            helpfulCount: 5,
            alreadyVoted: true
        });

        const res = await request(app)
            .post(`/api/products/${PRODUCT_ID}/reviews/7/helpful`)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/already marked this review as helpful/i);
    });

    test("rejects a non-numeric review id before reaching the service", async () => {
        const res = await request(app)
            .post(`/api/products/${PRODUCT_ID}/reviews/not-a-number/helpful`)
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Invalid review ID/i);
        expect(reviewModerationService.voteHelpful).not.toHaveBeenCalled();
    });

    test("requires authentication", async () => {
        mockUser = null;

        const res = await request(app)
            .post(`/api/products/${PRODUCT_ID}/reviews/7/helpful`)
            .send({});

        expect(res.status).toBe(401);
        expect(reviewModerationService.voteHelpful).not.toHaveBeenCalled();
    });

    test("a ReviewError carries its own status through", async () => {
        reviewModerationService.voteHelpful.mockRejectedValue(
            new ReviewError("You cannot vote on your own review", 403, "OWN_REVIEW")
        );

        const res = await request(app)
            .post(`/api/products/${PRODUCT_ID}/reviews/7/helpful`)
            .send({});

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("OWN_REVIEW");
    });

    test("an unexpected failure does not leak its detail", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        reviewModerationService.voteHelpful.mockRejectedValue(
            new Error("ER_NO_SUCH_TABLE: review_helpful_votes")
        );

        const res = await request(app)
            .post(`/api/products/${PRODUCT_ID}/reviews/7/helpful`)
            .send({});

        expect(res.status).toBe(500);
        expect(res.body.message).not.toMatch(/ER_NO_SUCH_TABLE/);

        console.error.mockRestore();
    });
});

describe("DELETE /api/products/:id/reviews/:reviewId/helpful", () => {
    test("withdraws the vote", async () => {
        reviewModerationService.unvoteHelpful.mockResolvedValue({
            reviewId: 7,
            helpfulCount: 4
        });

        const res = await request(app).delete(
            `/api/products/${PRODUCT_ID}/reviews/7/helpful`
        );

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/withdrawn/i);
        expect(reviewModerationService.unvoteHelpful).toHaveBeenCalledWith(
            SHOPPER.id,
            7
        );
    });

    test("does not collide with the review delete route one segment shorter", async () => {
        reviewModerationService.unvoteHelpful.mockResolvedValue({
            reviewId: 7,
            helpfulCount: 4
        });

        await request(app).delete(`/api/products/${PRODUCT_ID}/reviews/7/helpful`);

        // `DELETE /:id/reviews/:reviewId` is the review delete and runs an
        // ownership check. If the two ever collide this call goes through it
        // instead, so assert the vote handler is what ran.
        expect(reviewModerationService.unvoteHelpful).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

describe("POST /api/products/:id/reviews/:reviewId/report", () => {
    test("passes the reason and details through to the service", async () => {
        reviewModerationService.reportReview.mockResolvedValue({
            reviewId: 7,
            alreadyReported: false
        });

        const res = await request(app)
            .post(`/api/products/${PRODUCT_ID}/reviews/7/report`)
            .send({ reason: "spam", details: "links to another shop" });

        expect(res.status).toBe(200);
        expect(reviewModerationService.reportReview).toHaveBeenCalledWith(
            SHOPPER.id,
            7,
            { reason: "spam", details: "links to another shop" }
        );
    });

    test("the answer is the same whether or not the threshold was crossed", async () => {
        // The service returns the same shape either way; what is asserted here
        // is that the route adds nothing to it. Telling a reporter "two more
        // and it disappears" is an invitation to organise.
        reviewModerationService.reportReview.mockResolvedValue({
            reviewId: 7,
            alreadyReported: false,
            reportedCount: 3,
            autoFlagged: true
        });

        const res = await request(app)
            .post(`/api/products/${PRODUCT_ID}/reviews/7/report`)
            .send({ reason: "offensive" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            message: expect.stringMatching(/sent for moderation/i),
            reviewId: 7
        });
        expect(res.body.autoFlagged).toBeUndefined();
        expect(res.body.reportedCount).toBeUndefined();
    });

    test("requires authentication", async () => {
        mockUser = null;

        const res = await request(app)
            .post(`/api/products/${PRODUCT_ID}/reviews/7/report`)
            .send({ reason: "spam" });

        expect(res.status).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// The reason list
// ---------------------------------------------------------------------------

describe("GET /api/products/reviews/moderation/reasons", () => {
    test("is public and returns the server's list", async () => {
        mockUser = null;

        const res = await request(app).get(
            "/api/products/reviews/moderation/reasons"
        );

        expect(res.status).toBe(200);
        expect(res.body.reasons).toEqual([
            "spam",
            "offensive",
            "off_topic",
            "fake",
            "personal_info",
            "other"
        ]);
    });

    test("is not captured by /:id", async () => {
        // "reviews" is not a uuid. If this path fell through to `GET /:id` the
        // uuid guard would answer 400 with "Invalid product ID" instead, which
        // is what happens if the declaration order in productRoutes.js is ever
        // rearranged.
        const res = await request(app).get(
            "/api/products/reviews/moderation/reasons"
        );

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.reasons)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Admin moderation
// ---------------------------------------------------------------------------

describe("GET /api/products/reviews/moderation/queue", () => {
    test("returns the queue for an admin", async () => {
        mockUser = ADMIN;
        reviewModerationService.getModerationQueue.mockResolvedValue({
            reviews: [{ id: 7, reportedCount: 3 }],
            pagination: { page: 1, limit: 20, total: 1, pages: 1 }
        });

        const res = await request(app).get(
            "/api/products/reviews/moderation/queue?status=pending&page=1&limit=20"
        );

        expect(res.status).toBe(200);
        expect(res.body.reviews).toHaveLength(1);
        expect(reviewModerationService.getModerationQueue).toHaveBeenCalledWith({
            status: "pending",
            page: "1",
            limit: "20"
        });
    });

    test("is refused to a signed-in shopper", async () => {
        mockUser = SHOPPER;

        const res = await request(app).get(
            "/api/products/reviews/moderation/queue"
        );

        expect(res.status).toBe(403);
        expect(reviewModerationService.getModerationQueue).not.toHaveBeenCalled();
    });

    test("is refused to an anonymous caller", async () => {
        mockUser = null;

        const res = await request(app).get(
            "/api/products/reviews/moderation/queue"
        );

        expect(res.status).toBe(401);
        expect(reviewModerationService.getModerationQueue).not.toHaveBeenCalled();
    });
});

describe("GET /api/products/reviews/:reviewId/reports", () => {
    test("returns the reports behind a queued review", async () => {
        mockUser = ADMIN;
        reviewModerationService.getReviewReports.mockResolvedValue([
            { id: 1, reason: "spam" },
            { id: 2, reason: "fake" }
        ]);

        const res = await request(app).get("/api/products/reviews/7/reports");

        expect(res.status).toBe(200);
        expect(res.body.reviewId).toBe(7);
        expect(res.body.reports).toHaveLength(2);
    });

    test("is admin only", async () => {
        mockUser = SHOPPER;

        const res = await request(app).get("/api/products/reviews/7/reports");

        expect(res.status).toBe(403);
    });
});

describe("PATCH /api/products/reviews/:reviewId/moderate", () => {
    test("records the decision against the acting admin", async () => {
        mockUser = ADMIN;
        reviewModerationService.moderateReview.mockResolvedValue({
            reviewId: 7,
            status: "rejected"
        });

        const res = await request(app)
            .patch("/api/products/reviews/7/moderate")
            .send({ status: "rejected", notes: "advertising" });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Review rejected");
        expect(reviewModerationService.moderateReview).toHaveBeenCalledWith(
            ADMIN.id,
            7,
            { status: "rejected", notes: "advertising" }
        );
    });

    test("is admin only", async () => {
        mockUser = SHOPPER;

        const res = await request(app)
            .patch("/api/products/reviews/7/moderate")
            .send({ status: "approved" });

        expect(res.status).toBe(403);
        expect(reviewModerationService.moderateReview).not.toHaveBeenCalled();
    });

    test("rejects an unusable review id before reaching the service", async () => {
        mockUser = ADMIN;

        const res = await request(app)
            .patch("/api/products/reviews/abc/moderate")
            .send({ status: "approved" });

        expect(res.status).toBe(400);
        expect(reviewModerationService.moderateReview).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// What used to be there
// ---------------------------------------------------------------------------

describe("the routes that were wrong before", () => {
    test("POST /api/products/products/review answers instead of hanging", async () => {
        // There was a route here with an empty handler: no response, no
        // next(), no throw, so the request hung with the connection open until
        // the client gave up. supertest would time this test out rather than
        // fail it if the route were still declared.
        //
        // With it gone the path falls through to `POST /:id/review` with
        // `:id = "products"`, which is not a uuid, so the guard answers 400.
        // That is the correct answer to a request naming a product that cannot
        // exist, and it is an answer.
        const res = await request(app)
            .post("/api/products/products/review")
            .send({ rating: 5, comment: "hello" });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Invalid product ID/i);
    });

    test("every review handler the controller exports has a route", () => {
        // The defect was an import list longer than the registration list, and
        // nothing noticed. Read the router source and check each name appears
        // somewhere other than the destructure that imports it.
        const fs = require("fs");
        const path = require("path");

        const source = fs.readFileSync(
            path.join(__dirname, "..", "routes", "productRoutes.js"),
            "utf8"
        );

        const handlers = [
            "getProductReviews",
            "createProductReview",
            "deleteProductReview",
            "markReviewHelpful",
            "unmarkReviewHelpful",
            "reportReview",
            "getReportReasons",
            "getModerationQueue",
            "getReviewReports",
            "moderateReview"
        ];

        // One occurrence means the name is imported and never registered.
        const unregistered = handlers.filter(
            (handler) => source.split(handler).length - 1 < 2
        );

        expect(unregistered).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// The frontend's side of the contract
// ---------------------------------------------------------------------------
//
// `frontendApiPaths.test.js` checks that every path the frontend asks for has a
// mounted *prefix*. `/products` is mounted, so `/products/<id>/reviews/7/helpful`
// passed that test while 404ing in production -- the prefix was right and the
// leaf did not exist. That test was written for the `promo` vs `promos` class of
// defect (#1445) and a missing leaf is a case it cannot see.
//
// This does the deeper check for the paths this router serves: read them out of
// product-reviews.js, substitute the interpolations, and send each one at the
// real router. Anything that comes back as the router's own 404 fallback is a
// call the frontend makes and the API does not answer.

describe("the paths product-reviews.js actually calls", () => {
    const fs = require("fs");
    const path = require("path");

    const source = fs.readFileSync(
        path.join(
            __dirname,
            "..",
            "..",
            "frontend",
            "scripts",
            "product-reviews.js"
        ),
        "utf8"
    );

    /**
     * Every literal path passed to apiRequest in that file, template
     * interpolations intact and the query string dropped.
     *
     * @returns {string[]}
     */
    const requested = [
        ...new Set(
            [...source.matchAll(/apiRequest\(\s*(["'`])(\/[^"'`]*)\1/g)]
                .map((match) => match[2].split("?")[0])
        )
    ];

    /**
     * The verbs the frontend sends each of those paths, and the concrete path
     * to send at the router.
     *
     * `${activeProductId}` becomes a uuid because the `:id` guard requires
     * one; `${reviewId}` becomes a number because `reviews.id` is an
     * AUTO_INCREMENT integer.
     */
    const CALLS = {
        "/products/${activeProductId}/reviews": ["get"],
        "/products/${activeProductId}/review": ["post"],
        "/products/${activeProductId}/reviews/${reviewId}": ["delete"],
        "/products/${activeProductId}/reviews/${reviewId}/helpful": ["post", "delete"],
        "/products/${activeProductId}/reviews/${reviewId}/report": ["post"],
        "/products/reviews/moderation/reasons": ["get"]
    };

    const concrete = (template) =>
        template
            .replace(/\$\{activeProductId\}/g, PRODUCT_ID)
            .replace(/\$\{reviewId\}/g, "7")
            .replace(/^\/products/, "");

    test("every path the file calls is listed here", () => {
        // So that adding a call to product-reviews.js without adding a route
        // fails on this line rather than in a shopper's browser.
        expect(requested.sort()).toEqual(Object.keys(CALLS).sort());
    });

    test("none of them reaches the router's 404 fallback", async () => {
        mockUser = ADMIN;

        // Every service method resolves to something harmless, so the only way
        // to the fallback is a path nothing serves.
        for (const key of Object.keys(reviewModerationService)) {
            if (typeof reviewModerationService[key]?.mockResolvedValue === "function") {
                reviewModerationService[key].mockResolvedValue({});
            }
        }

        const missing = [];

        for (const [template, verbs] of Object.entries(CALLS)) {
            for (const verb of verbs) {
                const res = await request(app)[verb](
                    `/api/products${concrete(template)}`
                );

                if (
                    res.status === 404 &&
                    res.body?.message === "Product route not found"
                ) {
                    missing.push(`${verb.toUpperCase()} ${template}`);
                }
            }
        }

        // Before this change the list was:
        //   POST   .../reviews/${reviewId}/helpful
        //   DELETE .../reviews/${reviewId}/helpful
        //   POST   .../reviews/${reviewId}/report
        //   GET    /products/reviews/moderation/reasons
        expect(missing).toEqual([]);
    });
});
