// backend/tests/cartProductVisibility.test.js
//
// The cart obeys the same visibility rule as the rest of the catalogue (#1546).
//
// `deleteProduct` is a soft delete and `products.status` carries the lifecycle,
// so "the row exists" and "a shopper may buy this" are different questions. The
// catalogue and the wishlist have asked the second one since #1456; the cart
// asked the first, so a withdrawn product stayed addable, stayed in the basket
// and travelled to checkout.
//
// The database is mocked at the module boundary, as the rest of this suite
// does. What is pinned here is not SQL text but the property that every cart
// path -- read and write -- carries the visibility predicate, and that a line
// it excludes is reported rather than silently dropped.

jest.mock("../config/db", () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    pool.promise = pool;
    return pool;
});

jest.mock("../services/inventoryReservationService", () => ({
    reserveStock: jest.fn().mockResolvedValue(true),
    releaseUserLocks: jest.fn().mockResolvedValue(),
    releaseLineLocks: jest.fn().mockResolvedValue(),
    consumeLocks: jest.fn().mockResolvedValue()
}));

jest.mock("../services/cartLifecycleService", () => ({
    resolveActiveCart: jest.fn().mockResolvedValue("cart-1"),
    findActiveCartId: jest.fn().mockResolvedValue("cart-1"),
    touchCart: jest.fn().mockResolvedValue()
}));

jest.mock("../services/guestCartService", () => ({
    resolveCart: jest.fn().mockResolvedValue({ cartId: "cart-1", token: null }),
    findCartIdByToken: jest.fn().mockResolvedValue("cart-1"),
    touchToken: jest.fn().mockResolvedValue()
}));

jest.mock("../services/cartRestoreService", () => ({
    issueLink: jest.fn(),
    redeemLink: jest.fn()
}));

const db = require("../config/db");
const cartController = require("../controllers/cartController");
const {
    PUBLIC_PRODUCT_STATUSES
} = require("../constants/productVisibility");

const USER = "11111111-1111-4111-8111-111111111111";
const LIVE_PRODUCT = "22222222-2222-4222-8222-222222222222";
const WITHDRAWN_PRODUCT = "33333333-3333-4333-8333-333333333333";

function mockRes() {
    return {
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
}

/**
 * A connection double that answers the product lookup with whichever ids are
 * declared live, and everything else with an empty result.
 */
function fakeConnection(liveIds = []) {
    const calls = [];

    return {
        calls,
        query: jest.fn(async (sql, params = []) => {
            calls.push({ sql, params });

            if (/FROM products/.test(sql)) {
                return [liveIds.map((id) => ({ id }))];
            }

            if (/SELECT COUNT/.test(sql)) {
                return [[{ total: 0 }]];
            }

            return [{ affectedRows: 1 }];
        }),
        beginTransaction: jest.fn().mockResolvedValue(),
        commit: jest.fn().mockResolvedValue(),
        rollback: jest.fn().mockResolvedValue(),
        release: jest.fn()
    };
}

function productLookups(connection) {
    return connection.calls.filter(({ sql }) => /FROM products/.test(sql));
}

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
});

// ----------------------------------------------------------------------
// Reading the cart
// ----------------------------------------------------------------------

describe("GET /cart", () => {
    function stubRead(cartRows, heldTotal) {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT COUNT/.test(sql)) return [[{ total: heldTotal }]];
            return [cartRows];
        });
    }

    test("the join carries the visibility predicate", async () => {
        stubRead([], 0);

        await cartController.getUserCart(
            { cartIdentity: { userId: USER, guestToken: null } },
            mockRes()
        );

        const [sql, params] = db.query.mock.calls.find(([text]) =>
            /FROM cart_items/.test(text) && /JOIN products/.test(text)
        );

        expect(sql).toMatch(/p\.deleted_at IS NULL/);
        expect(sql).toMatch(/p\.status IN/);
        expect(params).toEqual(
            expect.arrayContaining(PUBLIC_PRODUCT_STATUSES)
        );
    });

    test("a line whose product was withdrawn is reported, not silently lost", async () => {
        // Two lines held, one still buyable.
        stubRead([{ id: LIVE_PRODUCT, qty: 1 }], 2);

        const res = mockRes();

        await cartController.getUserCart(
            { cartIdentity: { userId: USER, guestToken: null } },
            res
        );

        expect(res.statusCode).toBe(200);
        expect(res.body.cart).toHaveLength(1);
        expect(res.body.unavailableCount).toBe(1);
    });

    test("a basket with nothing withdrawn reports a count of zero", async () => {
        stubRead([{ id: LIVE_PRODUCT, qty: 1 }], 1);

        const res = mockRes();

        await cartController.getUserCart(
            { cartIdentity: { userId: USER, guestToken: null } },
            res
        );

        expect(res.body.unavailableCount).toBe(0);
    });

    test("an empty cart never reaches the database", async () => {
        const cartLifecycle = require("../services/cartLifecycleService");
        cartLifecycle.findActiveCartId.mockResolvedValueOnce(null);

        const res = mockRes();

        await cartController.getUserCart(
            { cartIdentity: { userId: USER, guestToken: null } },
            res
        );

        expect(res.body.cart).toEqual([]);
        expect(db.query).not.toHaveBeenCalled();
    });
});

// ----------------------------------------------------------------------
// POST /cart/sync
// ----------------------------------------------------------------------

