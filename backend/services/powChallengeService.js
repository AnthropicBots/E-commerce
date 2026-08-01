/**
 * Proof-of-Work checkout challenge service (#1396).
 *
 * Issues a lightweight SHA-256 PoW puzzle bound to a checkout idempotency key,
 * stores it in Redis (in-memory fallback), and verifies the solution once.
 *
 * Also exposes a Private Access Token / CAPTCHA hook so low-friction
 * attestation can satisfy the same gate without solving PoW.
 *
 * Metrics (process-local, also mirrored to Redis counters when available):
 *   challenge_issued | challenge_failed | challenge_passed
 */

"use strict";

const crypto = require("crypto");
const redis = require("../config/redis");

const CHALLENGE_TTL_SEC = Math.max(
    30,
    parseInt(process.env.CHECKOUT_POW_TTL_SEC, 10) || 120
);
const DEFAULT_DIFFICULTY = Math.min(
    6,
    Math.max(2, parseInt(process.env.CHECKOUT_POW_DIFFICULTY, 10) || 3)
);
const ELEVATED_DIFFICULTY = Math.min(
    7,
    Math.max(DEFAULT_DIFFICULTY, parseInt(process.env.CHECKOUT_POW_DIFFICULTY_HIGH, 10) || 4)
);

const KEY_PREFIX = "checkout:pow:";
const VERIFIED_PREFIX = "checkout:pow:ok:";
const METRICS_KEY = "checkout:pow:metrics";

const memoryStore = new Map();
const memoryVerified = new Map();

const metrics = {
    challenge_issued: 0,
    challenge_failed: 0,
    challenge_passed: 0
};

function redisKey(challengeId) {
    return `${KEY_PREFIX}${challengeId}`;
}

function verifiedKey(idempotencyKey) {
    return `${VERIFIED_PREFIX}${idempotencyKey}`;
}

function bumpMetric(name) {
    if (metrics[name] === undefined) return;
    metrics[name] += 1;
    // Best-effort Redis mirror — never fail the request path.
    redis
        .hincrby(METRICS_KEY, name, 1)
        .catch(() => {});
}

function hashProof(challengeId, idempotencyKey, nonce) {
    return crypto
        .createHash("sha256")
        .update(`${challengeId}:${idempotencyKey}:${nonce}`)
        .digest("hex");
}

function meetsDifficulty(digestHex, difficulty) {
    const prefix = "0".repeat(difficulty);
    return digestHex.startsWith(prefix);
}

async function storeChallenge(challengeId, payload, ttlSec) {
    const body = JSON.stringify(payload);
    try {
        await redis.setex(redisKey(challengeId), ttlSec, body);
        return;
    } catch (_) {
        memoryStore.set(challengeId, {
            payload,
            expiresAt: Date.now() + ttlSec * 1000
        });
    }
}

async function loadChallenge(challengeId) {
    try {
        const raw = await redis.get(redisKey(challengeId));
        if (raw) return JSON.parse(raw);
    } catch (_) { /* fall through */ }

    const mem = memoryStore.get(challengeId);
    if (!mem) return null;
    if (mem.expiresAt <= Date.now()) {
        memoryStore.delete(challengeId);
        return null;
    }
    return mem.payload;
}

async function consumeChallenge(challengeId) {
    try {
        await redis.del(redisKey(challengeId));
    } catch (_) { /* ignore */ }
    memoryStore.delete(challengeId);
}

async function markVerified(idempotencyKey, meta, ttlSec) {
    const body = JSON.stringify({
        ...meta,
        verifiedAt: new Date().toISOString()
    });
    try {
        await redis.setex(verifiedKey(idempotencyKey), ttlSec, body);
        return;
    } catch (_) {
        memoryVerified.set(idempotencyKey, {
            payload: JSON.parse(body),
            expiresAt: Date.now() + ttlSec * 1000
        });
    }
}

