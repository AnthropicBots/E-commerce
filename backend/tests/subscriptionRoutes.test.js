// backend/tests/subscriptionRoutes.test.js
//
// The subscription API and the renewal sweep (#1494).
//
// Two things are covered here that the service tests cannot be:
//
//   * the router had four routes and all four were writes. A shopper could
//     subscribe, pause, resume and cancel and had no way to see what they were
//     subscribed to. `GET /me` and `GET /plans` are asserted to exist and to
//     be scoped the way they should be.
//   * the sweep's decision table. The old job's payment step was
//     `Math.random() > 0.2`, so what happened to a customer's subscription
//     depended on a coin flip; the tests below pin each outcome to a cause.

let mockUser = { id: "44444444-4444-4444-8444-444444444444" };

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

jest.mock("../services/subscriptionService", () => {
    class SubscriptionError extends Error {
        constructor(message, status = 400, code = "SUBSCRIPTION_ERROR") {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    return {
        SubscriptionError,
        MAX_DUNNING_RETRIES: 3,
        listPlans: jest.fn(),
        getForUser: jest.fn(),
        subscribe: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        cancel: jest.fn(),
        findDueForRenewal: jest.fn(),
        completeCancellation: jest.fn(),
        recordRenewal: jest.fn(),
        recordDunningFailure: jest.fn()
    };
});

const express = require("express");
const request = require("supertest");

const subscriptionService = require("../services/subscriptionService");
const { SubscriptionError } = require("../services/subscriptionService");
const subscriptionRoutes = require("../routes/subscriptionRoutes");
const renewalJob = require("../jobs/subscriptionRenewalJob");

const app = express();
app.use(express.json());
app.use("/api/subscriptions", subscriptionRoutes);

const SUBSCRIPTION = {
    id: 5,
    status: "active",
    currentPeriodStart: "2026-06-01T00:00:00.000Z",
    currentPeriodEnd: "2026-07-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    plan: { id: 2, name: "Monthly", price: 499, currency: "INR", interval: "monthly" }
};

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "44444444-4444-4444-8444-444444444444" };
});

// ---------------------------------------------------------------------------
// The reads that did not exist
// ---------------------------------------------------------------------------

describe("GET /api/subscriptions/plans", () => {
    test("is public", async () => {
        mockUser = null;
        subscriptionService.listPlans.mockResolvedValue([
            { id: 2, name: "Monthly", price: 499 }
        ]);

        const res = await request(app).get("/api/subscriptions/plans");

        expect(res.status).toBe(200);
        expect(res.body.data.plans).toHaveLength(1);
    });

    test("uses the documented envelope", async () => {
        subscriptionService.listPlans.mockResolvedValue([]);

        const res = await request(app).get("/api/subscriptions/plans");

        expect(res.body).toEqual({
            success: true,
            message: expect.any(String),
            data: { plans: [] }
        });
    });
});

describe("GET /api/subscriptions/me", () => {
    test("returns the caller's subscription", async () => {
        subscriptionService.getForUser.mockResolvedValue(SUBSCRIPTION);

        const res = await request(app).get("/api/subscriptions/me");

        expect(res.status).toBe(200);
        expect(res.body.data.subscription.id).toBe(5);
        expect(subscriptionService.getForUser).toHaveBeenCalledWith(mockUser.id);
    });

    test("answers 200 with null rather than 404 when there is none", async () => {
        // A 404 here is indistinguishable from a route that does not exist,
        // which is the confusion this endpoint is fixing.
        subscriptionService.getForUser.mockResolvedValue(null);

        const res = await request(app).get("/api/subscriptions/me");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.subscription).toBeNull();
    });

    test("requires authentication", async () => {
        mockUser = null;

        const res = await request(app).get("/api/subscriptions/me");

        expect(res.status).toBe(401);
    });

    test("is not captured by another route", async () => {
        subscriptionService.getForUser.mockResolvedValue(null);

        const res = await request(app).get("/api/subscriptions/me");

        expect(res.body.message).not.toBe("Subscription route not found");
    });
});

// ---------------------------------------------------------------------------
// The writes
// ---------------------------------------------------------------------------

