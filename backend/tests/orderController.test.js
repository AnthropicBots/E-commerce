// Tests for orderController.js — order creation, retrieval, and status updates.
// All DB and service dependencies are mocked so the controller's request-handling
// logic (validation, status codes, auth/ownership checks) can be tested without a
// live MySQL connection.

// NOTE: these use explicit factories rather than bare jest.mock(path) automocks.
// A bare automock still requires the REAL module once to inspect its shape —
// and payment.service.js instantiates the Stripe SDK at import time, which
// throws if STRIPE_SECRET_KEY isn't set. Factories skip loading the real file.
jest.mock("../config/db", () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));
jest.mock("../services/order.service", () => ({
    createOrderService: jest.fn(),
    validateOrderDataService: jest.fn(),
    getOrderSummaryById: jest.fn(),
    // Must be a concrete value, not left undefined — the controller's catch
    // block does `error.code === TOTAL_MISMATCH_CODE`, and undefined === undefined
    // is true, which silently misroutes unrelated errors into the 409 branch.
    TOTAL_MISMATCH_CODE: "ORDER_TOTAL_MISMATCH"
}));
jest.mock("../services/payment.service", () => ({
    createPaymentIntent: jest.fn(),
    constructWebhookEvent: jest.fn()
}));
jest.mock("../services/invoice.service", () => ({
    generateInvoicePdf: jest.fn()
}));
jest.mock("../services/inventoryReservationService", () => ({
    validateCartLocks: jest.fn(),
    validateCartLocksDetailed: jest.fn(),
    releaseUserLocks: jest.fn(),
    consumeLocks: jest.fn(),
    reserveStock: jest.fn()
}));
// Saved-address lookup (#1347). Mocked even though our tests don't send an
// addressId, purely so the real 500+ line file is never loaded.
jest.mock("../services/addressService", () => ({
    resolveForOrder: jest.fn(),
    markAddressUsed: jest.fn()
}));

const db = require("../config/db");
const { createOrderService, validateOrderDataService, getOrderSummaryById } = require("../services/order.service");
const paymentService = require("../services/payment.service");
const { generateInvoicePdf } = require("../services/invoice.service");
const inventoryReservationService = require("../services/inventoryReservationService");
// Ownership moved out of these handlers and onto the routes in #1425, so the
// cases that cover it now exercise the middleware directly. It reads through
// the same mocked config/db as everything else here.
const { requireOwnership, ownerFromTable } = require("../middleware/requireOwnership");

const {
    createOrder,
    getAllOrders,
    getUserOrders,
    getOrderById,
    getOrderStatus,
    updateOrderStatus,
    cancelUserOrder,
    validateOrder,
    getOrderSummary,
    downloadInvoice,
    createPaymentIntent,
    exportOrders
} = require("../controllers/orderController");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function mockRes() {
    return {
        statusCode: null,
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
        setHeader(key, value) {
            this.headers[key] = value;
        },
        send(payload) {
            this.body = payload;
            return this;
        }
    };
}

function mockConnection() {
    return {
        query: jest.fn().mockResolvedValue([[]]),
        beginTransaction: jest.fn().mockResolvedValue(),
        commit: jest.fn().mockResolvedValue(),
        rollback: jest.fn().mockResolvedValue(),
        release: jest.fn()
    };
}

const VALID_ORDER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const validBody = {
    customer: { name: "Ishwari D", email: "ishwari@example.com", phone: "9999999999" },
    address: { fullAddress: "123 Main St", city: "Kolhapur", state: "MH", zip: "416001" },
    paymentMethod: "cod",
    items: [{ productId: 1, qty: 2 }],
    total: 499
};

