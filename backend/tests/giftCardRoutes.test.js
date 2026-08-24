// backend/tests/giftCardRoutes.test.js
//
// The gift card router was written, hardened (#1478) and never mounted, so
// every path it serves answered 404 while giftCardService and both migrations
// were live in the tree (#1652). Two things are checked here: that the router
// behaves over HTTP, and -- the part that actually failed -- that it is
// reachable at all.

const request = require("supertest");
const express = require("express");

jest.mock("../middleware/authMiddleware", () =>
    jest.fn((req, res, next) => {
        req.user = { id: "user-123", role: req.headers["x-test-role"] || "user" };
        next();
    })
);

jest.mock("../middleware/rbacMiddleware", () => ({
    authorizeRoles: (...roles) =>
        function authorizeRolesMiddleware(req, res, next) {
            if (!roles.includes(req.user?.role)) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden"
                });
            }
            next();
        }
}));

class FakeGiftCardError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "GiftCardError";
        this.code = code;
    }
}

jest.mock("../services/giftCardService", () => {
    const service = {
        issue: jest.fn(),
        getBalance: jest.fn(),
        applyToOrder: jest.fn()
    };
    return service;
});

const giftCardService = require("../services/giftCardService");
giftCardService.GiftCardError = FakeGiftCardError;

const giftCardRoutes = require("../routes/giftCardRoutes");

const app = express();
app.use(express.json());
app.use("/api/gift-cards", giftCardRoutes);

const asAdmin = (req) => req.set("x-test-role", "admin");

