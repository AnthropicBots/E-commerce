// Route tests for the stock-alert API (#1233, PR 3/3). The service layer and
// the auth middleware are mocked so we exercise only the routing/validation
// contract: which service method each verb calls, what status code comes back,
// and that every handler is scoped to the injected req.user.

// Auth middleware is replaced with a stub that injects whatever `mockUser`
// currently holds (jest only lets factory closures reference `mock`-prefixed
// vars). The real middleware throws at import time when JWT_SECRET is unset, so
// mocking also keeps the route module loadable in isolation. Flipping mockUser
// to undefined lets us exercise the handlers' own unauthenticated guard.
let mockUser = { id: "user-123" };
jest.mock("../middleware/authMiddleware", () => (req, res, next) => {
    req.user = mockUser;
    next();
});

jest.mock("../services/stockAlertService", () => ({
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    listSubscriptions: jest.fn()
}));

const express = require("express");
const request = require("supertest");
const stockAlertService = require("../services/stockAlertService");
const stockAlertRoutes = require("../routes/stockAlertRoutes");

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/stock-alerts", stockAlertRoutes);
    return app;
}

const app = buildApp();

afterEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "user-123" };
});

describe("POST /api/stock-alerts", () => {
    test("subscribes the authenticated user and returns 201", async () => {
        stockAlertService.subscribe.mockResolvedValue({ insertId: 1, status: "active" });

        const res = await request(app)
            .post("/api/stock-alerts")
            .send({ productId: "prod-1", alertType: "price_drop", referencePrice: 42.5 });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(stockAlertService.subscribe).toHaveBeenCalledWith({
            userId: "user-123",
            productId: "prod-1",
            alertType: "price_drop",
            referencePrice: 42.5
        });
    });

    test("defaults referencePrice to null when omitted", async () => {
        stockAlertService.subscribe.mockResolvedValue({ insertId: 2, status: "active" });

        await request(app)
            .post("/api/stock-alerts")
            .send({ productId: "prod-2", alertType: "back_in_stock" });

        expect(stockAlertService.subscribe).toHaveBeenCalledWith({
            userId: "user-123",
            productId: "prod-2",
            alertType: "back_in_stock",
            referencePrice: null
        });
    });

    test("returns 400 when required fields are missing", async () => {
        const res = await request(app)
            .post("/api/stock-alerts")
            .send({ productId: "prod-1" });

        expect(res.status).toBe(400);
        expect(stockAlertService.subscribe).not.toHaveBeenCalled();
    });

    test("returns 400 when the service rejects", async () => {
        stockAlertService.subscribe.mockRejectedValue(new Error("Unsupported alertType: nope"));

        const res = await request(app)
            .post("/api/stock-alerts")
            .send({ productId: "prod-1", alertType: "nope" });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Unsupported alertType/);
    });
});

describe("DELETE /api/stock-alerts", () => {
    test("unsubscribes the authenticated user and returns 200", async () => {
        stockAlertService.unsubscribe.mockResolvedValue({ cancelled: true });

        const res = await request(app)
            .delete("/api/stock-alerts")
            .send({ productId: "prod-1", alertType: "price_drop" });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, cancelled: true });
        expect(stockAlertService.unsubscribe).toHaveBeenCalledWith({
            userId: "user-123",
            productId: "prod-1",
            alertType: "price_drop"
        });
    });

    test("returns 400 when required fields are missing", async () => {
        const res = await request(app).delete("/api/stock-alerts").send({});

        expect(res.status).toBe(400);
        expect(stockAlertService.unsubscribe).not.toHaveBeenCalled();
    });
});

describe("GET /api/stock-alerts", () => {
    test("lists the authenticated user's subscriptions with filters", async () => {
        const rows = [{ id: 1, product_id: "prod-1", alert_type: "price_drop" }];
        stockAlertService.listSubscriptions.mockResolvedValue(rows);

        const res = await request(app)
            .get("/api/stock-alerts")
            .query({ alertType: "price_drop", status: "active" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, subscriptions: rows });
        expect(stockAlertService.listSubscriptions).toHaveBeenCalledWith("user-123", {
            alertType: "price_drop",
            status: "active"
        });
    });

    test("returns 400 when the service throws", async () => {
        stockAlertService.listSubscriptions.mockRejectedValue(new Error("boom"));

        const res = await request(app).get("/api/stock-alerts");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

describe("unauthenticated requests", () => {
    test.each([
        ["post", { productId: "prod-1", alertType: "price_drop" }],
        ["delete", { productId: "prod-1", alertType: "price_drop" }],
        ["get", undefined]
    ])("%s returns 401 when no user is resolved and never touches the service", async (method, body) => {
        mockUser = undefined;

        const req = request(app)[method]("/api/stock-alerts");
        const res = body ? await req.send(body) : await req;

        expect(res.status).toBe(401);
        expect(stockAlertService.subscribe).not.toHaveBeenCalled();
        expect(stockAlertService.unsubscribe).not.toHaveBeenCalled();
        expect(stockAlertService.listSubscriptions).not.toHaveBeenCalled();
    });
});