describe("POST /api/subscriptions/subscribe", () => {
    test("answers 201 and returns the subscription", async () => {
        subscriptionService.subscribe.mockResolvedValue(SUBSCRIPTION);

        const res = await request(app)
            .post("/api/subscriptions/subscribe")
            .send({ planId: 2 });

        expect(res.status).toBe(201);
        expect(res.body.data.subscription.id).toBe(5);
        expect(subscriptionService.subscribe).toHaveBeenCalledWith(mockUser.id, 2);
    });

    test("keeps the top-level periodEnd the old handler returned", async () => {
        subscriptionService.subscribe.mockResolvedValue(SUBSCRIPTION);

        const res = await request(app)
            .post("/api/subscriptions/subscribe")
            .send({ planId: 2 });

        expect(res.body.periodEnd).toBe(SUBSCRIPTION.currentPeriodEnd);
    });

    test("a service error carries its own status and code", async () => {
        subscriptionService.subscribe.mockRejectedValue(
            new SubscriptionError("Billing plan not found", 404, "PLAN_NOT_FOUND")
        );

        const res = await request(app)
            .post("/api/subscriptions/subscribe")
            .send({ planId: 99 });

        expect(res.status).toBe(404);
        expect(res.body.code).toBe("PLAN_NOT_FOUND");
    });

    test("an unexpected failure does not leak its detail", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        subscriptionService.subscribe.mockRejectedValue(
            new Error("ER_PARSE_ERROR near 'interval'")
        );

        const res = await request(app)
            .post("/api/subscriptions/subscribe")
            .send({ planId: 2 });

        expect(res.status).toBe(500);
        expect(res.body.message).not.toMatch(/ER_PARSE_ERROR/);

        console.error.mockRestore();
    });
});

describe("POST /api/subscriptions/resume", () => {
    test("says which of the two things it did", async () => {
        subscriptionService.resume.mockResolvedValue({
            ...SUBSCRIPTION,
            withdrewCancellation: true
        });

        const res = await request(app).post("/api/subscriptions/resume");

        expect(res.body.message).toMatch(/cancellation withdrawn/i);
    });

    test("and says the other one when that is what happened", async () => {
        subscriptionService.resume.mockResolvedValue({
            ...SUBSCRIPTION,
            withdrewCancellation: false
        });

        const res = await request(app).post("/api/subscriptions/resume");

        expect(res.body.message).toBe("Subscription resumed");
    });
});

