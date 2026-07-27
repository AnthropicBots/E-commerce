// Tests for the stock-alert evaluation engine (#1233, PR 2/3). The db module
// and the notification broker are both mocked so we can assert the
// join-driven detection, the broker dispatch (right type + payload), and the
// dispatch-then-mark-notified dedupe -- without a live MySQL or real broker.
//
// db.query returns canned rows keyed off the SQL text; the broker's publish is
// a spy so we can assert what was published and, crucially, that nothing is
// published when there is nothing to notify.

jest.mock("../config/db", () => {
    const query = jest.fn();
    return { query };
});

jest.mock("../services/notificationBrokerService", () => {
    const publish = jest.fn(async () => ({ id: "NOTIF_TEST" }));
    return {
        notificationBroker: { publish },
        NOTIFICATION_TYPES: {
            PRODUCT_BACK_IN_STOCK: "product.back_in_stock",
            WISHLIST_PRICE_DROP: "wishlist.price_drop",
        },
    };
});

const db = require("../config/db");
const { notificationBroker, NOTIFICATION_TYPES } = require("../services/notificationBrokerService");
const service = require("../services/stockAlertService");

// Route each SQL string to canned rows. Every db.query returns `[rows]` to
// mirror the real config/db wrapper, which destructures as `const [rows] =`.
function respondWith(responder) {
    db.query.mockImplementation(async (sql, params = []) => {
        return [responder(sql, params)];
    });
}

function updateCalls() {
    return db.query.mock.calls.filter(([sql]) =>
        /UPDATE stock_alert_subscriptions/i.test(sql)
    );
}

afterEach(() => {
    db.query.mockReset();
    notificationBroker.publish.mockClear();
});

describe("evaluateRestocks", () => {
    test("detected restock publishes PRODUCT_BACK_IN_STOCK and marks the row notified", async () => {
        respondWith((sql) => {
            if (/JOIN products/i.test(sql) && /back_in_stock/i.test(sql)) {
                return [{ id: 42, user_id: "user-1", product_id: "prod-1", stock: 7 }];
            }
            return [{ affectedRows: 1 }];
        });

        const summary = await service.evaluateRestocks();

        // The detection query joins subscriptions to products, filters on the
        // active back_in_stock + stock > 0 predicate.
        const [detectSql] = db.query.mock.calls[0];
        expect(detectSql).toMatch(/JOIN products/i);
        expect(detectSql).toMatch(/alert_type = 'back_in_stock'/i);
        expect(detectSql).toMatch(/status = 'active'/i);
        expect(detectSql).toMatch(/p\.stock > 0/i);

        expect(notificationBroker.publish).toHaveBeenCalledTimes(1);
        const [type, data, options] = notificationBroker.publish.mock.calls[0];
        expect(type).toBe(NOTIFICATION_TYPES.PRODUCT_BACK_IN_STOCK);
        expect(data).toMatchObject({ userId: "user-1", productId: "prod-1", stock: 7 });
        expect(options.channels).toEqual(["in_app", "email"]);

        // Marked notified for the matched id -> dedupe on the next run.
        const updates = updateCalls();
        expect(updates).toHaveLength(1);
        expect(updates[0][0]).toMatch(/SET status = 'notified'/i);
        expect(updates[0][1][updates[0][1].length - 1]).toBe(42);

        expect(summary).toEqual({ notifiedCount: 1, notifiedIds: [42] });
    });

    test("no qualifying restock: nothing published, nothing marked notified", async () => {
        respondWith((sql) => {
            if (/JOIN products/i.test(sql)) return [];
            return [{ affectedRows: 0 }];
        });

        const summary = await service.evaluateRestocks();

        expect(notificationBroker.publish).not.toHaveBeenCalled();
        expect(updateCalls()).toHaveLength(0);
        expect(summary).toEqual({ notifiedCount: 0, notifiedIds: [] });
    });
});

describe("evaluatePriceDrops", () => {
    test("detected price drop publishes WISHLIST_PRICE_DROP and marks the row notified", async () => {
        respondWith((sql) => {
            if (/JOIN products/i.test(sql) && /price_drop/i.test(sql)) {
                return [
                    { id: 99, user_id: "user-2", product_id: "prod-9", reference_price: 100.0, price: 79.99 },
                ];
            }
            return [{ affectedRows: 1 }];
        });

        const summary = await service.evaluatePriceDrops();

        const [detectSql] = db.query.mock.calls[0];
        expect(detectSql).toMatch(/JOIN products/i);
        expect(detectSql).toMatch(/alert_type = 'price_drop'/i);
        expect(detectSql).toMatch(/status = 'active'/i);
        expect(detectSql).toMatch(/p\.price < s\.reference_price/i);

        expect(notificationBroker.publish).toHaveBeenCalledTimes(1);
        const [type, data, options] = notificationBroker.publish.mock.calls[0];
        expect(type).toBe(NOTIFICATION_TYPES.WISHLIST_PRICE_DROP);
        expect(data).toMatchObject({
            userId: "user-2",
            productId: "prod-9",
            price: 79.99,
            referencePrice: 100.0,
        });
        expect(options.channels).toEqual(["in_app", "email"]);

        const updates = updateCalls();
        expect(updates).toHaveLength(1);
        expect(updates[0][0]).toMatch(/SET status = 'notified'/i);
        expect(updates[0][1][updates[0][1].length - 1]).toBe(99);

        expect(summary).toEqual({ notifiedCount: 1, notifiedIds: [99] });
    });

    test("no qualifying price drop: nothing published, nothing marked notified", async () => {
        respondWith((sql) => {
            if (/JOIN products/i.test(sql)) return [];
            return [{ affectedRows: 0 }];
        });

        const summary = await service.evaluatePriceDrops();

        expect(notificationBroker.publish).not.toHaveBeenCalled();
        expect(updateCalls()).toHaveLength(0);
        expect(summary).toEqual({ notifiedCount: 0, notifiedIds: [] });
    });
});

