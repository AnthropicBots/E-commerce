/**
 * Feature flags — percentage rollouts, allowlists, kill switches (#1390).
 */

jest.mock("../config/db", () => ({
    query: jest.fn(async () => [[]])
}));

jest.mock("../config/redis", () => {
    const store = new Map();
    const sets = new Map();
    return {
        get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
        setex: jest.fn(async (key, _ttl, value) => {
            store.set(key, value);
            return "OK";
        }),
        del: jest.fn(async (...keys) => {
            let n = 0;
            for (const k of keys) {
                if (store.delete(k)) n += 1;
            }
            return n;
        }),
        keys: jest.fn(async (pattern) => {
            const prefix = pattern.replace(/\*$/, "");
            return [...store.keys()].filter((k) => k.startsWith(prefix));
        }),
        sadd: jest.fn(async (key, member) => {
            const set = sets.get(key) || new Set();
            set.add(member);
            sets.set(key, set);
            return 1;
        }),
        __store: store,
        __reset() {
            store.clear();
            sets.clear();
        }
    };
});

jest.mock("../utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const db = require("../config/db");
const redis = require("../config/redis");
const {
    FeatureFlagService,
    FLAG_TYPES,
    FLAG_STATUS
} = require("../services/featureFlagService");

describe("featureFlagService (#1390)", () => {
    let service;

    beforeEach(() => {
        jest.clearAllMocks();
        redis.__reset();
        db.query.mockResolvedValue([[]]);
        service = new FeatureFlagService();
        service.initialized = true;
        service.flags.set(
            "new_checkout",
            service.normalizeFlag({
                key: "new_checkout",
                name: "New Checkout",
                type: FLAG_TYPES.PERCENTAGE,
                status: FLAG_STATUS.ACTIVE,
                rolloutPercentage: 50,
                value: { enabled: true },
                allowlist: [],
                killSwitch: false
            })
        );
        service.flags.set(
            "ai_widgets",
            service.normalizeFlag({
                key: "ai_widgets",
                name: "AI Widgets",
                type: FLAG_TYPES.BOOLEAN,
                status: FLAG_STATUS.ACTIVE,
                value: { enabled: true },
                rolloutPercentage: 0,
                allowlist: [],
                killSwitch: false
            })
        );
    });

    test("userBucket is sticky for the same userId + flag", () => {
        const a = service.userBucket("user-42", "new_checkout");
        const b = service.userBucket("user-42", "new_checkout");
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(100);
    });

    test("percentage rollout uses userId hash bucket", async () => {
        service.flags.get("new_checkout").rolloutPercentage = 100;
        const allOn = await service.evaluateFlag("new_checkout", {
            userId: "anyone"
        });
        expect(allOn.enabled).toBe(true);

        service.flags.get("new_checkout").rolloutPercentage = 0;
        service.memoryCache.clear();
        redis.__reset();
        const allOff = await service.evaluateFlag("new_checkout", {
            userId: "anyone"
        });
        expect(allOff.enabled).toBe(false);
    });

    test("allowlist forces enable even at 0% rollout", async () => {
        const flag = service.flags.get("new_checkout");
        flag.rolloutPercentage = 0;
        flag.allowlist = ["vip-user"];
        const denied = await service.evaluateFlag("new_checkout", {
            userId: "other"
        });
        expect(denied.enabled).toBe(false);

        service.memoryCache.clear();
        redis.__reset();
        const allowed = await service.evaluateFlag("new_checkout", {
            userId: "vip-user"
        });
        expect(allowed.enabled).toBe(true);
        expect(allowed.reason).toMatch(/allowlist/i);
    });

    test("kill switch disables immediately and clears caches", async () => {
        await service.cacheEval("new_checkout:u1:test", { enabled: true });
        const killed = await service.killSwitch("new_checkout", {
            reason: "incident",
            actor: { id: "admin-1", email: "a@test.com" }
        });
        expect(killed.killSwitch).toBe(true);
        expect(killed.status).toBe(FLAG_STATUS.KILLED);

        const result = await service.evaluateFlag("new_checkout", {
            userId: "u1"
        });
        expect(result.enabled).toBe(false);
        expect(result.reason).toMatch(/kill/i);
        expect(service.getAuditLog(5).some((e) => e.action === "kill")).toBe(
            true
        );
    });

    test("boolean flag respects value.enabled", async () => {
        const on = await service.evaluateFlag("ai_widgets", { userId: "x" });
        expect(on.enabled).toBe(true);

        await service.updateFlag("ai_widgets", {
            value: { enabled: false }
        });
        service.memoryCache.clear();
        redis.__reset();
        const off = await service.evaluateFlag("ai_widgets", { userId: "x" });
        expect(off.enabled).toBe(false);
    });

    test("bootstrap returns a key→boolean map", async () => {
        const payload = await service.bootstrap({ userId: "boot-user" });
        expect(payload.flags).toHaveProperty("new_checkout");
        expect(payload.flags).toHaveProperty("ai_widgets");
        expect(typeof payload.flags.ai_widgets).toBe("boolean");
        expect(payload.ttlSec).toBeGreaterThan(0);
    });

    test("createFlag writes audit and rejects duplicates", async () => {
        const created = await service.createFlag(
            {
                name: "Beta Banner",
                key: "beta_banner",
                type: FLAG_TYPES.BOOLEAN,
                value: { enabled: true },
                status: FLAG_STATUS.ACTIVE
            },
            { id: "admin-1" }
        );
        expect(created.key).toBe("beta_banner");
        await expect(
            service.createFlag({ name: "Beta Banner", key: "beta_banner" })
        ).rejects.toMatchObject({ code: "FLAG_EXISTS" });
        expect(service.getAuditLog(10)[0].action).toBe("create");
    });

    test("Redis caches evaluation results with short TTL", async () => {
        await service.evaluateFlag("ai_widgets", { userId: "cache-me" });
        expect(redis.setex).toHaveBeenCalled();
        const keyArg = redis.setex.mock.calls[0][0];
        expect(keyArg).toContain("ff:eval:");
        expect(redis.setex.mock.calls[0][1]).toBe(service.cacheTTL);
    });
});
