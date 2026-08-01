// backend/tests/promo.test.js
//
// Rewritten in #1341.
//
// The previous version of this suite could not pass, and never had:
//
//   1. It stubbed the *export* -- `sinon.stub(promoService, 'getPromoByCode')`
//      -- and then called `promoService.validatePromo()`. In CommonJS,
//      `validatePromo` closes over the module-local `getPromoByCode` binding,
//      not over `module.exports.getPromoByCode`, so the stub was never
//      consulted. Every "mocked" call fell through to a real
//      `SELECT * FROM promo_codes`, and the suite failed with
//      `Access denied for user 'test_user'@'localhost'`.
//
//   2. It stubbed `config/redis`, but `promo.service.js` and
//      `promo.controller.js` each built their own `new Redis({...})` client at
//      module scope. The stubs applied to a client nobody used, while the real
//      ones opened sockets on require and retried forever.
//
// Both are fixed at the source (the modules now share `config/redis`), and this
// suite mocks at the module boundary with `jest.mock`, which is how every
// healthy suite in this repo isolates the database. The behaviours asserted are
// the same ones the original file described.

jest.mock("../config/db", () => ({
    query: jest.fn(),
    withTransaction: jest.fn()
}));

jest.mock("../config/redis", () => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    decr: jest.fn(),
    expire: jest.fn(),
    eval: jest.fn()
}));

const db = require("../config/db");
const redis = require("../config/redis");
const promoService = require("../services/promo.service");

/** A promo row that is valid at the moment the test runs. */
function activePromo(overrides = {}) {
    return {
        code: "TEST100",
        is_active: 1,
        start_date: new Date(Date.now() - 100000),
        expiry_date: new Date(Date.now() + 100000),
        minimum_order_amount: 0,
        discount_type: "percentage",
        discount_value: 10,
        maximum_discount: null,
        usage_limit: null,
        usage_count: 0,
        is_stackable: 1,
        ...overrides
    };
}

/** Make the next `getPromoByCode` resolve to `row` (or nothing). */
function stubPromoRow(row) {
    db.query.mockResolvedValueOnce([row ? [row] : []]);
}

/** A fake pooled connection that records what the transaction did. */
function fakeConnection(rows) {
    return {
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
        query: jest.fn().mockResolvedValue([rows, { affectedRows: 1 }])
    };
}

/**
 * Drive `withTransaction` against `connection`, mirroring what the real helper
 * in config/db does, so the assertions below still describe the begin / commit /
 * rollback / release sequence the service actually causes.
 */
function useTransaction(connection) {
    db.withTransaction.mockImplementation(async (fn) => {
        await connection.beginTransaction();
        try {
            const result = await fn(connection);
            await connection.commit();
            return result;
        } catch (error) {
            try {
                await connection.rollback();
            } catch (_) { /* ignore */ }
            throw error;
        } finally {
            connection.release();
        }
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    // Default: the counter is absent, so callers fall back to usage_count.
    redis.get.mockResolvedValue(null);
    redis.incr.mockResolvedValue(1);
    redis.decr.mockResolvedValue(0);
    redis.expire.mockResolvedValue(1);
    redis.del.mockResolvedValue(1);
});

describe("getPromoByCode", () => {
    it("returns the single matching row", async () => {
        stubPromoRow(activePromo({ code: "WELCOME" }));

        const promo = await promoService.getPromoByCode("WELCOME");

        expect(promo.code).toBe("WELCOME");
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("FROM promo_codes"),
            ["WELCOME"]
        );
    });

    it("returns undefined for a code that does not exist", async () => {
        stubPromoRow(null);
        await expect(promoService.getPromoByCode("NOPE")).resolves.toBeUndefined();
    });
});