describe("POST /api/subscriptions/cancel", () => {
    test("reports the pending cancellation back to the caller", async () => {
        subscriptionService.cancel.mockResolvedValue({
            ...SUBSCRIPTION,
            cancelAtPeriodEnd: true
        });

        const res = await request(app).post("/api/subscriptions/cancel");

        expect(res.status).toBe(200);
        // The old handler answered with a message and nothing else, so the
        // shopper had no way to find out when "the end of the billing period"
        // was -- there was no endpoint that would tell them.
        expect(res.body.data.subscription.currentPeriodEnd).toBeDefined();
        expect(res.body.data.subscription.cancelAtPeriodEnd).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

describe("processRenewals", () => {
    const DUE = (overrides = {}) => ({
        id: 5,
        user_id: "44444444-4444-4444-8444-444444444444",
        plan_id: 2,
        status: "active",
        cancel_at_period_end: 0,
        current_period_start: new Date("2026-05-01T00:00:00Z"),
        current_period_end: new Date("2026-06-01T00:00:00Z"),
        dunning_retry_count: 0,
        price: 499,
        currency: "INR",
        interval: "monthly",
        interval_count: 1,
        ...overrides
    });

    const NOW = new Date("2026-06-02T00:00:00Z");

    test("does nothing when nothing is due", async () => {
        subscriptionService.findDueForRenewal.mockResolvedValue([]);

        const summary = await renewalJob.processRenewals({ now: NOW });

        expect(summary.due).toBe(0);
        expect(subscriptionService.recordRenewal).not.toHaveBeenCalled();
    });

    test("renews on a successful charge", async () => {
        subscriptionService.findDueForRenewal.mockResolvedValue([DUE()]);
        subscriptionService.recordRenewal.mockResolvedValue({
            outcome: "renewed",
            periodEnd: new Date("2026-07-01T00:00:00Z"),
            periodsBilled: 1
        });

        const summary = await renewalJob.processRenewals({
            now: NOW,
            charge: async () => ({ configured: true, success: true })
        });

        expect(summary.renewed).toBe(1);
        expect(subscriptionService.recordRenewal).toHaveBeenCalled();
    });

    test("ends a subscription the customer asked to end", async () => {
        subscriptionService.findDueForRenewal.mockResolvedValue([
            DUE({ cancel_at_period_end: 1 })
        ]);
        subscriptionService.completeCancellation.mockResolvedValue({ outcome: "canceled" });

        const summary = await renewalJob.processRenewals({
            now: NOW,
            charge: async () => ({ configured: true, success: true })
        });

        expect(summary.canceled).toBe(1);
        // Not charged. Taking money for a period the customer cancelled is the
        // one outcome nobody would defend.
        expect(subscriptionService.recordRenewal).not.toHaveBeenCalled();
    });

    test("a declined charge goes to dunning, not straight to cancellation", async () => {
        subscriptionService.findDueForRenewal.mockResolvedValue([DUE()]);
        subscriptionService.recordDunningFailure.mockResolvedValue({
            outcome: "past_due",
            retries: 1
        });

        const summary = await renewalJob.processRenewals({
            now: NOW,
            charge: async () => ({ configured: true, success: false })
        });

        expect(summary.pastDue).toBe(1);
        expect(summary.canceled).toBe(0);
    });

    test("leaves the row alone when no payment provider is configured", async () => {
        // The distinction this whole change turns on. A missing integration is
        // not a customer whose card was declined, and the old code expressed
        // "we have not built billing" as `Math.random() > 0.2` -- which
        // cancelled real subscriptions after three unlucky sweeps.
        subscriptionService.findDueForRenewal.mockResolvedValue([DUE(), DUE({ id: 6 })]);

        const summary = await renewalJob.processRenewals({
            now: NOW,
            charge: async () => ({ configured: false, reason: "not wired up" })
        });

        expect(summary.skipped).toBe(2);
        expect(summary.canceled).toBe(0);
        expect(subscriptionService.recordDunningFailure).not.toHaveBeenCalled();
        expect(subscriptionService.recordRenewal).not.toHaveBeenCalled();
    });

    test("one bad row does not stop the sweep", async () => {
        subscriptionService.findDueForRenewal.mockResolvedValue([
            DUE({ id: 5 }),
            DUE({ id: 6 })
        ]);
        subscriptionService.recordRenewal
            .mockRejectedValueOnce(new Error("deadlock"))
            .mockResolvedValueOnce({
                outcome: "renewed",
                periodEnd: new Date("2026-07-01T00:00:00Z"),
                periodsBilled: 1
            });

        const summary = await renewalJob.processRenewals({
            now: NOW,
            charge: async () => ({ configured: true, success: true })
        });

        expect(summary.failed).toBe(1);
        expect(summary.renewed).toBe(1);
    });

    test("a failure reading the due rows is raised, not swallowed", async () => {
        // This is where the parse error used to land. It was caught, logged as
        // one line, and the function returned normally, so the job looked
        // healthy for as long as nobody read stderr.
        subscriptionService.findDueForRenewal.mockRejectedValue(
            new Error("ER_PARSE_ERROR near 'interval'")
        );

        await expect(renewalJob.processRenewals({ now: NOW })).rejects.toThrow(
            /ER_PARSE_ERROR/
        );
    });
});

describe("chargeRenewal", () => {
    const original = process.env.SUBSCRIPTION_MOCK_PAYMENTS;

    afterEach(() => {
        if (original === undefined) {
            delete process.env.SUBSCRIPTION_MOCK_PAYMENTS;
        } else {
            process.env.SUBSCRIPTION_MOCK_PAYMENTS = original;
        }
    });

    test("reports itself unconfigured by default", async () => {
        delete process.env.SUBSCRIPTION_MOCK_PAYMENTS;

        const result = await renewalJob.chargeRenewal({ id: 5, price: 499, currency: "INR" });

        expect(result.configured).toBe(false);
        expect(result.reason).toMatch(/SUBSCRIPTION_MOCK_PAYMENTS/);
    });

    test("the development stand-in always succeeds", async () => {
        process.env.SUBSCRIPTION_MOCK_PAYMENTS = "true";

        // Always, not usually. A stub that fails at random makes local
        // behaviour unreproducible, and randomness is what it replaces.
        for (let i = 0; i < 25; i += 1) {
            const result = await renewalJob.chargeRenewal({
                id: 5,
                price: 499,
                currency: "INR"
            });
            expect(result).toEqual({ configured: true, success: true });
        }
    });
});

describe("scheduling", () => {
    test("does not schedule under test", () => {
        // The old schedule was a bare top-level setInterval in server.js with
        // no NODE_ENV guard and no unref, so it armed itself during the suite
        // and held the event loop open.
        expect(process.env.NODE_ENV).toBe("test");
        expect(renewalJob.startSubscriptionRenewalJob()).toBeNull();
    });

    test("server.js no longer arms a timer at module scope", () => {
        const fs = require("fs");
        const path = require("path");

        // Comments are stripped first: the note left where the timer used to
        // be quotes the line it replaced, and quoting it is the point.
        const source = fs
            .readFileSync(path.join(__dirname, "..", "server.js"), "utf8")
            .split("\n")
            .filter((line) => !line.trim().startsWith("//"))
            .join("\n");

        expect(source).not.toMatch(/setInterval\(\s*processRenewals/);
        expect(source).toMatch(/startSubscriptionRenewalJob/);
    });
});