// The subscription-management methods below are the PR 1/3 foundation
// reproduced into this stacked worktree. They are exercised here so the
// evaluation-engine run also covers the whole service file end to end.
describe("subscription foundation (PR 1/3)", () => {
    test("subscribe to price_drop with no referencePrice anchors to the current product price", async () => {
        respondWith((sql) => {
            if (/SELECT price FROM products/i.test(sql)) return [{ price: 100.0 }];
            return { insertId: 5, affectedRows: 1 };
        });

        const result = await service.subscribe({
            userId: "user-1",
            productId: "prod-1",
            alertType: "price_drop",
        });

        expect(result).toMatchObject({ referencePrice: 100.0, id: 5 });

        // Idempotent insert: dedupe rides the UNIQUE key via ON DUPLICATE KEY.
        const [insertSql, insertParams] = db.query.mock.calls.find(([sql]) =>
            /INSERT INTO stock_alert_subscriptions/i.test(sql)
        );
        expect(insertSql).toMatch(/ON DUPLICATE KEY UPDATE/i);
        expect(insertParams).toEqual(["user-1", "prod-1", "price_drop", 100.0]);
    });

    test("subscribe to back_in_stock does not look up product price", async () => {
        respondWith(() => ({ insertId: 6, affectedRows: 1 }));

        await service.subscribe({ userId: "user-1", productId: "prod-2", alertType: "back_in_stock" });

        const priceLookups = db.query.mock.calls.filter(([sql]) =>
            /SELECT price FROM products/i.test(sql)
        );
        expect(priceLookups).toHaveLength(0);
    });

    test("subscribe to price_drop for a missing product throws", async () => {
        respondWith((sql) => {
            if (/SELECT price FROM products/i.test(sql)) return [];
            return { insertId: 0 };
        });

        await expect(
            service.subscribe({ userId: "user-1", productId: "gone", alertType: "price_drop" })
        ).rejects.toThrow(/not found/i);
    });

    test("unsubscribe soft-cancels the matching subscription", async () => {
        respondWith(() => ({ affectedRows: 1 }));

        const ok = await service.unsubscribe({
            userId: "user-1",
            productId: "prod-1",
            alertType: "back_in_stock",
        });

        expect(ok).toBe(true);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/SET status = 'cancelled'/i);
        expect(params).toEqual(["user-1", "prod-1", "back_in_stock"]);
    });

    test("listSubscriptions applies alertType and status filters", async () => {
        respondWith(() => [{ id: 1, user_id: "user-1", status: "active" }]);

        const rows = await service.listSubscriptions("user-1", {
            alertType: "price_drop",
            status: "active",
        });

        expect(rows).toHaveLength(1);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/WHERE user_id = \?/i);
        expect(sql).toMatch(/AND alert_type = \?/i);
        expect(sql).toMatch(/AND status = \?/i);
        expect(params).toEqual(["user-1", "price_drop", "active"]);
    });

    test("listSubscriptions with no options filters only by user", async () => {
        respondWith(() => [{ id: 1, user_id: "user-1" }]);

        await service.listSubscriptions("user-1");

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/alert_type = \?/i);
        expect(sql).not.toMatch(/AND status = \?/i);
        expect(params).toEqual(["user-1"]);
    });
});

describe("dedupe: already-notified subscriptions are never re-published", () => {
    // The evaluate queries only ever return status='active' rows; a row that
    // was already flipped to 'notified' is filtered out by the SQL, so the
    // canned result set for the detection query is empty. This asserts the
    // engine's contract: a second run over already-notified data is a no-op.
    test("evaluateRestocks re-run over notified data publishes nothing", async () => {
        respondWith((sql) => {
            // Simulate the DB after the first run: no active rows remain.
            if (/JOIN products/i.test(sql)) return [];
            return [{ affectedRows: 0 }];
        });

        const summary = await service.evaluateRestocks();

        expect(notificationBroker.publish).not.toHaveBeenCalled();
        expect(summary.notifiedCount).toBe(0);
    });
});