async function isIdempotencyVerified(idempotencyKey) {
    if (!idempotencyKey) return false;
    try {
        const raw = await redis.get(verifiedKey(idempotencyKey));
        if (raw) return true;
    } catch (_) { /* fall through */ }

    const mem = memoryVerified.get(idempotencyKey);
    if (!mem) return false;
    if (mem.expiresAt <= Date.now()) {
        memoryVerified.delete(idempotencyKey);
        return false;
    }
    return true;
}

/**
 * Issue a PoW challenge bound to the checkout idempotency key.
 *
 * @param {object} opts
 * @param {string} opts.idempotencyKey
 * @param {string} [opts.userId]
 * @param {number} [opts.riskScore]
 * @param {string} [opts.riskLevel]
 */
async function issueChallenge({
    idempotencyKey,
    userId = null,
    riskScore = 0,
    riskLevel = "medium"
} = {}) {
    if (!idempotencyKey || String(idempotencyKey).length < 8) {
        const err = new Error("idempotencyKey is required (min 8 chars)");
        err.status = 400;
        err.code = "IDEMPOTENCY_KEY_REQUIRED";
        throw err;
    }

    const difficulty =
        riskLevel === "high" || riskLevel === "critical" || riskScore >= 75
            ? ELEVATED_DIFFICULTY
            : DEFAULT_DIFFICULTY;

    const challengeId = crypto.randomUUID();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + CHALLENGE_TTL_SEC * 1000;

    const payload = {
        challengeId,
        idempotencyKey: String(idempotencyKey),
        userId,
        difficulty,
        algorithm: "sha256",
        // Client must find nonce where hash(challengeId:idempotencyKey:nonce)
        // starts with `difficulty` hex zeros.
        prefix: "0".repeat(difficulty),
        riskScore,
        riskLevel,
        issuedAt,
        expiresAt
    };

    await storeChallenge(challengeId, payload, CHALLENGE_TTL_SEC);
    bumpMetric("challenge_issued");

    return {
        challengeId,
        idempotencyKey: payload.idempotencyKey,
        difficulty,
        algorithm: payload.algorithm,
        prefix: payload.prefix,
        expiresAt: new Date(expiresAt).toISOString(),
        ttlSec: CHALLENGE_TTL_SEC,
        // Hint for the vanilla JS solver.
        puzzle: `${challengeId}:${payload.idempotencyKey}:<nonce>`
    };
}

/**
 * Verify a PoW solution and bind success to the idempotency key (one-shot).
 */
async function verifyChallenge({
    challengeId,
    nonce,
    idempotencyKey,
    userId = null
} = {}) {
    if (!challengeId || nonce === undefined || nonce === null || nonce === "") {
        bumpMetric("challenge_failed");
        const err = new Error("challengeId and nonce are required");
        err.status = 400;
        err.code = "CHALLENGE_INVALID";
        throw err;
    }

    const stored = await loadChallenge(challengeId);
    if (!stored) {
        bumpMetric("challenge_failed");
        const err = new Error("Challenge not found or expired");
        err.status = 410;
        err.code = "CHALLENGE_EXPIRED";
        throw err;
    }

    if (
        idempotencyKey &&
        stored.idempotencyKey !== String(idempotencyKey)
    ) {
        bumpMetric("challenge_failed");
        const err = new Error("Challenge is not bound to this idempotency key");
        err.status = 403;
        err.code = "CHALLENGE_KEY_MISMATCH";
        throw err;
    }

    if (userId && stored.userId && stored.userId !== userId) {
        bumpMetric("challenge_failed");
        const err = new Error("Challenge belongs to another user");
        err.status = 403;
        err.code = "CHALLENGE_USER_MISMATCH";
        throw err;
    }

    if (stored.expiresAt && stored.expiresAt < Date.now()) {
        await consumeChallenge(challengeId);
        bumpMetric("challenge_failed");
        const err = new Error("Challenge expired");
        err.status = 410;
        err.code = "CHALLENGE_EXPIRED";
        throw err;
    }

    const digest = hashProof(stored.challengeId, stored.idempotencyKey, String(nonce));
    if (!meetsDifficulty(digest, stored.difficulty)) {
        bumpMetric("challenge_failed");
        const err = new Error("Invalid proof-of-work solution");
        err.status = 400;
        err.code = "CHALLENGE_FAILED";
        throw err;
    }

    await consumeChallenge(challengeId);
    await markVerified(stored.idempotencyKey, {
        challengeId,
        method: "pow",
        userId: userId || stored.userId || null
    }, CHALLENGE_TTL_SEC);

    bumpMetric("challenge_passed");

    return {
        success: true,
        idempotencyKey: stored.idempotencyKey,
        challengeId,
        method: "pow",
        digest
    };
}

