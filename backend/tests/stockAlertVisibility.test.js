// backend/tests/stockAlertVisibility.test.js
//
// Stock alerts and product visibility (#1609).
//
// `products` carries `deleted_at` and a `status` enum, and
// `constants/productVisibility.js` has existed since #1456 to say what those
// two mean together. The alert engine was the one public path that never
// imported it: both evaluators joined `stock_alert_subscriptions` to `products`
// on nothing but the id, so a soft-deleted, archived, inactive or still-draft
// product that gained stock -- a correction, a return, a re-import -- mailed
// every subscriber, and the link in that mail lands on a page the product
// routes deliberately 404.
//
// The same gap was at the front door: only a price-drop subscription *without*
// a baseline ever looked a product up at all.
//
// These tests assert the predicate reaches the SQL and that the subscribe path
// refuses an invisible product, using the real
// `publicProductCondition` rather than a copy of its text -- so if the
// definition of "public" changes, this suite follows it instead of pinning the
// old one.

jest.mock("../config/db", () => ({ query: jest.fn() }));

jest.mock("../services/notificationBrokerService", () => ({
    notificationBroker: { publish: jest.fn(async () => ({ id: "NOTIF" })) },
    NOTIFICATION_TYPES: {
        PRODUCT_BACK_IN_STOCK: "product.back_in_stock",
        WISHLIST_PRICE_DROP: "wishlist.price_drop",
    },
}));

const db = require("../config/db");
const { notificationBroker } = require("../services/notificationBrokerService");
const { publicProductCondition, PUBLIC_PRODUCT_STATUSES } =
    require("../constants/productVisibility");
const service = require("../services/stockAlertService");

const VISIBLE_PRODUCT_SQL = /FROM products p\s+WHERE p\.id = \?/i;
const DETECTION_SQL = /FROM stock_alert_subscriptions s/i;

/** The SQL and params the shared condition produces for the `p` alias. */
const CONDITION = publicProductCondition("p");

/** Route each query to canned rows, mirroring config/db's `[rows]` contract. */
function respondWith(responder) {
    db.query.mockImplementation(async (sql, params = []) => [responder(sql, params)]);
}

function callsMatching(regex) {
    return db.query.mock.calls.filter(([sql]) => regex.test(sql));
}

afterEach(() => {
    db.query.mockReset();
    notificationBroker.publish.mockClear();
});

describe("the shared visibility condition reaches the evaluators", () => {
    test("evaluateRestocks filters on deleted_at and status", async () => {
        respondWith(() => []);

        await service.evaluateRestocks();

        const [sql, params] = callsMatching(DETECTION_SQL)[0];

        expect(sql).toContain(CONDITION.sql);
        expect(sql).toMatch(/p\.deleted_at IS NULL/i);
        expect(sql).toMatch(/p\.status IN/i);

        // The status placeholders are bound, not interpolated, and they trail
        // the alert-type and subscription-status parameters.
        expect(params.slice(-CONDITION.params.length)).toEqual(CONDITION.params);
        PUBLIC_PRODUCT_STATUSES.forEach((status) => expect(params).toContain(status));
    });

    test("evaluatePriceDrops filters on deleted_at and status", async () => {
        respondWith(() => []);

        await service.evaluatePriceDrops();

        const [sql, params] = callsMatching(DETECTION_SQL)[0];

        expect(sql).toContain(CONDITION.sql);
        expect(sql).toMatch(/p\.price < s\.reference_price/i);
        expect(params.slice(-CONDITION.params.length)).toEqual(CONDITION.params);
    });

    test("the placeholder count still matches the parameter count", async () => {
        // The class of mistake this whole file exists to stop is a predicate
        // appended without its parameters. Counting is cheap; debugging
        // ER_WRONG_ARGUMENTS at 3am is not.
        respondWith(() => []);

        await service.evaluateRestocks();
        await service.evaluatePriceDrops();

        callsMatching(DETECTION_SQL).forEach(([sql, params]) => {
            const placeholders = (sql.match(/\?/g) || []).length;
            expect(params).toHaveLength(placeholders);
        });
    });

    test("a withdrawn product produces no dispatch, because the query never returns it", async () => {
        // The database is the thing enforcing this, so the honest test is that
        // an empty result set publishes nothing and marks nothing -- and that
        // the predicate which produces that empty set is present, asserted
        // above.
        respondWith((sql) => (DETECTION_SQL.test(sql) ? [] : { affectedRows: 0 }));

        expect(await service.evaluateRestocks()).toBe(0);
        expect(await service.evaluatePriceDrops()).toBe(0);
        expect(notificationBroker.publish).not.toHaveBeenCalled();
        expect(callsMatching(/UPDATE stock_alert_subscriptions/i)).toHaveLength(0);
    });
});

