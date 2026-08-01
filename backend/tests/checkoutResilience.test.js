/**
 * Checkout resilience / chaos harness tests (#1398).
 *
 * Covers:
 *  - Chaos disabled unless CHAOS_ENABLED=true (and never in production)
 *  - Payment 500 injection → stable user-facing error envelope
 *  - Redis down → graceful degradation (no hard checkout crash)
 *  - chargeWithLockRelease releases inventory locks on payment failure
 */

const ORIGINAL_ENV = { ...process.env };

function resetChaosEnv() {
    delete process.env.CHAOS_ENABLED;
    delete process.env.CHAOS_PAYMENT;
    delete process.env.CHAOS_REDIS;
    delete process.env.CHAOS_DB;
    delete process.env.CHAOS_LATENCY_MS;
    delete process.env.CHAOS_ERROR_RATE;
    delete process.env.CHAOS_FORCE_STATUS;
    process.env.NODE_ENV = "test";
}

afterEach(() => {
    resetChaosEnv();
    for (const key of Object.keys(process.env)) {
        if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock("stripe");
});

beforeEach(() => {
    resetChaosEnv();
});

describe("chaosProxy safety gates", () => {
    test("is disabled by default", () => {
        const chaos = require("../services/chaosProxy");
        expect(chaos.isChaosEnabled()).toBe(false);
        expect(chaos.isDependencyChaosEnabled("payment")).toBe(false);
    });

    test("stays disabled in production even when CHAOS_ENABLED=true", () => {
        process.env.NODE_ENV = "production";
        process.env.CHAOS_ENABLED = "true";
        process.env.CHAOS_PAYMENT = "true";
        jest.resetModules();
        const chaos = require("../services/chaosProxy");
        expect(chaos.isChaosEnabled()).toBe(false);
        expect(chaos.isDependencyChaosEnabled("payment")).toBe(false);
    });

    test("enables per-dependency flags only when master switch is on", () => {
        process.env.CHAOS_ENABLED = "true";
        process.env.CHAOS_PAYMENT = "true";
        jest.resetModules();
        const chaos = require("../services/chaosProxy");
        expect(chaos.isChaosEnabled()).toBe(true);
        expect(chaos.isDependencyChaosEnabled("payment")).toBe(true);
        expect(chaos.isDependencyChaosEnabled("redis")).toBe(false);
    });
});

describe("payment chaos (500)", () => {
    test("withPaymentChaos returns a user-visible error envelope", async () => {
        process.env.CHAOS_ENABLED = "true";
        process.env.CHAOS_PAYMENT = "true";
        jest.resetModules();
        const chaos = require("../services/chaosProxy");

        const result = await chaos.withPaymentChaos(async () => ({
            success: true,
            clientSecret: "should-not-reach"
        }), { retries: 0 });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/payment service temporarily unavailable/i);
        expect(result.code).toBe("CHAOS_INJECTED");
        expect(result.status).toBe(500);
    });

    test("createPaymentIntent surfaces chaos failure without calling Stripe", async () => {
        process.env.CHAOS_ENABLED = "true";
        process.env.CHAOS_PAYMENT = "true";
        process.env.STRIPE_SECRET_KEY =
            process.env.STRIPE_SECRET_KEY || "sk_test_00000000000000000000000000";

        const mockCreate = jest.fn(async () => ({
            id: "pi_should_not_run",
            client_secret: "cs_x"
        }));
        jest.resetModules();
        jest.doMock("stripe", () => jest.fn(() => ({
            paymentIntents: { create: mockCreate },
            webhooks: { constructEvent: jest.fn() }
        })));

        const { createPaymentIntent } = require("../services/payment.service");
        const result = await createPaymentIntent(100, "INR", { orderId: "o1" });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/payment service temporarily unavailable/i);
        expect(mockCreate).not.toHaveBeenCalled();
    });
});

describe("Redis down — graceful degradation", () => {
    test("withRedisChaos returns fallback instead of throwing", async () => {
        process.env.CHAOS_ENABLED = "true";
        process.env.CHAOS_REDIS = "true";
        jest.resetModules();
        const chaos = require("../services/chaosProxy");

        const fallback = { ok: true, degraded: true };
        const result = await chaos.withRedisChaos(
            async () => {
                throw new Error("should be replaced by chaos");
            },
            { fallback }
        );

        expect(result).toEqual(fallback);
    });

    test("withRedisChaos can use a fallback factory", async () => {
        process.env.CHAOS_ENABLED = "true";
        process.env.CHAOS_REDIS = "true";
        jest.resetModules();
        const chaos = require("../services/chaosProxy");

        const result = await chaos.withRedisChaos(
            async () => ({ ok: true }),
            {
                fallback: (err) => ({
                    ok: false,
                    degraded: true,
                    reason: err.code
                })
            }
        );

        expect(result.degraded).toBe(true);
        expect(result.reason).toBe("CHAOS_INJECTED");
    });
});