describe("validatePromo", () => {
    it("accepts a promo that is active, in window and above the minimum", async () => {
        const promo = activePromo();
        stubPromoRow(promo);

        const result = await promoService.validatePromo("TEST100", 500);

        expect(result.valid).toBe(true);
        expect(result.promo).toEqual(promo);
    });

    it("rejects an unknown code", async () => {
        stubPromoRow(null);

        const result = await promoService.validatePromo("GHOST", 500);

        expect(result.valid).toBe(false);
        expect(result.message).toBe("Invalid promo code");
    });

    it("rejects an inactive promo", async () => {
        stubPromoRow(activePromo({ code: "INACTIVE", is_active: 0 }));

        const result = await promoService.validatePromo("INACTIVE", 500);

        expect(result.valid).toBe(false);
        expect(result.message).toBe("Promo code is inactive");
    });

    it("rejects a promo whose start date is in the future", async () => {
        stubPromoRow(
            activePromo({ code: "EARLY", start_date: new Date(Date.now() + 100000) })
        );

        const result = await promoService.validatePromo("EARLY", 500);

        expect(result.valid).toBe(false);
        expect(result.message).toBe("Promo code is not yet active");
    });

    it("rejects an expired promo", async () => {
        stubPromoRow(
            activePromo({ code: "EXPIRED", expiry_date: new Date(Date.now() - 1000) })
        );

        const result = await promoService.validatePromo("EXPIRED", 500);

        expect(result.valid).toBe(false);
        expect(result.message).toBe("Promo code has expired");
    });

    it("rejects a cart below the promo's minimum order amount", async () => {
        stubPromoRow(activePromo({ minimum_order_amount: 1000 }));

        const result = await promoService.validatePromo("TEST100", 500);

        expect(result.valid).toBe(false);
        expect(result.message).toContain("Minimum order amount");
    });

    it("rejects a promo that has reached its usage limit", async () => {
        stubPromoRow(activePromo({ code: "LIMITED", usage_limit: 1 }));
        redis.get.mockResolvedValueOnce("1");

        const result = await promoService.validatePromo("LIMITED", 500);

        expect(result.valid).toBe(false);
        expect(result.message).toBe("Promo code usage limit has been reached");
    });

    it("accepts a promo that is still below its usage limit", async () => {
        stubPromoRow(activePromo({ code: "LIMITED", usage_limit: 5 }));
        redis.get.mockResolvedValueOnce("4");

        const result = await promoService.validatePromo("LIMITED", 500);

        expect(result.valid).toBe(true);
    });
});

describe("usage counter fallback", () => {
    it("prefers the Redis counter when it is available", async () => {
        const promo = activePromo({ usage_limit: 10, usage_count: 2 });

        await expect(
            (redis.get.mockResolvedValueOnce("7"), promoService.getUsedCount("TEST100", promo))
        ).resolves.toBe(7);
    });

    it("falls back to the stored usage_count when the key is missing", async () => {
        redis.get.mockResolvedValueOnce(null);

        await expect(
            promoService.getUsedCount("TEST100", activePromo({ usage_count: 3 }))
        ).resolves.toBe(3);
    });

    // A cache being down must not take checkout discounts down with it. The
    // rejection used to propagate out of validatePromo(), so every promo code
    // in the store stopped working the moment Redis did.
    it("falls back to the stored usage_count when Redis is unreachable", async () => {
        redis.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

        await expect(
            promoService.getUsedCount("TEST100", activePromo({ usage_count: 4 }))
        ).resolves.toBe(4);
    });

    it("keeps validating promos through a Redis outage", async () => {
        stubPromoRow(activePromo({ usage_limit: 10, usage_count: 1 }));
        redis.get.mockRejectedValueOnce(new Error("Redis connection failed"));

        const result = await promoService.validatePromo("TEST100", 500);

        expect(result.valid).toBe(true);
    });

    it("still enforces the limit from the database during an outage", async () => {
        stubPromoRow(activePromo({ usage_limit: 2, usage_count: 2 }));
        redis.get.mockRejectedValueOnce(new Error("Redis connection failed"));

        const result = await promoService.validatePromo("TEST100", 500);

        expect(result.valid).toBe(false);
        expect(result.message).toBe("Promo code usage limit has been reached");
    });
});

describe("calculateDiscount", () => {
    it("applies a percentage discount", () => {
        expect(
            promoService.calculateDiscount(
                { discount_type: "percentage", discount_value: 20, maximum_discount: null },
                1000
            )
        ).toBe(200);
    });

    it("caps a percentage discount at maximum_discount", () => {
        expect(
            promoService.calculateDiscount(
                { discount_type: "percentage", discount_value: 20, maximum_discount: 100 },
                1000
            )
        ).toBe(100);
    });

    it("applies a fixed discount", () => {
        expect(
            promoService.calculateDiscount({ discount_type: "fixed", discount_value: 50 }, 1000)
        ).toBe(50);
    });

    it("never discounts more than the cart is worth", () => {
        expect(
            promoService.calculateDiscount({ discount_type: "fixed", discount_value: 100 }, 50)
        ).toBe(50);
    });

    it("rounds to two decimal places", () => {
        expect(
            promoService.calculateDiscount(
                { discount_type: "percentage", discount_value: 33.333, maximum_discount: null },
                10
            )
        ).toBe(3.33);
    });
});

