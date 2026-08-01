// Tests for variant-authoritative stock (#1428).
//
// The point of the change is that one counter is checked, decremented and
// credited back, so these assert which table each movement lands on and that
// the sufficiency test stays inside the UPDATE's WHERE clause. A read followed
// by a write would pass every functional test here and still oversell under
// concurrency, so the shape of the statement is asserted, not only its effect.

jest.mock("../config/db", () => {
    const query = jest.fn();
    return { query, getConnection: jest.fn() };
});

jest.mock("../utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock("../services/promo.service", () => ({
    validatePromo: jest.fn()
}));

jest.mock("../services/cartLifecycleService", () => ({
    markCartConverted: jest.fn(async () => ({ cartId: null, converted: false }))
}));

const stockCounter = require("../services/stockCounterService");
const { resolveOrderLines } = require("../services/order.service");

const PRODUCT_ID = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

function makeConnection(responder) {
    const calls = [];
    const query = jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        return responder(sql, params);
    });
    return { query, calls };
}

function sqlsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

describe("deductStock", () => {
    test("a line with a variant draws down the variant, guarded on the variant's own balance", async () => {
        const { query, calls } = makeConnection(() => [{ affectedRows: 1 }]);

        const movement = await stockCounter.deductStock(
            { query },
            { productId: PRODUCT_ID, variantId: 42, quantity: 3 }
        );

        expect(movement.ok).toBe(true);

        const variantUpdates = sqlsMatching(calls, /UPDATE product_variants SET stock = stock - \?/i);
        expect(variantUpdates).toHaveLength(1);

        // The whole concurrency property: the balance test is a predicate on the
        // write, not a separate read, so a losing racer changes no rows.
        expect(variantUpdates[0].sql).toMatch(/WHERE id = \? AND product_id = \? AND stock >= \?/i);
        expect(variantUpdates[0].params).toEqual([3, 42, PRODUCT_ID, 3]);

        // Nothing gates on the product total for a variant line.
        expect(sqlsMatching(calls, /UPDATE products SET stock = stock - \?/i)).toHaveLength(0);
    });

    test("the product total follows the variant sale as a clamped roll-up", async () => {
        const { calls, query } = makeConnection(() => [{ affectedRows: 1 }]);

        await stockCounter.deductStock(
            { query },
            { productId: PRODUCT_ID, variantId: 42, quantity: 2 }
        );

        const rollups = sqlsMatching(calls, /UPDATE products SET stock = GREATEST\(stock - \?, 0\)/i);
        expect(rollups).toHaveLength(1);
        expect(rollups[0].params).toEqual([2, PRODUCT_ID]);
    });

    test("a variant that cannot cover the line is refused and the product total is left alone", async () => {
        const { query, calls } = makeConnection((sql) => {
            if (/UPDATE product_variants SET stock = stock - \?/i.test(sql)) {
                return [{ affectedRows: 0 }];
            }
            return [{ affectedRows: 1 }];
        });

        const movement = await stockCounter.deductStock(
            { query },
            { productId: PRODUCT_ID, variantId: 42, quantity: 5 }
        );

        expect(movement.ok).toBe(false);
        expect(sqlsMatching(calls, /UPDATE products/i)).toHaveLength(0);
    });

    test("a line with no variant keeps the product-level conditional decrement", async () => {
        const { query, calls } = makeConnection(() => [{ affectedRows: 1 }]);

        const movement = await stockCounter.deductStock(
            { query },
            { productId: PRODUCT_ID, quantity: 4 }
        );

        expect(movement.ok).toBe(true);
        expect(sqlsMatching(calls, /UPDATE product_variants/i)).toHaveLength(0);

        const productUpdates = sqlsMatching(calls, /UPDATE products SET stock = stock - \?/i);
        expect(productUpdates).toHaveLength(1);
        expect(productUpdates[0].sql).toMatch(/WHERE id = \? AND stock >= \?/i);
        expect(productUpdates[0].params).toEqual([4, PRODUCT_ID, 4]);
    });

    test("a product that cannot cover the line is refused", async () => {
        const { query } = makeConnection(() => [{ affectedRows: 0 }]);

        const movement = await stockCounter.deductStock(
            { query },
            { productId: PRODUCT_ID, quantity: 4 }
        );

        expect(movement.ok).toBe(false);
    });
});

describe("restoreStock", () => {
    test("credits the variant the sale drew down, and the roll-up with it", async () => {
        const { query, calls } = makeConnection(() => [{ affectedRows: 1 }]);

        await stockCounter.restoreStock(
            { query },
            { productId: PRODUCT_ID, variantId: 42, quantity: 2 }
        );

        const variantCredits = sqlsMatching(calls, /UPDATE product_variants SET stock = stock \+ \?/i);
        expect(variantCredits).toHaveLength(1);
        expect(variantCredits[0].params).toEqual([2, 42]);

        const productCredits = sqlsMatching(calls, /UPDATE products SET stock = stock \+ \?/i);
        expect(productCredits).toHaveLength(1);
        expect(productCredits[0].params).toEqual([2, PRODUCT_ID]);
    });

    test("an item with no variant recorded credits the product total only", async () => {
        const { query, calls } = makeConnection(() => [{ affectedRows: 1 }]);

        await stockCounter.restoreStock(
            { query },
            { productId: PRODUCT_ID, variantId: null, quantity: 2 }
        );

        expect(sqlsMatching(calls, /UPDATE product_variants/i)).toHaveLength(0);
        expect(sqlsMatching(calls, /UPDATE products SET stock = stock \+ \?/i)).toHaveLength(1);
    });
});