describe("subscribe refuses a product no shopper may see", () => {
    const invisible = (sql) => (VISIBLE_PRODUCT_SQL.test(sql) ? [] : { affectedRows: 0 });

    test.each(["back_in_stock", "price_drop"])(
        "%s against an invisible product throws PRODUCT_NOT_VISIBLE",
        async (alertType) => {
            respondWith(invisible);

            await expect(
                service.subscribe({ userId: "u1", productId: "hidden", alertType })
            ).rejects.toMatchObject({
                name: "StockAlertError",
                code: "PRODUCT_NOT_VISIBLE",
            });

            // Nothing was written. A rejected subscription must not leave a row
            // behind for a later scan to find.
            expect(callsMatching(/INSERT INTO stock_alert_subscriptions/i)).toHaveLength(0);
        }
    );

    test("a client-supplied referencePrice does not skip the check", async () => {
        // This was the second half of the hole: the only lookup that existed
        // ran when the caller left referencePrice null, so pinning one bought a
        // subscription to anything at all.
        respondWith(invisible);

        await expect(
            service.subscribe({
                userId: "u1",
                productId: "hidden",
                alertType: "price_drop",
                referencePrice: 10,
            })
        ).rejects.toMatchObject({ code: "PRODUCT_NOT_VISIBLE" });

        expect(callsMatching(VISIBLE_PRODUCT_SQL)).toHaveLength(1);
    });

    test("the lookup itself carries the visibility condition", async () => {
        respondWith(invisible);

        await service
            .subscribe({ userId: "u1", productId: "hidden", alertType: "back_in_stock" })
            .catch(() => {});

        const [sql, params] = callsMatching(VISIBLE_PRODUCT_SQL)[0];
        expect(sql).toContain(CONDITION.sql);
        expect(params).toEqual(["hidden", ...CONDITION.params]);
    });

    test("the message does not reveal which of the two reasons applied", async () => {
        // "no such product" and "that product is not on sale yet" have to read
        // the same, or the endpoint becomes a probe for unreleased catalogue.
        respondWith(invisible);

        const failure = await service
            .subscribe({ userId: "u1", productId: "hidden", alertType: "back_in_stock" })
            .catch((error) => error);

        expect(failure.message).toBe("Product not found: hidden");
        expect(failure.message).not.toMatch(/draft|archived|deleted|inactive/i);
    });
});

describe("resolveReferencePrice", () => {
    const { resolveReferencePrice, StockAlertError } = service;

    test("defaults to the product's current price", () => {
        expect(resolveReferencePrice(null, "19.99")).toBe(19.99);
        expect(resolveReferencePrice(undefined, 80)).toBe(80);
        expect(resolveReferencePrice("", 80)).toBe(80);
    });

    test("honours a baseline at or below the current price", () => {
        expect(resolveReferencePrice(50, 80)).toBe(50);
        expect(resolveReferencePrice("50.00", 80)).toBe(50);
        expect(resolveReferencePrice(80, 80)).toBe(80);
    });

    test("clamps a baseline above the current price", () => {
        expect(resolveReferencePrice(999999, 80)).toBe(80);
    });

    test("rejects a baseline that is not a positive number", () => {
        expect(() => resolveReferencePrice(0, 80)).toThrow(StockAlertError);
        expect(() => resolveReferencePrice(-5, 80)).toThrow(/positive/i);
        expect(() => resolveReferencePrice("free", 80)).toThrow(/positive/i);
    });

    test("survives a product price the column could not give us", () => {
        expect(resolveReferencePrice(null, null)).toBe(0);
        expect(resolveReferencePrice(null, "not a price")).toBe(0);
    });
});

describe("purgeUnavailableSubscriptions", () => {
    test("cancels active subscriptions for soft-deleted and archived products", async () => {
        respondWith(() => ({ affectedRows: 4 }));

        const purged = await service.purgeUnavailableSubscriptions();

        expect(purged).toBe(4);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/UPDATE stock_alert_subscriptions s/i);
        expect(sql).toMatch(/JOIN products p ON p\.id = s\.product_id/i);
        expect(sql).toMatch(/p\.deleted_at IS NOT NULL OR p\.status = 'archived'/i);
        expect(params).toEqual(["cancelled", "active"]);
    });

    test("leaves an inactive product's subscriptions alone", async () => {
        // `inactive` is explicitly "withdrawn, expected back" in
        // constants/productVisibility.js, so a subscription against one is
        // still worth keeping -- it simply must not fire while it is withdrawn.
        respondWith(() => ({ affectedRows: 0 }));

        await service.purgeUnavailableSubscriptions();

        const [sql] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/'inactive'/);
        expect(sql).not.toMatch(/'draft'/);
    });

    test("reports zero when the driver returns no row count", async () => {
        respondWith(() => ({}));

        expect(await service.purgeUnavailableSubscriptions()).toBe(0);
    });
});