describe("gift card routes are mounted", () => {
    // The regression itself. `routes/index.js` is the map server.js mounts at
    // boot (`server.js:313`); if the entry is not in it, nothing else in this
    // file matters.
    //
    // Read as source rather than required: `require("../routes")` pulls in
    // every router in the application, which is a hundred modules and their
    // service graphs, to answer a question about one line of a lookup table.
    const fs = require("fs");
    const path = require("path");

    const read = (relative) =>
        fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

    const routeMapSource = read("routes/index.js");
    const serverSource = read("server.js");

    test("routes/index.js carries a gift card entry", () => {
        expect(routeMapSource).toMatch(
            /["']\/api\/gift-cards["']\s*:\s*require\(["']\.\/giftCardRoutes["']\)/
        );
    });

    test("server.js no longer requires a router it does not mount", () => {
        expect(serverSource).not.toMatch(
            /require\(["']\.\/routes\/giftCardRoutes["']\)/
        );
    });

    // The general form of the same defect: server.js pulling in a router that
    // then reaches no URL. There are two legitimate ways to mount one -- an
    // `app.use` in server.js, or an entry in the routes/index.js map -- and
    // gift cards had neither, which is how the feature went dark with its
    // service and both its migrations live in the tree.
    test("every router server.js requires reaches a URL", () => {
        // `complexityRoutes` is dangling the same way gift cards were: required
        // at server.js:130, mounted nowhere. It is left that way deliberately.
        // Its seven endpoints report architecture-complexity analysis of this
        // codebase, and quietly publishing them as a side effect of a gift card
        // fix is a disclosure decision that is not this PR's to make. Named
        // here so the guard stays green and the debt stays visible rather than
        // invisible, which is the state that produced #1652.
        const KNOWN_UNMOUNTED = ["complexityRoutes"];

        const dangling = [];

        for (const match of serverSource.matchAll(
            /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(["']\.\/routes\/([\w.]+)["']\)/g
        )) {
            const [, binding, moduleName] = match;

            const mountedDirectly = new RegExp(
                `app\\.use\\(\\s*(?:[^,]+,\\s*)?${binding}\\b`
            ).test(serverSource);

            const mountedViaMap = new RegExp(
                `require\\(["']\\./${moduleName}["']\\)`
            ).test(routeMapSource);

            if (
                !mountedDirectly &&
                !mountedViaMap &&
                !KNOWN_UNMOUNTED.includes(binding)
            ) {
                dangling.push(binding);
            }
        }

        expect(dangling).toEqual([]);
    });
});

describe("POST /api/gift-cards/issue", () => {
    beforeEach(() => jest.clearAllMocks());

    test("issues a card for an admin and returns the code once", async () => {
        giftCardService.issue.mockResolvedValueOnce({
            id: 7,
            code: "GC-PLAINTEXT-ONCE",
            amount: 500,
            currency: "INR"
        });

        const res = await asAdmin(
            request(app).post("/api/gift-cards/issue")
        ).send({ amount: 500, currency: "INR" });

        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.code).toBe("GC-PLAINTEXT-ONCE");
        expect(giftCardService.issue).toHaveBeenCalledWith({
            amount: 500,
            currency: "INR",
            expiresAt: undefined
        });
    });

    test("refuses a non-admin", async () => {
        const res = await request(app)
            .post("/api/gift-cards/issue")
            .send({ amount: 500 });

        expect(res.statusCode).toBe(403);
        expect(giftCardService.issue).not.toHaveBeenCalled();
    });

    test("maps INVALID_AMOUNT onto 400", async () => {
        giftCardService.issue.mockRejectedValueOnce(
            new FakeGiftCardError("Amount must be positive", "INVALID_AMOUNT")
        );

        const res = await asAdmin(
            request(app).post("/api/gift-cards/issue")
        ).send({ amount: -1 });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe("Amount must be positive");
    });
});

describe("POST /api/gift-cards/balance", () => {
    beforeEach(() => jest.clearAllMocks());

    test("returns the balance for a code in the body", async () => {
        giftCardService.getBalance.mockResolvedValueOnce({
            balance: 250,
            currency: "INR"
        });

        const res = await request(app)
            .post("/api/gift-cards/balance")
            .send({ code: "GC-ABC" });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.balance).toBe(250);
        expect(giftCardService.getBalance).toHaveBeenCalledWith("GC-ABC");
    });

    test("requires a code", async () => {
        const res = await request(app)
            .post("/api/gift-cards/balance")
            .send({});

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/code is required/i);
        expect(giftCardService.getBalance).not.toHaveBeenCalled();
    });

    test("answers NOT_FOUND with a 404", async () => {
        giftCardService.getBalance.mockRejectedValueOnce(
            new FakeGiftCardError("Gift card not found", "NOT_FOUND")
        );

        const res = await request(app)
            .post("/api/gift-cards/balance")
            .send({ code: "GC-NOPE" });

        expect(res.statusCode).toBe(404);
    });

    test("an expired card is a 410", async () => {
        giftCardService.getBalance.mockRejectedValueOnce(
            new FakeGiftCardError("Gift card expired", "EXPIRED")
        );

        const res = await request(app)
            .post("/api/gift-cards/balance")
            .send({ code: "GC-OLD" });

        expect(res.statusCode).toBe(410);
    });
});

describe("POST /api/gift-cards/redeem", () => {
    beforeEach(() => jest.clearAllMocks());

    test("redeems against an order and reports a full settlement", async () => {
        giftCardService.applyToOrder.mockResolvedValueOnce({
            applied: 300,
            remainingBalance: 0,
            orderSettled: true
        });

        const res = await request(app)
            .post("/api/gift-cards/redeem")
            .send({ code: "GC-ABC", orderId: "order-1", amount: 300 });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toMatch(/paid in full/i);

        // The owner comes from the token, never from the body -- authMiddleware
        // establishes who is calling, not that the order is theirs.
        expect(giftCardService.applyToOrder).toHaveBeenCalledWith(
            "GC-ABC",
            "order-1",
            300,
            null,
            { userId: "user-123" }
        );
    });

    test("a partial redemption does not claim the order is paid", async () => {
        giftCardService.applyToOrder.mockResolvedValueOnce({
            applied: 100,
            remainingBalance: 0,
            orderSettled: false
        });

        const res = await request(app)
            .post("/api/gift-cards/redeem")
            .send({ code: "GC-ABC", orderId: "order-1" });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe("Gift card redeemed");
    });

    test("requires an order id (#1478)", async () => {
        const res = await request(app)
            .post("/api/gift-cards/redeem")
            .send({ code: "GC-ABC" });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/order ID is required/i);
        expect(giftCardService.applyToOrder).not.toHaveBeenCalled();
    });

    test("requires a code", async () => {
        const res = await request(app)
            .post("/api/gift-cards/redeem")
            .send({ orderId: "order-1" });

        expect(res.statusCode).toBe(400);
        expect(giftCardService.applyToOrder).not.toHaveBeenCalled();
    });

    test("answers ORDER_NOT_FOUND with 404 rather than 403", async () => {
        // "not yours" and "no such order" have to be indistinguishable, or the
        // endpoint enumerates order ids.
        giftCardService.applyToOrder.mockRejectedValueOnce(
            new FakeGiftCardError("Order not found", "ORDER_NOT_FOUND")
        );

        const res = await request(app)
            .post("/api/gift-cards/redeem")
            .send({ code: "GC-ABC", orderId: "someone-elses-order" });

        expect(res.statusCode).toBe(404);
    });

    test("an insufficient balance is a 402", async () => {
        giftCardService.applyToOrder.mockRejectedValueOnce(
            new FakeGiftCardError("Insufficient balance", "INSUFFICIENT_BALANCE")
        );

        const res = await request(app)
            .post("/api/gift-cards/redeem")
            .send({ code: "GC-ABC", orderId: "order-1", amount: 10000 });

        expect(res.statusCode).toBe(402);
    });

    test("an already-settled order is a 409", async () => {
        giftCardService.applyToOrder.mockRejectedValueOnce(
            new FakeGiftCardError("This order has nothing left to pay", "ORDER_SETTLED")
        );

        const res = await request(app)
            .post("/api/gift-cards/redeem")
            .send({ code: "GC-ABC", orderId: "order-1" });

        expect(res.statusCode).toBe(409);
    });

    test("an unrecognised failure is a 500, not a leaked message", async () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});

        giftCardService.applyToOrder.mockRejectedValueOnce(
            new Error("ER_LOCK_DEADLOCK: retry the transaction")
        );

        const res = await request(app)
            .post("/api/gift-cards/redeem")
            .send({ code: "GC-ABC", orderId: "order-1" });

        expect(res.statusCode).toBe(500);
        expect(res.body.message).toBe("Internal server error");

        spy.mockRestore();
    });
});