describe("POST /cart/sync", () => {
    test("the product lookup asks whether the product is live, not whether it exists", async () => {
        const connection = fakeConnection([LIVE_PRODUCT]);
        db.getConnection.mockResolvedValue(connection);

        await cartController.syncCart(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { items: [{ productId: LIVE_PRODUCT, quantity: 1 }] }
            },
            mockRes()
        );

        const [lookup] = productLookups(connection);

        expect(lookup.sql).toMatch(/p\.deleted_at IS NULL/);
        expect(lookup.sql).toMatch(/p\.status IN/);
        expect(lookup.params).toEqual(
            expect.arrayContaining([LIVE_PRODUCT, ...PUBLIC_PRODUCT_STATUSES])
        );
    });

    test("a withdrawn product is not written into the basket", async () => {
        const connection = fakeConnection([LIVE_PRODUCT]);
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await cartController.syncCart(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: {
                    items: [
                        { productId: LIVE_PRODUCT, quantity: 1 },
                        { productId: WITHDRAWN_PRODUCT, quantity: 2 }
                    ]
                }
            },
            res
        );

        const insert = connection.calls.find(({ sql }) =>
            /INSERT INTO cart_items/.test(sql)
        );

        expect(insert).toBeDefined();
        expect(insert.params).toContain(LIVE_PRODUCT);
        expect(insert.params).not.toContain(WITHDRAWN_PRODUCT);
        expect(res.statusCode).toBe(200);
    });

    test("the dropped ids come back on the response", async () => {
        const connection = fakeConnection([LIVE_PRODUCT]);
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await cartController.syncCart(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: {
                    items: [
                        { productId: LIVE_PRODUCT, quantity: 1 },
                        { productId: WITHDRAWN_PRODUCT, quantity: 2 }
                    ]
                }
            },
            res
        );

        expect(res.body.droppedProductIds).toEqual([WITHDRAWN_PRODUCT]);
        expect(res.body.dropped).toBe(1);
    });

    test("a sync with nothing withdrawn reports no drops", async () => {
        const connection = fakeConnection([LIVE_PRODUCT]);
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await cartController.syncCart(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { items: [{ productId: LIVE_PRODUCT, quantity: 1 }] }
            },
            res
        );

        expect(res.body.dropped).toBe(0);
        expect(res.body.droppedProductIds).toEqual([]);
    });

    test("no stock is reserved for a product that is not live", async () => {
        const inventory = require("../services/inventoryReservationService");
        const connection = fakeConnection([]);
        db.getConnection.mockResolvedValue(connection);

        await cartController.syncCart(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { items: [{ productId: WITHDRAWN_PRODUCT, quantity: 3 }] }
            },
            mockRes()
        );

        expect(inventory.reserveStock).not.toHaveBeenCalled();
    });

    test("an empty payload does not go looking for products at all", async () => {
        const connection = fakeConnection([]);
        db.getConnection.mockResolvedValue(connection);

        await cartController.syncCart(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { items: [] }
            },
            mockRes()
        );

        expect(productLookups(connection)).toHaveLength(0);
    });
});

// ----------------------------------------------------------------------
// POST /cart  (add a single line)
// ----------------------------------------------------------------------

describe("POST /cart", () => {
    test("adding a withdrawn product is a 404, not a silent success", async () => {
        const connection = fakeConnection([]);
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await cartController.addToCart(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { productId: WITHDRAWN_PRODUCT, quantity: 1 }
            },
            res
        );

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("the check runs before any stock is reserved", async () => {
        const inventory = require("../services/inventoryReservationService");
        const connection = fakeConnection([]);
        db.getConnection.mockResolvedValue(connection);

        await cartController.addToCart(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { productId: WITHDRAWN_PRODUCT, quantity: 1 }
            },
            mockRes()
        );

        expect(inventory.reserveStock).not.toHaveBeenCalled();
    });

    test("a live product still goes in", async () => {
        const connection = fakeConnection([LIVE_PRODUCT]);
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await cartController.addToCart(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { productId: LIVE_PRODUCT, quantity: 1 }
            },
            res
        );

        expect(res.statusCode).toBe(200);
        expect(connection.commit).toHaveBeenCalled();
    });
});

// ----------------------------------------------------------------------
// PATCH /cart  (change a line's quantity)
// ----------------------------------------------------------------------

describe("PATCH /cart", () => {
    test("raising the quantity of a withdrawn product is refused", async () => {
        const connection = fakeConnection([]);
        db.getConnection.mockResolvedValue(connection);

        const res = mockRes();

        await cartController.updateCartItem(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { productId: WITHDRAWN_PRODUCT, quantity: 5 }
            },
            res
        );

        expect(res.statusCode).toBe(404);
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("the reservation is not moved for a product that is not live", async () => {
        const inventory = require("../services/inventoryReservationService");
        const connection = fakeConnection([]);
        db.getConnection.mockResolvedValue(connection);

        await cartController.updateCartItem(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { productId: WITHDRAWN_PRODUCT, quantity: 5 }
            },
            mockRes()
        );

        expect(inventory.releaseLineLocks).not.toHaveBeenCalled();
        expect(inventory.reserveStock).not.toHaveBeenCalled();
    });

    test("the lookup carries the visibility predicate", async () => {
        const connection = fakeConnection([LIVE_PRODUCT]);
        db.getConnection.mockResolvedValue(connection);

        await cartController.updateCartItem(
            {
                cartIdentity: { userId: USER, guestToken: null },
                body: { productId: LIVE_PRODUCT, quantity: 2 }
            },
            mockRes()
        );

        const [lookup] = productLookups(connection);

        expect(lookup.sql).toMatch(/p\.deleted_at IS NULL/);
        expect(lookup.sql).toMatch(/p\.status IN/);
    });
});