describe("createOrder", () => {
    let connection;

    beforeEach(() => {
        jest.clearAllMocks();
        connection = mockConnection();
        db.getConnection.mockResolvedValue(connection);
    });

    test("rejects when customer info is missing", async () => {
        const req = { body: { ...validBody, customer: null }, user: { id: 1 } };
        const res = mockRes();

        await createOrder(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ success: false, message: "Customer information required" });
    });

    test("rejects when delivery address is missing", async () => {
        const req = { body: { ...validBody, address: null }, user: { id: 1 } };
        const res = mockRes();

        await createOrder(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ success: false, message: "Delivery address required" });
    });

    test("rejects when items array is empty", async () => {
        const req = { body: { ...validBody, items: [] }, user: { id: 1 } };
        const res = mockRes();

        await createOrder(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ success: false, message: "Order items required" });
    });

    test("rejects an order total of zero or less", async () => {
        const req = { body: { ...validBody, total: 0 }, user: { id: 1 } };
        const res = mockRes();

        await createOrder(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ success: false, message: "Invalid order total" });
    });

    test("rejects an unsupported payment method", async () => {
        const req = { body: { ...validBody, paymentMethod: "bitcoin" }, user: { id: 1 } };
        const res = mockRes();

        await createOrder(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ success: false, message: "Invalid payment method" });
    });

    test("creates an order successfully on the happy path", async () => {
        createOrderService.mockResolvedValue({ orderId: VALID_ORDER_ID, breakdown: { total: 499 } });
        inventoryReservationService.validateCartLocksDetailed.mockResolvedValue({ ok: true });
        inventoryReservationService.consumeLocks.mockResolvedValue();

        const req = { body: validBody, user: { id: 1 } };
        const res = mockRes();

        await createOrder(req, res);

        expect(connection.beginTransaction).toHaveBeenCalled();
        expect(connection.commit).toHaveBeenCalled();
        expect(res.statusCode).toBe(201);
        expect(res.body).toMatchObject({ success: true, orderId: VALID_ORDER_ID });
    });

    test("rolls back and returns 409 when inventory locks are invalid (#1260)", async () => {
        inventoryReservationService.validateCartLocksDetailed.mockResolvedValue({
            ok: false,
            code: "INVENTORY_CONFLICT",
            message: "Inventory locks expired or insufficient stock"
        });

        const req = { body: validBody, user: { id: 1 } };
        const res = mockRes();

        await createOrder(req, res);

        expect(connection.rollback).toHaveBeenCalled();
        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe("INVENTORY_CONFLICT");
        expect(res.body.message).toMatch(/Inventory locks/);
    });

    test("rolls back and returns 500 when the service layer throws an unrelated error", async () => {
        inventoryReservationService.validateCartLocksDetailed.mockResolvedValue({ ok: true });
        createOrderService.mockRejectedValue(new Error("DB exploded"));
        inventoryReservationService.releaseUserLocks.mockResolvedValue();

        const req = { body: validBody, user: { id: 1 } };
        const res = mockRes();

        await createOrder(req, res);

        expect(connection.rollback).toHaveBeenCalled();
        expect(connection.release).toHaveBeenCalled();
        expect(res.statusCode).toBe(500);
        expect(res.body).toMatchObject({ success: false, message: "Failed to create order" });
    });

    test("maps a total-mismatch error from the pricing engine to 409", async () => {
        inventoryReservationService.validateCartLocksDetailed.mockResolvedValue({ ok: true });
        const mismatchError = new Error("Submitted total does not match computed total");
        mismatchError.code = "ORDER_TOTAL_MISMATCH";
        mismatchError.submittedTotal = 499;
        mismatchError.computedTotal = 549;
        createOrderService.mockRejectedValue(mismatchError);

        const req = { body: validBody, user: { id: 1 } };
        const res = mockRes();

        await createOrder(req, res);

        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ success: false, code: "ORDER_TOTAL_MISMATCH", computedTotal: 549 });
    });
});

describe("getOrderById", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("rejects a malformed order id", async () => {
        const req = { params: { id: "not-a-uuid" }, user: { id: 1, role: "user" } };
        const res = mockRes();

        await getOrderById(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ success: false, message: "Invalid order ID" });
    });

    test("returns 404 when the order does not exist", async () => {
        db.query.mockResolvedValueOnce([[]]);

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "user" } };
        const res = mockRes();

        await getOrderById(req, res);

        expect(res.statusCode).toBe(404);
    });

    test("a regular user's query is scoped to their own user_id", async () => {
        db.query.mockResolvedValueOnce([[{ id: VALID_ORDER_ID, user_id: 1 }]]);
        db.query.mockResolvedValueOnce([[]]); // order_items

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "user" } };
        const res = mockRes();

        await getOrderById(req, res);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/AND user_id = \?/);
        expect(params).toEqual([VALID_ORDER_ID, 1]);
        expect(res.statusCode).toBe(200);
    });

    test("an admin's query is NOT scoped to a user_id", async () => {
        db.query.mockResolvedValueOnce([[{ id: VALID_ORDER_ID, user_id: 42 }]]);
        db.query.mockResolvedValueOnce([[]]);

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "admin" } };
        const res = mockRes();

        await getOrderById(req, res);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/AND user_id = \?/);
        expect(params).toEqual([VALID_ORDER_ID]);
    });
});

