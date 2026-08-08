// backend/tests/refundQuantity.test.js
//
// Return quantity accounting (#1477).
//
// Returns used to be tracked per order line: `hasOpenRequestForItem` answered
// "does this line have a request that is pending or approved", and the
// controller treated that boolean as the whole rule. It was wrong in both
// directions -- it locked a whole line after one partial return, and released a
// whole line as soon as a request left that pair.
//
// These drive the controller directly with mocked `config/db`, which is how
// every other suite here isolates MySQL. The assertions are about arithmetic and
// about *which connection* the arithmetic happened on, since taking the count
// off the pool rather than off the locked transaction is the difference between
// a rule and a race.

jest.mock("../config/db", () => {
    const query = jest.fn();
    const getConnection = jest.fn();
    return { query, getConnection };
});

jest.mock("../services/stockCounterService", () => ({
    restoreStock: jest.fn(async () => undefined)
}));

const db = require("../config/db");
const RefundRequest = require("../models/RefundRequest");
const refundController = require("../controllers/refundController");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";

/** A delivered order inside the return window. */
function deliveredOrder(overrides = {}) {
    return {
        user_id: USER_ID,
        status: "delivered",
        delivered_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
        created_at: new Date(Date.now() - 48 * 60 * 60 * 1000),
        ...overrides
    };
}

function mockRes() {
    const res = {
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
    return res;
}

/**
 * A fake pooled connection routing each SQL string to a canned answer.
 *
 * `claimed` is what the SUM over refund_requests returns -- the figure the whole
 * fix turns on.
 */
function fakeConnection({ order = deliveredOrder(), item, claimed = 0, insertId = 7 } = {}) {
    const calls = [];

    const query = jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });

        if (/FROM orders/i.test(sql)) {
            return [order ? [order] : []];
        }
        if (/FROM order_items/i.test(sql)) {
            return [item ? [item] : []];
        }
        if (/SUM\(quantity\)/i.test(sql)) {
            return [[{ claimed }]];
        }
        if (/INSERT INTO refund_requests/i.test(sql)) {
            return [{ insertId, affectedRows: 1 }];
        }
        if (/FROM refund_requests/i.test(sql)) {
            return [[{ id: insertId, quantity: 1, status: "pending" }]];
        }
        return [[], { affectedRows: 1 }];
    });

    const connection = {
        query,
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        release: jest.fn()
    };

    return { connection, calls };
}

function sqlsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

function makeRequest(body = {}, user = { id: USER_ID }) {
    return { user, body, params: {} };
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ============================================================================

describe("RefundRequest.claimedQuantityForItem", () => {
    it("sums pending, approved and refunded quantities", async () => {
        db.query.mockResolvedValueOnce([[{ claimed: 4 }]]);

        await expect(RefundRequest.claimedQuantityForItem(9)).resolves.toBe(4);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/SUM\(quantity\)/i);
        expect(params).toEqual([9, "pending", "approved", "refunded"]);
    });

    it("excludes rejected requests, so a refused return releases its units", async () => {
        expect(RefundRequest.CLAIMED_STATUSES).not.toContain("rejected");
    });

    it("counts refunded requests, so a closed-out return does not free the line", async () => {
        // The old check treated anything outside pending/approved as releasing
        // the line, so a request marked `refunded` made the whole quantity
        // returnable from scratch.
        expect(RefundRequest.CLAIMED_STATUSES).toContain("refunded");
    });

    it("reads zero rather than null when a line has no requests", async () => {
        db.query.mockResolvedValueOnce([[{ claimed: null }]]);
        await expect(RefundRequest.claimedQuantityForItem(9)).resolves.toBe(0);
    });

    it("runs on the connection it is given", async () => {
        const connection = { query: jest.fn(async () => [[{ claimed: 2 }]]) };

        await RefundRequest.claimedQuantityForItem(9, connection);

        expect(connection.query).toHaveBeenCalledTimes(1);
        expect(db.query).not.toHaveBeenCalled();
    });
});