describe("resolveVariant", () => {
    test("an ambiguous colour and size match resolves to nothing rather than a guess", async () => {
        const { query } = makeConnection(() => [[{ id: 1, price: 10, stock: 5 }, { id: 2, price: 10, stock: 5 }]]);

        const variant = await stockCounter.resolveVariant(
            { query },
            PRODUCT_ID,
            { color: "blue", size: "m" }
        );

        expect(variant).toBeNull();
    });

    test("an explicit variant id is looked up under a row lock when the caller is in a transaction", async () => {
        const { query, calls } = makeConnection(() => [[{ id: 42, price: 10, stock: 5 }]]);

        const variant = await stockCounter.resolveVariant({ query }, PRODUCT_ID, { variantId: 42 });

        expect(variant).toMatchObject({ id: 42 });
        expect(calls[0].sql).toMatch(/FOR UPDATE/i);
        expect(calls[0].sql).toMatch(/is_active = 1/i);
    });
});

describe("getVariantRollup", () => {
    test("totals only the variants a shopper can select", async () => {
        const { query, calls } = makeConnection(() => [[{ variant_count: 3, variant_stock: 11 }]]);

        const rollup = await stockCounter.getVariantRollup({ query }, PRODUCT_ID);

        expect(rollup).toEqual({ variantCount: 3, stock: 11 });
        expect(calls[0].sql).toMatch(/is_active = 1 AND deleted_at IS NULL/i);
    });

    test("a deployment without the variants table falls back to product-level behaviour", async () => {
        const query = jest.fn(async () => {
            throw new Error("Table 'product_variants' doesn't exist");
        });

        await expect(stockCounter.getVariantRollup({ query }, PRODUCT_ID)).resolves.toEqual({
            variantCount: 0,
            stock: 0
        });
    });
});

describe("resolveOrderLines", () => {
    test("refuses a variant the variant cannot cover even when the product total could", async () => {
        const { query } = makeConnection((sql) => {
            if (/FROM products WHERE id = \?/i.test(sql)) {
                return [[{ id: PRODUCT_ID, name: "Tee", price: 20, stock: 100, image: "" }]];
            }
            if (/FROM product_variants/i.test(sql)) {
                return [[{ id: 42, price: 20, stock: 2 }]];
            }
            return [{ affectedRows: 1 }];
        });

        await expect(
            resolveOrderLines({ query }, [{ id: PRODUCT_ID, variantId: 42, qty: 10 }])
        ).rejects.toThrow(/Insufficient stock for Tee/);
    });

    test("still enforces against the product total when the line has no variant", async () => {
        const { query } = makeConnection((sql) => {
            if (/FROM products WHERE id = \?/i.test(sql)) {
                return [[{ id: PRODUCT_ID, name: "Tee", price: 20, stock: 1, image: "" }]];
            }
            return [{ affectedRows: 1 }];
        });

        await expect(
            resolveOrderLines({ query }, [{ id: PRODUCT_ID, qty: 3 }])
        ).rejects.toThrow(/Insufficient stock for Tee/);
    });

    test("carries the resolved variant onto the line so the sale and any return name the same counter", async () => {
        const { query } = makeConnection((sql) => {
            if (/FROM products WHERE id = \?/i.test(sql)) {
                return [[{ id: PRODUCT_ID, name: "Tee", price: 20, stock: 100, image: "" }]];
            }
            if (/FROM product_variants/i.test(sql)) {
                return [[{ id: 42, price: 25, stock: 9 }]];
            }
            return [{ affectedRows: 1 }];
        });

        const lines = await resolveOrderLines({ query }, [
            { id: PRODUCT_ID, variantId: 42, qty: 2 }
        ]);

        expect(lines).toHaveLength(1);
        expect(lines[0].variantId).toBe(42);
        expect(lines[0].price).toBe(25);
    });

    test("a line with no variant carries the sentinel, so nothing later mistakes it for one", async () => {
        const { query } = makeConnection((sql) => {
            if (/FROM products WHERE id = \?/i.test(sql)) {
                return [[{ id: PRODUCT_ID, name: "Tee", price: 20, stock: 100, image: "" }]];
            }
            return [{ affectedRows: 1 }];
        });

        const lines = await resolveOrderLines({ query }, [{ id: PRODUCT_ID, qty: 2 }]);

        expect(lines[0].variantId).toBe(stockCounter.NO_VARIANT_ID);
    });
});
