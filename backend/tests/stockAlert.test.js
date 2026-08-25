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

// Every subscribe now resolves the product through the public visibility
// condition first (#1609), so a mock that wants the insert to be reached has
// to answer that lookup. Kept as one helper so the shape of the answer is
// stated once.
const VISIBLE_PRODUCT_SQL = /FROM products p\s+WHERE p\.id = \?/i;

function visibleProduct(overrides = {}) {
    return [{ id: "p1", price: "19.99", stock: 0, name: "A product", ...overrides }];
}

afterEach(() => {
    db.query.mockReset();
});

describe("subscribe", () => {
    test("inserts a back_in_stock subscription with ON DUPLICATE KEY UPDATE dedupe", async () => {
        db.query.mockImplementation(async (sql) => {
            if (VISIBLE_PRODUCT_SQL.test(sql)) {
                return [visibleProduct()];
            }
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
        // back_in_stock stores no reference price, but the product is still
        // resolved through the visibility condition before the row is written.
        expect(callsMatching(VISIBLE_PRODUCT_SQL)).toHaveLength(1);
        expect(params).toEqual(["u1", "p1", "back_in_stock", null]);
        expect(row).toMatchObject({ id: 1, status: "active" });
    });

    test("dedupes: a second subscribe for the same user/product/type does not insert a duplicate row", async () => {
        db.query.mockImplementation(async (sql) => {
            if (VISIBLE_PRODUCT_SQL.test(sql)) {
                return [visibleProduct()];
            }
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

    test("price_drop with null referencePrice anchors to the product's current price", async () => {
        db.query.mockImplementation(async (sql) => {
            if (VISIBLE_PRODUCT_SQL.test(sql)) {
                return [visibleProduct({ price: "19.99" })];
            }
            if (/^\s*INSERT INTO stock_alert_subscriptions/i.test(sql)) {
                return [{ affectedRows: 1 }];
            }
            return [[{ id: 3, alert_type: "price_drop", reference_price: "19.99", status: "active" }]];
        });

        await service.subscribe({ userId: "u1", productId: "p1", alertType: "price_drop" });

        // One lookup, not two: the baseline comes off the row the visibility
        // check already loaded rather than from a second SELECT that could read
        // a price the check never saw.
        const lookups = callsMatching(VISIBLE_PRODUCT_SQL);
        expect(lookups).toHaveLength(1);
        expect(lookups[0][1][0]).toBe("p1");

        const inserts = callsMatching(/INSERT INTO stock_alert_subscriptions/i);
        expect(inserts).toHaveLength(1);
        // Looked-up price is stored as reference_price (4th param).
        expect(inserts[0][1]).toEqual(["u1", "p1", "price_drop", 19.99]);
    });

    test("an explicit referencePrice below the current price is honoured", async () => {
        db.query.mockImplementation(async (sql) => {
            if (VISIBLE_PRODUCT_SQL.test(sql)) {
                return [visibleProduct({ price: "80.00" })];
            }
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

        const inserts = callsMatching(/INSERT INTO stock_alert_subscriptions/i);
        expect(inserts[0][1]).toEqual(["u1", "p1", "price_drop", 50]);
    });

    test("a referencePrice above the current price is clamped down to it", async () => {
        // Otherwise a client posts referencePrice: 999999 and is notified of a
        // "price drop" on the very next scan for a product whose price has not
        // moved at all.
        db.query.mockImplementation(async (sql) => {
            if (VISIBLE_PRODUCT_SQL.test(sql)) {
                return [visibleProduct({ price: "80.00" })];
            }
            if (/^\s*INSERT INTO stock_alert_subscriptions/i.test(sql)) {
                return [{ affectedRows: 1 }];
            }
            return [[{ id: 5, alert_type: "price_drop", reference_price: "80.00" }]];
        });

        await service.subscribe({
            userId: "u1",
            productId: "p1",
            alertType: "price_drop",
            referencePrice: 999999,
        });

        const inserts = callsMatching(/INSERT INTO stock_alert_subscriptions/i);
        expect(inserts[0][1]).toEqual(["u1", "p1", "price_drop", 80]);
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