describe("createRequest — partial returns", () => {
    it("accepts a partial return of a line", async () => {
        const { connection } = fakeConnection({
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 },
            claimed: 0
        });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 2, reason: "Too small" }),
            res
        );

        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.returnable_quantity).toBe(3);
        expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    it("still accepts the remainder after an earlier return was approved", async () => {
        // The bug: two of five returned and approved left the other three
        // unreturnable forever, because `approved` is where every successful
        // return stops -- no route moves a request past it.
        const { connection } = fakeConnection({
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 },
            claimed: 2
        });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 3, reason: "Wrong colour" }),
            res
        );

        expect(res.statusCode).toBe(201);
        expect(res.body.data.returnable_quantity).toBe(0);
    });

    it("refuses a quantity that would take the line past what was bought", async () => {
        const { connection } = fakeConnection({
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 },
            claimed: 3
        });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 3, reason: "Faulty" }),
            res
        );

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain("already returned 3 of 5");
        expect(res.body.data.returnable_quantity).toBe(2);
        expect(connection.commit).not.toHaveBeenCalled();
        expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

    it("refuses outright once every unit is claimed", async () => {
        // This is the path that used to let a rejected or refunded request
        // release the whole line and be returned a second time -- which
        // stockCounter.restoreStock would then credit as real inventory.
        const { connection, calls } = fakeConnection({
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 },
            claimed: 5
        });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 5, reason: "All of them" }),
            res
        );

        expect(res.statusCode).toBe(409);
        expect(res.body.data.returnable_quantity).toBe(0);
        expect(sqlsMatching(calls, /INSERT INTO refund_requests/i)).toHaveLength(0);
        expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

    it("defaults an omitted quantity to what is still returnable, not to what was bought", async () => {
        const { connection, calls } = fakeConnection({
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 },
            claimed: 4
        });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, reason: "The last one" }),
            res
        );

        expect(res.statusCode).toBe(201);

        const insert = sqlsMatching(calls, /INSERT INTO refund_requests/i)[0];
        expect(insert.params[5]).toBe(1);
    });
});

describe("createRequest — concurrency", () => {
    it("locks the order line and counts under that lock", async () => {
        const { connection, calls } = fakeConnection({
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 },
            claimed: 0
        });
        db.getConnection.mockResolvedValue(connection);

        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 1, reason: "Faulty" }),
            mockRes()
        );

        // The line is what there is exactly one of, so it is what two concurrent
        // submissions serialize on. Locking the request rows would lock nothing
        // when a line has none yet -- the case that actually races.
        const lineRead = sqlsMatching(calls, /FROM order_items/i)[0];
        expect(lineRead.sql).toMatch(/FOR UPDATE/i);

        // And every read is on the transaction, not the pool.
        expect(sqlsMatching(calls, /SUM\(quantity\)/i)).toHaveLength(1);
        expect(db.query).not.toHaveBeenCalled();
    });

    it("releases the connection when the insert fails", async () => {
        const { connection } = fakeConnection({
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 },
            claimed: 0
        });
        connection.query.mockImplementationOnce(async () => [[deliveredOrder()]]);
        connection.commit.mockRejectedValueOnce(new Error("deadlock"));
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 1, reason: "Faulty" }),
            res
        );

        expect(res.statusCode).toBe(500);
        expect(connection.rollback).toHaveBeenCalled();
        expect(connection.release).toHaveBeenCalledTimes(1);
    });
});