/**
 * Private Access Token / CAPTCHA hook.
 *
 * Accepts either:
 *  - a shared HMAC token: HMAC_SHA256(CHECKOUT_PAT_SECRET, idempotencyKey)
 *  - or a pre-issued opaque token listed in CHECKOUT_PAT_TOKENS (comma-separated)
 *
 * This is intentionally a hook surface for Apple PAT / Turnstile / etc.
 */
async function verifyPrivateAccessToken({
    token,
    idempotencyKey,
    userId = null
} = {}) {
    if (!token || !idempotencyKey) {
        return { ok: false, reason: "missing_token" };
    }

    const secret = process.env.CHECKOUT_PAT_SECRET || "";
    const allowList = (process.env.CHECKOUT_PAT_TOKENS || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

    let accepted = false;
    let method = "pat";

    if (secret) {
        const expected = crypto
            .createHmac("sha256", secret)
            .update(String(idempotencyKey))
            .digest("hex");
        const provided = String(token);
        if (expected.length === provided.length) {
            try {
                accepted = crypto.timingSafeEqual(
                    Buffer.from(expected),
                    Buffer.from(provided)
                );
            } catch (_) {
                accepted = false;
            }
        }
        method = "pat_hmac";
    }

    if (!accepted && allowList.includes(String(token))) {
        accepted = true;
        method = "pat_allowlist";
    }

    // Optional behavioral captcha bridge
    if (!accepted && process.env.ENABLE_BEHAVIORAL_CAPTCHA === "true") {
        try {
            const { verifyHumanChallenge } = require("../middleware/behavioralCaptcha");
            const result = verifyHumanChallenge({
                headers: { "x-captcha-token": token },
                body: { captchaToken: token },
                ip: "0.0.0.0"
            });
            if (result && result.passed) {
                accepted = true;
                method = "captcha";
            }
        } catch (_) { /* captcha module optional */ }
    }

    if (!accepted) {
        bumpMetric("challenge_failed");
        return { ok: false, reason: "invalid_token" };
    }

    await markVerified(String(idempotencyKey), {
        method,
        userId
    }, CHALLENGE_TTL_SEC);
    bumpMetric("challenge_passed");

    return { ok: true, method, idempotencyKey: String(idempotencyKey) };
}

async function getMetrics() {
    let redisMetrics = null;
    try {
        redisMetrics = await redis.hgetall(METRICS_KEY);
    } catch (_) { /* ignore */ }

    return {
        local: { ...metrics },
        redis: redisMetrics || null,
        config: {
            ttlSec: CHALLENGE_TTL_SEC,
            difficulty: DEFAULT_DIFFICULTY,
            elevatedDifficulty: ELEVATED_DIFFICULTY
        }
    };
}

/** Test helper: solve a challenge on the server (not for production clients). */
function solveChallengeSync(challengeId, idempotencyKey, difficulty) {
    let nonce = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const digest = hashProof(challengeId, idempotencyKey, String(nonce));
        if (meetsDifficulty(digest, difficulty)) {
            return { nonce: String(nonce), digest };
        }
        nonce += 1;
        if (nonce > 5_000_000) {
            throw new Error("PoW solve exceeded safety limit");
        }
    }
}

module.exports = {
    issueChallenge,
    verifyChallenge,
    verifyPrivateAccessToken,
    isIdempotencyVerified,
    getMetrics,
    hashProof,
    meetsDifficulty,
    solveChallengeSync,
    DEFAULT_DIFFICULTY,
    ELEVATED_DIFFICULTY,
    CHALLENGE_TTL_SEC,
    // test seam
    _metrics: metrics,
    _memoryStore: memoryStore
};