describe("updateOrderStatus", () => {
    let connection;

    beforeEach(() => {
        jest.clearAllMocks();
        connection = mockConnection();
        db.getConnection.mockResolvedValue(connection);
    });

    test("rejects an invalid status value", async () => {
        const req = { params: { id: VALID_ORDER_ID }, body: { status: "teleported" }, user: { role: "admin" } };
        const res = mockRes();

        await updateOrderStatus(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ success: false, message: "Invalid order status" });
    });

    test("returns 404 when the order does not exist", async () => {
        connection.query.mockResolvedValueOnce([[]]); // SELECT status ... FOR UPDATE

        const req = { params: { id: VALID_ORDER_ID }, body: { status: "shipped" }, user: { role: "admin" } };
        const res = mockRes();

        await updateOrderStatus(req, res);

        expect(connection.rollback).toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
    });

    test("restores stock when an order is cancelled", async () => {
        connection.query
            .mockResolvedValueOnce([[{ status: "processing" }]]) // current status
            .mockResolvedValueOnce([[{ product_id: 7, qty: 2 }]]) // order_items for restock
            .mockResolvedValueOnce([{}]) // UPDATE products stock
            .mockResolvedValueOnce([{}]); // UPDATE orders status

        const req = { params: { id: VALID_ORDER_ID }, body: { status: "cancelled" }, user: { role: "admin" } };
        const res = mockRes();

        await updateOrderStatus(req, res);

        expect(connection.query).toHaveBeenCalledWith(
            "UPDATE products SET stock = stock + ? WHERE id = ?",
            [2, 7]
        );
        expect(connection.commit).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
    });
});

describe("cancelUserOrder", () => {
    let connection;

    beforeEach(() => {
        jest.clearAllMocks();
        connection = mockConnection();
        db.getConnection.mockResolvedValue(connection);
    });

    // Ownership left this controller in #1425 and now lives in
    // requireOwnership, declared on the route in orderRoutes.js -- the handler
    // says so in a comment and no longer compares ids at all. This assertion
    // stayed pointed at the controller, so it had been failing ever since
    // (#1444). Re-aimed at the middleware that actually holds the rule, with
    // the same scenario, rather than deleted.
    test("the route guard prevents cancelling someone else's order", async () => {
        // Built exactly as orderRoutes.js builds it for the cancel route: no
        // privileged bypass, because staff have never been able to cancel on a
        // customer's behalf through this endpoint.
        const guard = requireOwnership(ownerFromTable({ table: "orders" }), {
            resourceName: "Order",
            allowPrivileged: false
        });

        db.query.mockResolvedValueOnce([[{ ownerId: 99 }]]);

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1 } };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(next).not.toHaveBeenCalled();
        // 404, not 403: a 403 confirms the id is real, which turns the id space
        // into an enumeration oracle.
        expect(res.statusCode).toBe(404);
    });

    test("the route guard lets the owner reach the handler", async () => {
        const guard = requireOwnership(ownerFromTable({ table: "orders" }), {
            resourceName: "Order",
            allowPrivileged: false
        });

        db.query.mockResolvedValueOnce([[{ ownerId: 1 }]]);

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1 } };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test("rejects cancelling an already-shipped order", async () => {
        connection.query.mockResolvedValueOnce([[{ user_id: 1, status: "shipped" }]]);

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1 } };
        const res = mockRes();

        await cancelUserOrder(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/Cannot cancel a shipped order/);
    });
});

describe("validateOrder", () => {
    test("returns validation errors from the service layer", () => {
        validateOrderDataService.mockReturnValue({ isValid: false, errors: ["total is required"] });

        const req = { body: {} };
        const res = mockRes();

        validateOrder(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body.errors).toEqual(["total is required"]);
    });

    test("passes when the service layer reports valid data", () => {
        validateOrderDataService.mockReturnValue({ isValid: true });

        const req = { body: validBody };
        const res = mockRes();

        validateOrder(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe("getAllOrders", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function stubDb(total, rows) {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT COUNT/.test(sql)) {
                return [[{ total }]];
            }
            return [rows];
        });
    }

    test("returns paginated orders with metadata", async () => {
        stubDb(3, [{ id: "o1" }, { id: "o2" }]);
        const req = { query: { page: "1", limit: "2" } };
        const res = mockRes();

        await getAllOrders(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, page: 1, limit: 2, total: 3 });
        expect(res.body.orders).toHaveLength(2);
    });

    test("returns 500 when the count query fails", async () => {
        db.query.mockRejectedValue(new Error("connection lost"));
        const req = { query: {} };
        const res = mockRes();

        await getAllOrders(req, res);

        expect(res.statusCode).toBe(500);
        expect(res.body).toMatchObject({ success: false, message: "Server error" });
    });
});

