/**
 * Bot-resistant checkout PoW challenge tests (#1396).
 */

jest.mock("../config/redis", () => {
    const store = new Map();
    const hashes = new Map();
    return {
        setex: jest.fn(async (key, _ttl, value) => {
            store.set(key, value);
            return "OK";
        }),
        get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
        del: jest.fn(async (key) => {
            store.delete(key);
            return 1;
        }),
        hincrby: jest.fn(async (key, field, by) => {
            const cur = hashes.get(`${key}:${field}`) || 0;
            hashes.set(`${key}:${field}`, cur + by);
            return cur + by;
        }),
        hgetall: jest.fn(async () => ({})),
        __store: store,
        __reset() {
            store.clear();
            hashes.clear();
        }
    };
});

const redis = require("../config/redis");
const powChallengeService = require("../services/powChallengeService");
const {
    checkoutChallengeMiddleware
} = require("../middleware/checkoutChallengeMiddleware");

beforeEach(() => {
    redis.__reset();
    jest.clearAllMocks();
    powChallengeService._metrics.challenge_issued = 0;
    powChallengeService._metrics.challenge_failed = 0;
    powChallengeService._metrics.challenge_passed = 0;
    powChallengeService._memoryStore.clear();
});

describe("powChallengeService", () => {
    test("issues a challenge bound to the idempotency key", async () => {
        const challenge = await powChallengeService.issueChallenge({
            idempotencyKey: "idem-abc-12345",
            userId: "user-1",
            riskScore: 60,
            riskLevel: "medium"
        });

        expect(challenge.challengeId).toBeTruthy();
        expect(challenge.idempotencyKey).toBe("idem-abc-12345");
        expect(challenge.difficulty).toBeGreaterThanOrEqual(2);
        expect(challenge.prefix).toMatch(/^0+$/);
        expect(powChallengeService._metrics.challenge_issued).toBeGreaterThanOrEqual(1);
    });

    test("verifies a correct PoW solution and binds the idempotency key", async () => {
        const challenge = await powChallengeService.issueChallenge({
            idempotencyKey: "idem-verify-001",
            userId: "user-1",
            riskScore: 55,
            riskLevel: "medium"
        });

        const { nonce } = powChallengeService.solveChallengeSync(
            challenge.challengeId,
            challenge.idempotencyKey,
            challenge.difficulty
        );

        const result = await powChallengeService.verifyChallenge({
            challengeId: challenge.challengeId,
            nonce,
            idempotencyKey: challenge.idempotencyKey,
            userId: "user-1"
        });

        expect(result.success).toBe(true);
        expect(await powChallengeService.isIdempotencyVerified("idem-verify-001")).toBe(true);
        expect(powChallengeService._metrics.challenge_passed).toBeGreaterThanOrEqual(1);
    });

    test("rejects a wrong nonce", async () => {
        const challenge = await powChallengeService.issueChallenge({
            idempotencyKey: "idem-fail-001",
            riskLevel: "medium"
        });

        await expect(
            powChallengeService.verifyChallenge({
                challengeId: challenge.challengeId,
                nonce: "not-a-solution",
                idempotencyKey: challenge.idempotencyKey
            })
        ).rejects.toMatchObject({ code: "CHALLENGE_FAILED" });
    });

    test("rejects idempotency key mismatch", async () => {
        const challenge = await powChallengeService.issueChallenge({
            idempotencyKey: "idem-bound-aaa",
            riskLevel: "medium"
        });
        const { nonce } = powChallengeService.solveChallengeSync(
            challenge.challengeId,
            challenge.idempotencyKey,
            challenge.difficulty
        );

        await expect(
            powChallengeService.verifyChallenge({
                challengeId: challenge.challengeId,
                nonce,
                idempotencyKey: "idem-bound-BBB"
            })
        ).rejects.toMatchObject({ code: "CHALLENGE_KEY_MISMATCH" });
    });

    test("Private Access Token hook marks key verified", async () => {
        process.env.CHECKOUT_PAT_SECRET = "test-pat-secret";
        const crypto = require("crypto");
        const key = "idem-pat-001";
        const token = crypto
            .createHmac("sha256", "test-pat-secret")
            .update(key)
            .digest("hex");

        const result = await powChallengeService.verifyPrivateAccessToken({
            token,
            idempotencyKey: key,
            userId: "user-1"
        });

        expect(result.ok).toBe(true);
        expect(await powChallengeService.isIdempotencyVerified(key)).toBe(true);
        delete process.env.CHECKOUT_PAT_SECRET;
    });
});

describe("checkoutChallengeMiddleware", () => {
    function mockRes() {
        const res = {
            statusCode: 200,
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

    function mockGet(ua = "Mozilla/5.0") {
        return (name) => (/user-agent/i.test(name) ? ua : null);
    }

    test("grace path for low-risk users", async () => {
        const req = {
            body: { paymentMethod: "upi", items: [{ productId: "p1" }] },
            get: mockGet(),
            user: { id: "user-1" }
        };
        const res = mockRes();
        const next = jest.fn();

        await checkoutChallengeMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.checkoutChallenge.grace).toBe(true);
    });

    test("issues challenge for elevated COD risk without proof", async () => {
        const req = {
            body: {
                paymentMethod: "cod",
                items: [{ productId: "p1" }],
                idempotencyKey: "idem-cod-risk-01"
            },
            get: mockGet("python-requests/2.0"),
            user: { id: "user-1" },
            risk: { score: 70, level: "medium" }
        };
        const res = mockRes();
        const next = jest.fn();

        await checkoutChallengeMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe("CHALLENGE_REQUIRED");
        expect(res.body.challenge.challengeId).toBeTruthy();
        expect(res.body.challenge.idempotencyKey).toBe("idem-cod-risk-01");
    });

    test("passes when PoW solution is provided", async () => {
        const idempotencyKey = "idem-ok-pass-01";

        // First pass: middleware issues a challenge
        const req1 = {
            body: {
                paymentMethod: "cod",
                items: [{ productId: "p1" }],
                idempotencyKey
            },
            get: mockGet("python-requests/2.0"),
            user: { id: "user-1" },
            risk: { score: 80, level: "high" }
        };
        const res1 = mockRes();
        await checkoutChallengeMiddleware(req1, res1, jest.fn());
        expect(res1.body.code).toBe("CHALLENGE_REQUIRED");

        const challenge = res1.body.challenge;
        const { nonce } = powChallengeService.solveChallengeSync(
            challenge.challengeId,
            challenge.idempotencyKey,
            challenge.difficulty
        );

        const req2 = {
            body: {
                paymentMethod: "cod",
                items: [{ productId: "p1" }],
                idempotencyKey,
                challengeId: challenge.challengeId,
                challengeNonce: nonce
            },
            get: mockGet("python-requests/2.0"),
            user: { id: "user-1" },
            risk: { score: 80, level: "high" }
        };
        const res2 = mockRes();
        const next = jest.fn();

        await checkoutChallengeMiddleware(req2, res2, next);

        expect(res2.body).toBeNull();
        expect(next).toHaveBeenCalled();
        expect(req2.checkoutChallenge.verified).toBe(true);
    });
});