describe("createRequest — the checks that were already right", () => {
    it("rejects an order that belongs to somebody else", async () => {
        const { connection } = fakeConnection({
            order: deliveredOrder({ user_id: OTHER_USER_ID }),
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 }
        });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 1, reason: "Faulty" }),
            res
        );

        expect(res.statusCode).toBe(404);
        expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

    it("rejects an order that has not been delivered", async () => {
        const { connection } = fakeConnection({
            order: deliveredOrder({ status: "shipped" }),
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 }
        });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 1, reason: "Faulty" }),
            res
        );

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain("delivered");
    });

    it("rejects an order whose return window has closed", async () => {
        const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        const { connection } = fakeConnection({
            order: deliveredOrder({ delivered_at: longAgo }),
            item: { id: 5, product_id: PRODUCT_ID, qty: 5 }
        });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 1, reason: "Faulty" }),
            res
        );

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain("return window");
    });

    it("rejects an item that is not part of the order", async () => {
        const { connection } = fakeConnection({ item: null });
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 999, quantity: 1, reason: "Faulty" }),
            res
        );

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain("not part of this order");
    });

    it("still requires a reason of a usable length", async () => {
        const res = mockRes();
        await refundController.createRequest(
            makeRequest({ orderId: ORDER_ID, orderItemId: 5, quantity: 1, reason: "no" }),
            res
        );

        expect(res.statusCode).toBe(400);
        // Refused before a connection is taken at all.
        expect(db.getConnection).not.toHaveBeenCalled();
    });
});

describe("listReturnable", () => {
    function returnableRequest(orderId = ORDER_ID, user = { id: USER_ID }) {
        return { user, body: {}, params: { orderId } };
    }

    it("reports purchased, claimed and remaining for every line", async () => {
        db.query
            .mockResolvedValueOnce([[deliveredOrder()]])
            .mockResolvedValueOnce([[
                { id: 5, product_id: PRODUCT_ID, variant_id: 2, name: "Tee", qty: 5 },
                { id: 6, product_id: PRODUCT_ID, variant_id: null, name: "Cap", qty: 1 }
            ]])
            .mockResolvedValueOnce([[{ order_item_id: 5, claimed: 2 }]]);

        const res = mockRes();
        await refundController.listReturnable(returnableRequest(), res);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.returns_open).toBe(true);
        expect(res.body.data.items).toEqual([
            expect.objectContaining({
                order_item_id: 5,
                purchased_quantity: 5,
                claimed_quantity: 2,
                returnable_quantity: 3
            }),
            expect.objectContaining({
                order_item_id: 6,
                purchased_quantity: 1,
                claimed_quantity: 0,
                returnable_quantity: 1
            })
        ]);
    });

    it("reports nothing returnable, with a reason, once the window has closed", async () => {
        const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        db.query
            .mockResolvedValueOnce([[deliveredOrder({ delivered_at: longAgo })]])
            .mockResolvedValueOnce([[{ id: 5, product_id: PRODUCT_ID, variant_id: null, name: "Tee", qty: 5 }]])
            .mockResolvedValueOnce([[]]);

        const res = mockRes();
        await refundController.listReturnable(returnableRequest(), res);

        expect(res.body.data.returns_open).toBe(false);
        expect(res.body.data.reason).toContain("return window");
        expect(res.body.data.items[0].returnable_quantity).toBe(0);
        // The line is still listed with its real figures, so the caller can
        // render the whole order rather than only its remainder.
        expect(res.body.data.items[0].purchased_quantity).toBe(5);
    });

    it("does not reveal another customer's order", async () => {
        db.query.mockResolvedValueOnce([[deliveredOrder({ user_id: OTHER_USER_ID })]]);

        const res = mockRes();
        await refundController.listReturnable(returnableRequest(), res);

        expect(res.statusCode).toBe(404);
    });

    it("answers the same way for an order that does not exist", async () => {
        // Distinguishing "not yours" from "no such order" tells a guesser which
        // order ids are real.
        db.query.mockResolvedValueOnce([[]]);

        const res = mockRes();
        await refundController.listReturnable(returnableRequest(), res);

        expect(res.statusCode).toBe(404);
    });

    it("requires authentication", async () => {
        const res = mockRes();
        await refundController.listReturnable(returnableRequest(ORDER_ID, null), res);

        expect(res.statusCode).toBe(401);
    });
});
