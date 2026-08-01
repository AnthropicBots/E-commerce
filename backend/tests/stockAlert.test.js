// Tests for stock-alert subscription management (#1233). The db module is
// mocked so we can assert the subscribe/dedupe/unsubscribe/list SQL and params
// without a live MySQL. The mock `query` returns rows keyed off the SQL text,
// mirroring the wrapper's [rows] destructuring contract in config/db.

jest.mock("../config/db", () => {
    const query = jest.fn();
    return { query };
});

const db = require("../config/db");
const service = require("../services/stockAlertService");

function callsMatching(regex) {
    return db.query.mock.calls.filter(([sql]) => regex.test(sql));
}

afterEach(() => {
    db.query.mockReset();
});

describe("subscribe", () => {
    test("inserts a back_in_stock subscription with ON DUPLICATE KEY UPDATE dedupe", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/^\s*INSERT INTO stock_alert_subscriptions/i.test(sql)) {
                return [{ affectedRows: 1, insertId: 1 }];
            }
            return [[{ id: 1, user_id: "u1", product_id: "p1", alert_type: "back_in_stock", status: "active" }]];
        });

        const row = await service.subscribe({
            userId: "u1",
            productId: "p1",
            alertType: "back_in_stock",
        });

        const inserts = callsMatching(/INSERT INTO stock_alert_subscriptions/i);
        expect(inserts).toHaveLength(1);
        const [sql, params] = inserts[0];
        expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
        expect(sql).toMatch(/status = 'active'/i);
        expect(sql).toMatch(/last_notified_at = NULL/i);
        // back_in_stock has no reference price; no product lookup needed.
        expect(callsMatching(/SELECT price FROM products/i)).toHaveLength(0);
        expect(params).toEqual(["u1", "p1", "back_in_stock", null]);
        expect(row).toMatchObject({ id: 1, status: "active" });
    });

    test("dedupes: a second subscribe for the same user/product/type does not insert a duplicate row", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/^\s*INSERT INTO stock_alert_subscriptions/i.test(sql)) {
                return [{ affectedRows: 2 }];
            }
            return [[{ id: 7, user_id: "u1", product_id: "p1", alert_type: "back_in_stock", status: "active" }]];
        });

        await service.subscribe({ userId: "u1", productId: "p1", alertType: "back_in_stock" });
        await service.subscribe({ userId: "u1", productId: "p1", alertType: "back_in_stock" });

        // Two subscribe calls, but each is a single upsert relying on the UNIQUE
        // key -- there is no second INSERT-without-dedupe path.
        const inserts = callsMatching(/INSERT INTO stock_alert_subscriptions/i);
        expect(inserts).toHaveLength(2);
        inserts.forEach(([sql]) => expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/i));
    });

    test("price_drop with null referencePrice looks up the product's current price", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT price FROM products WHERE id = \?/i.test(sql)) {
                return [[{ price: "19.99" }]];
            }
            if (/^\s*INSERT INTO stock_alert_subscriptions/i.test(sql)) {
                return [{ affectedRows: 1 }];
            }
            return [[{ id: 3, alert_type: "price_drop", reference_price: "19.99", status: "active" }]];
        });

        await service.subscribe({ userId: "u1", productId: "p1", alertType: "price_drop" });

        const priceLookups = callsMatching(/SELECT price FROM products WHERE id = \?/i);
        expect(priceLookups).toHaveLength(1);
        expect(priceLookups[0][1]).toEqual(["p1"]);

        const inserts = callsMatching(/INSERT INTO stock_alert_subscriptions/i);
        expect(inserts).toHaveLength(1);
        // Looked-up price is stored as reference_price (4th param).
        expect(inserts[0][1]).toEqual(["u1", "p1", "price_drop", "19.99"]);
    });

    test("price_drop with an explicit referencePrice does not look up the product price", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/^\s*INSERT INTO stock_alert_subscriptions/i.test(sql)) {
                return [{ affectedRows: 1 }];
            }
            return [[{ id: 4, alert_type: "price_drop", reference_price: "50.00" }]];
        });

        await service.subscribe({
            userId: "u1",
            productId: "p1",
            alertType: "price_drop",
            referencePrice: "50.00",
        });

        expect(callsMatching(/SELECT price FROM products/i)).toHaveLength(0);
        const inserts = callsMatching(/INSERT INTO stock_alert_subscriptions/i);
        expect(inserts[0][1]).toEqual(["u1", "p1", "price_drop", "50.00"]);
    });

    test("rejects an unknown alert type before touching the db", async () => {
        await expect(
            service.subscribe({ userId: "u1", productId: "p1", alertType: "bogus" })
        ).rejects.toThrow(/Invalid alertType/i);
        expect(db.query).not.toHaveBeenCalled();
    });
});

describe("unsubscribe", () => {
    test("soft-cancels the matching subscription", async () => {
        db.query.mockResolvedValue([{ affectedRows: 1 }]);

        await service.unsubscribe({ userId: "u1", productId: "p1", alertType: "back_in_stock" });

        const updates = callsMatching(/UPDATE stock_alert_subscriptions/i);
        expect(updates).toHaveLength(1);
        const [sql, params] = updates[0];
        expect(sql).toMatch(/SET status = 'cancelled'/i);
        expect(sql).toMatch(/WHERE user_id = \? AND product_id = \? AND alert_type = \?/i);
        expect(params).toEqual(["u1", "p1", "back_in_stock"]);
        // Soft cancel must never delete the row.
        expect(callsMatching(/DELETE FROM stock_alert_subscriptions/i)).toHaveLength(0);
    });
});

describe("listSubscriptions", () => {
    test("returns all of a user's subscriptions when no filters are given", async () => {
        db.query.mockResolvedValue([[{ id: 1 }, { id: 2 }]]);

        const rows = await service.listSubscriptions("u1");

        const selects = callsMatching(/SELECT \* FROM stock_alert_subscriptions/i);
        expect(selects).toHaveLength(1);
        const [sql, params] = selects[0];
        expect(sql).toMatch(/WHERE user_id = \?/i);
        expect(sql).not.toMatch(/alert_type = \?/i);
        expect(sql).not.toMatch(/status = \?/i);
        expect(params).toEqual(["u1"]);
        expect(rows).toHaveLength(2);
    });

    test("appends alert_type and status filters when provided", async () => {
        db.query.mockResolvedValue([[]]);

        await service.listSubscriptions("u1", { alertType: "price_drop", status: "active" });

        const [sql, params] = callsMatching(/SELECT \* FROM stock_alert_subscriptions/i)[0];
        expect(sql).toMatch(/AND alert_type = \?/i);
        expect(sql).toMatch(/AND status = \?/i);
        expect(params).toEqual(["u1", "price_drop", "active"]);
    });

    test("appends only the status filter when alert type is omitted", async () => {
        db.query.mockResolvedValue([[]]);

        await service.listSubscriptions("u1", { status: "cancelled" });

        const [sql, params] = callsMatching(/SELECT \* FROM stock_alert_subscriptions/i)[0];
        expect(sql).not.toMatch(/alert_type = \?/i);
        expect(sql).toMatch(/AND status = \?/i);
        expect(params).toEqual(["u1", "cancelled"]);
    });
});