describe("applyPromoTransaction", () => {
    it("locks the row, increments the counter, writes the log and commits", async () => {
        const promo = activePromo({ usage_limit: 10 });
        const connection = fakeConnection([promo]);
        useTransaction(connection);

        await expect(
            promoService.applyPromoTransaction("TEST100", "user123", 50)
        ).resolves.toBe(true);

        expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
        expect(connection.query).toHaveBeenCalledWith(
            expect.stringContaining("FOR UPDATE"),
            ["TEST100"]
        );
        expect(redis.incr).toHaveBeenCalledTimes(1);
        expect(connection.query).toHaveBeenCalledWith(
            expect.stringContaining("usage_count = usage_count + 1"),
            ["TEST100"]
        );
        expect(connection.query).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO promo_usage_logs"),
            ["TEST100", "user123", 50]
        );
        expect(connection.commit).toHaveBeenCalledTimes(1);
        expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it("rolls back and releases the connection when the code does not exist", async () => {
        const connection = fakeConnection([]);
        useTransaction(connection);

        await expect(
            promoService.applyPromoTransaction("GHOST", "user123", 50)
        ).rejects.toThrow("not found");

        expect(connection.commit).not.toHaveBeenCalled();
        expect(connection.rollback).toHaveBeenCalledTimes(1);
        expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it("rolls back an expired promo without touching the counter", async () => {
        const connection = fakeConnection([
            activePromo({ expiry_date: new Date(Date.now() - 1000) })
        ]);
        useTransaction(connection);

        await expect(
            promoService.applyPromoTransaction("TEST100", "user123", 50)
        ).rejects.toThrow("has expired");

        expect(redis.incr).not.toHaveBeenCalled();
        expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

    it("gives the counter back when the increment overshoots the limit", async () => {
        const connection = fakeConnection([activePromo({ usage_limit: 1, usage_count: 0 })]);
        useTransaction(connection);
        redis.incr.mockResolvedValueOnce(2);

        await expect(
            promoService.applyPromoTransaction("TEST100", "user123", 50)
        ).rejects.toThrow("usage limit reached");

        expect(redis.decr).toHaveBeenCalledTimes(1);
        expect(connection.rollback).toHaveBeenCalledTimes(1);
        expect(connection.commit).not.toHaveBeenCalled();
    });

    it("releases the connection even when the commit itself fails", async () => {
        const connection = fakeConnection([activePromo()]);
        connection.commit.mockRejectedValueOnce(new Error("deadlock"));
        useTransaction(connection);

        await expect(
            promoService.applyPromoTransaction("TEST100", "user123", 50)
        ).rejects.toThrow("deadlock");

        expect(connection.release).toHaveBeenCalledTimes(1);
    });
});

describe("checkPromoEligibility", () => {
    it("rejects a code that does not exist", async () => {
        stubPromoRow(null);

        await expect(promoService.checkPromoEligibility("GHOST", "u1")).resolves.toEqual({
            eligible: false,
            reason: "Promo code not found"
        });
    });

    it("rejects a user outside an explicit eligibility list", async () => {
        stubPromoRow(activePromo({ user_eligibility: JSON.stringify(["someone-else"]) }));

        const result = await promoService.checkPromoEligibility("TEST100", "u1");

        expect(result.eligible).toBe(false);
        expect(result.reason).toContain("not available for your account");
    });

    it("rejects a user who has hit their per-user limit", async () => {
        stubPromoRow(activePromo({ per_user_limit: 1 }));
        db.query.mockResolvedValueOnce([[{ count: 1 }]]);

        const result = await promoService.checkPromoEligibility("TEST100", "u1");

        expect(result.eligible).toBe(false);
        expect(result.reason).toContain("maximum number of times");
    });

    it("accepts a first-time user", async () => {
        stubPromoRow(activePromo({ per_user_limit: 2 }));
        db.query.mockResolvedValueOnce([[{ count: 0 }]]);

        await expect(
            promoService.checkPromoEligibility("TEST100", "u1")
        ).resolves.toEqual({ eligible: true });
    });

    it("reports a lookup failure rather than throwing at the caller", async () => {
        db.query.mockRejectedValueOnce(new Error("DB connection failed"));

        const result = await promoService.checkPromoEligibility("TEST100", "u1");

        expect(result.eligible).toBe(false);
        expect(result.reason).toBe("Failed to check eligibility");
    });
});

describe("getPromoUsageKey", () => {
    it("namespaces the counter by code", () => {
        expect(promoService.getPromoUsageKey("SAVE20")).toBe("promo:usage:SAVE20");
    });
});

describe("resetPromoUsage", () => {
    it("clears both the counter and the stored count", async () => {
        db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

        await expect(promoService.resetPromoUsage("TEST100")).resolves.toEqual({
            success: true
        });

        expect(redis.del).toHaveBeenCalledWith("promo:usage:TEST100");
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("usage_count = 0"),
            ["TEST100"]
        );
    });

    it("reports failure instead of throwing", async () => {
        db.query.mockRejectedValueOnce(new Error("write failed"));

        const result = await promoService.resetPromoUsage("TEST100");

        expect(result.success).toBe(false);
        expect(result.error).toBe("write failed");
    });
});