describe("getUserOrders", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("scopes the query to the requesting user and returns their orders", async () => {
        db.query.mockResolvedValueOnce([[{ id: "o1", customer_name: "Ishwari" }]]);
        const req = { user: { id: 7 } };
        const res = mockRes();

        await getUserOrders(req, res);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/WHERE user_id = \?/);
        expect(params).toEqual([7]);
        expect(res.statusCode).toBe(200);
        expect(res.body.orders).toHaveLength(1);
    });

    test("returns 500 on a DB failure", async () => {
        db.query.mockRejectedValue(new Error("boom"));
        const req = { user: { id: 7 } };
        const res = mockRes();

        await getUserOrders(req, res);

        expect(res.statusCode).toBe(500);
    });
});

describe("getOrderStatus", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("rejects a malformed order id", async () => {
        const req = { params: { id: "not-a-uuid" }, user: { id: 1, role: "user" } };
        const res = mockRes();

        await getOrderStatus(req, res);

        expect(res.statusCode).toBe(400);
    });

    test("returns 404 when the order does not exist", async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "user" } };
        const res = mockRes();

        await getOrderStatus(req, res);

        expect(res.statusCode).toBe(404);
    });

    test("returns the order with its items on success", async () => {
        db.query.mockResolvedValueOnce([[{ id: VALID_ORDER_ID, status: "shipped", user_id: 1 }]]);
        db.query.mockResolvedValueOnce([[{ product_id: 1, qty: 2 }]]);
        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "user" } };
        const res = mockRes();

        await getOrderStatus(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.order.items).toHaveLength(1);
    });
});

describe("getOrderSummary", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("rejects a malformed order id", async () => {
        const req = { params: { id: "nope" } };
        const res = mockRes();

        await getOrderSummary(req, res);

        expect(res.statusCode).toBe(400);
    });

    test("returns 404 when the service finds no summary", async () => {
        getOrderSummaryById.mockResolvedValue(null);
        const req = { params: { id: VALID_ORDER_ID } };
        const res = mockRes();

        await getOrderSummary(req, res);

        expect(res.statusCode).toBe(404);
    });

    test("returns the summary on success", async () => {
        getOrderSummaryById.mockResolvedValue({ orderId: VALID_ORDER_ID, itemCount: 3 });
        const req = { params: { id: VALID_ORDER_ID } };
        const res = mockRes();

        await getOrderSummary(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.summary).toMatchObject({ itemCount: 3 });
    });
});

describe("downloadInvoice", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("returns 404 when the order does not exist", async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "user" } };
        const res = mockRes();

        await downloadInvoice(req, res);

        expect(res.statusCode).toBe(404);
    });

    // Same move as the cancel guard above: downloadInvoice used to compare ids
    // and answer 403, and #1425 replaced that with requireOwnership on the
    // route -- which answers 404 by design, so a caller cannot learn that an
    // order id exists by being refused it. The old assertion outlived the
    // behaviour it described (#1444).
    test("the route guard blocks a user from downloading someone else's invoice", async () => {
        const guard = requireOwnership(ownerFromTable({ table: "orders" }), {
            resourceName: "Order"
        });

        db.query.mockResolvedValueOnce([[{ ownerId: 99 }]]);

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "user" } };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
    });

    test("the route guard lets an admin through, unlike the cancel guard", async () => {
        // The invoice guard keeps the privileged bypass; the cancel guard
        // deliberately does not. Pinning both means a refactor cannot quietly
        // level them.
        const guard = requireOwnership(ownerFromTable({ table: "orders" }), {
            resourceName: "Order"
        });

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "admin" } };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test("streams a PDF for the order owner", async () => {
        db.query.mockResolvedValueOnce([[{ id: VALID_ORDER_ID, user_id: 1 }]]);
        db.query.mockResolvedValueOnce([[{ product_id: 1, qty: 2 }]]);
        generateInvoicePdf.mockResolvedValue(Buffer.from("fake-pdf"));

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "user" } };
        const res = mockRes();

        await downloadInvoice(req, res);

        expect(res.headers["Content-Type"]).toBe("application/pdf");
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(Buffer.from("fake-pdf"));
    });

    test("allows an admin to download any invoice", async () => {
        db.query.mockResolvedValueOnce([[{ id: VALID_ORDER_ID, user_id: 99 }]]);
        db.query.mockResolvedValueOnce([[]]);
        generateInvoicePdf.mockResolvedValue(Buffer.from("fake-pdf"));

        const req = { params: { id: VALID_ORDER_ID }, user: { id: 1, role: "admin" } };
        const res = mockRes();

        await downloadInvoice(req, res);

        expect(res.statusCode).toBe(200);
    });
});