describe("inventory locks release on payment chaos fail", () => {
    test("chargeWithLockRelease rolls back and releases locks when payment fails", async () => {
        process.env.CHAOS_ENABLED = "true";
        process.env.CHAOS_PAYMENT = "true";
        jest.resetModules();
        const chaos = require("../services/chaosProxy");

        const rollback = jest.fn(async () => {});
        const releaseLocks = jest.fn(async () => {});

        const result = await chaos.chargeWithLockRelease({
            charge: () =>
                chaos.withPaymentChaos(
                    async () => ({
                        success: true,
                        paymentIntentId: "pi_x"
                    }),
                    { retries: 0 }
                ),
            rollback,
            releaseLocks
        });

        expect(result.success).toBe(false);
        expect(result.locksReleased).toBe(true);
        expect(rollback).toHaveBeenCalledTimes(1);
        expect(releaseLocks).toHaveBeenCalledTimes(1);
    });

    test("chargeWithLockRelease does not release locks on success", async () => {
        resetChaosEnv();
        jest.resetModules();
        const chaos = require("../services/chaosProxy");

        const rollback = jest.fn(async () => {});
        const releaseLocks = jest.fn(async () => {});

        const result = await chaos.chargeWithLockRelease({
            charge: async () => ({
                success: true,
                paymentIntentId: "pi_ok",
                clientSecret: "cs_ok"
            }),
            rollback,
            releaseLocks
        });

        expect(result.success).toBe(true);
        expect(result.locksReleased).toBe(false);
        expect(rollback).not.toHaveBeenCalled();
        expect(releaseLocks).not.toHaveBeenCalled();
    });

    test("no stock corruption path: failed charge never reports success", async () => {
        process.env.CHAOS_ENABLED = "true";
        process.env.CHAOS_PAYMENT = "true";
        jest.resetModules();
        const chaos = require("../services/chaosProxy");

        const stock = { reserved: 2, committed: 0 };
        const result = await chaos.chargeWithLockRelease({
            charge: () =>
                chaos.withPaymentChaos(
                    async () => {
                        stock.committed += 2;
                        return { success: true, paymentIntentId: "pi_x" };
                    },
                    { retries: 0 }
                ),
            rollback: async () => {
                stock.committed = 0;
            },
            releaseLocks: async () => {
                stock.reserved = 0;
            }
        });

        expect(result.success).toBe(false);
        expect(stock.committed).toBe(0);
        expect(stock.reserved).toBe(0);
    });
});

describe("resilience policy documentation", () => {
    test("exposes timeout/retry policy for payment, redis, and db", () => {
        const chaos = require("../services/chaosProxy");
        expect(chaos.RESILIENCE_POLICY.payment.timeoutMs).toBe(8000);
        expect(chaos.RESILIENCE_POLICY.payment.retries).toBe(2);
        expect(chaos.RESILIENCE_POLICY.redis.degrade).toBe(true);
        expect(chaos.RESILIENCE_POLICY.db.timeoutMs).toBe(5000);
    });
});

describe("envValidator chaos keys", () => {
    test("documents CHAOS_* optional vars and forces them off in production", () => {
        const { ENV_CONFIG } = require("../config/envValidator");
        const names = ENV_CONFIG.optional.map((c) => c.name);
        expect(names).toEqual(
            expect.arrayContaining([
                "CHAOS_ENABLED",
                "CHAOS_PAYMENT",
                "CHAOS_REDIS",
                "CHAOS_DB",
                "CHAOS_LATENCY_MS",
                "CHAOS_ERROR_RATE",
                "CHAOS_FORCE_STATUS"
            ])
        );
    });

    test("validateEnv force-disables chaos under NODE_ENV=production", () => {
        process.env.NODE_ENV = "production";
        process.env.CHAOS_ENABLED = "true";
        process.env.CHAOS_PAYMENT = "true";
        process.env.DB_HOST = "localhost";
        process.env.DB_PORT = "3306";
        process.env.DB_USER = "u";
        process.env.DB_PASSWORD = "p";
        process.env.DB_NAME = "ecommerce";
        process.env.JWT_SECRET = "test_jwt_secret_at_least_32_characters_long";
        process.env.JWT_REFRESH_SECRET = "test_jwt_refresh_secret_at_least_32_characters_long";
        process.env.PORT = "5000";
        process.env.FRONTEND_URL = "http://localhost:5500";

        jest.resetModules();
        const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
        const { validateEnv } = require("../config/envValidator");
        validateEnv();
        expect(process.env.CHAOS_ENABLED).toBe("false");
        expect(process.env.CHAOS_PAYMENT).toBe("false");
        exitSpy.mockRestore();
    });
});