describe("createPaymentIntent", () => {
    let connection;

    beforeEach(() => {
        jest.clearAllMocks();
        connection = mockConnection();
        db.getConnection.mockResolvedValue(connection);
    });

    test("rejects when required fields are missing (same validation as createOrder)", async () => {
        const req = { body: { ...validBody, items: [] }, user: { id: 1 } };
        const res = mockRes();

        await createPaymentIntent(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe("Order items required");
    });

    test("rolls back and returns 409 when inventory locks are invalid", async () => {
        inventoryReservationService.validateCartLocksDetailed.mockResolvedValue({
            ok: false,
            code: "INVENTORY_CONFLICT",
            message: "Inventory locks expired or insufficient stock"
        });

        const req = { body: validBody, user: { id: 1 } };
        const res = mockRes();

        await createPaymentIntent(req, res);

        expect(connection.rollback).toHaveBeenCalled();
        expect(res.statusCode).toBe(409);
    });

    test("returns 500 when Stripe declines to create an intent (no rollback needed — handled inline)", async () => {
        inventoryReservationService.validateCartLocksDetailed.mockResolvedValue({ ok: true });
        createOrderService.mockResolvedValue({ orderId: VALID_ORDER_ID, breakdown: { total: 499 } });
        inventoryReservationService.consumeLocks.mockResolvedValue();
        paymentService.createPaymentIntent.mockResolvedValue({ success: false, error: "card_declined" });

        const req = { body: validBody, user: { id: 1 } };
        const res = mockRes();

        await createPaymentIntent(req, res);

        expect(connection.rollback).toHaveBeenCalled();
        expect(res.statusCode).toBe(500);
        expect(res.body.message).toBe("card_declined");
    });

    test("creates a payment intent using the pricing engine's total, in the configured currency", async () => {
        inventoryReservationService.validateCartLocksDetailed.mockResolvedValue({ ok: true });
        createOrderService.mockResolvedValue({ orderId: VALID_ORDER_ID, breakdown: { total: 549 } });
        inventoryReservationService.consumeLocks.mockResolvedValue();
        paymentService.createPaymentIntent.mockResolvedValue({
            success: true,
            clientSecret: "secret_123",
            paymentIntentId: "pi_123"
        });

        // total in the request body is a stale client-side estimate (499);
        // the engine's breakdown (549) is what should actually get charged.
        const req = { body: validBody, user: { id: 1 } };
        const res = mockRes();

        await createPaymentIntent(req, res);

        expect(paymentService.createPaymentIntent).toHaveBeenCalledWith(
            549,
            "INR",
            expect.objectContaining({ orderId: VALID_ORDER_ID })
        );
        expect(connection.commit).toHaveBeenCalled();
        expect(res.statusCode).toBe(201);
        expect(res.body).toMatchObject({ success: true, clientSecret: "secret_123", orderId: VALID_ORDER_ID });
    });
});

describe("exportOrders", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("exports all orders as CSV when no status filter is given", async () => {
        db.query.mockResolvedValueOnce([[{ id: VALID_ORDER_ID, customer_name: "Ishwari", total: 499, status: "pending" }]]);
        const req = { query: {} };
        const res = mockRes();

        await exportOrders(req, res);

        const [sql] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/WHERE status/);
        expect(res.headers["Content-Type"]).toBe("text/csv");
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain("Ishwari");
    });

    test("filters by status when provided", async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { status: "Shipped" } };
        const res = mockRes();

        await exportOrders(req, res);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/WHERE status = \?/);
        expect(params).toEqual(["shipped"]);
    });

    test("returns 500 when the export query fails", async () => {
        db.query.mockRejectedValue(new Error("timeout"));
        const req = { query: {} };
        const res = mockRes();

        await exportOrders(req, res);

        expect(res.statusCode).toBe(500);
    });
});
