/**
 * WebAuthn challenge store (#1385).
 * Redis with in-memory fallback — same pattern as PoW challenges.
 */

"use strict";

const crypto = require("crypto");
const redis = require("../config/redis");

const CHALLENGE_TTL_SEC = Math.max(
    60,
    parseInt(process.env.WEBAUTHN_CHALLENGE_TTL_SEC, 10) || 300
);

const REDIS_TIMEOUT_MS = Math.max(
    50,
    parseInt(process.env.WEBAUTHN_REDIS_TIMEOUT_MS, 10) || 250
);

const KEY_PREFIX = "webauthn:challenge:";
const memoryStore = new Map();

function redisKey(challengeKey) {
    return `${KEY_PREFIX}${challengeKey}`;
}

function makeChallengeKey(type, subject) {
    return `${type}:${subject}`;
}

function withTimeout(promise, ms = REDIS_TIMEOUT_MS) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const t = setTimeout(() => reject(new Error("redis_timeout")), ms);
            if (typeof t.unref === "function") t.unref();
        })
    ]);
}

async function storeChallenge(type, subject, payload, ttlSec = CHALLENGE_TTL_SEC) {
    const challengeKey = makeChallengeKey(type, subject);
    const body = JSON.stringify({
        ...payload,
        type,
        subject,
        storedAt: new Date().toISOString()
    });
    try {
        await withTimeout(redis.setex(redisKey(challengeKey), ttlSec, body));
        return { challengeKey, ttlSec };
    } catch (_) {
        memoryStore.set(challengeKey, {
            payload: JSON.parse(body),
            expiresAt: Date.now() + ttlSec * 1000
        });
        return { challengeKey, ttlSec };
    }
}

async function loadChallenge(type, subject) {
    const challengeKey = makeChallengeKey(type, subject);
    try {
        const raw = await withTimeout(redis.get(redisKey(challengeKey)));
        if (raw) return JSON.parse(raw);
    } catch (_) {
        /* fall through */
    }

    const mem = memoryStore.get(challengeKey);
    if (!mem) return null;
    if (mem.expiresAt <= Date.now()) {
        memoryStore.delete(challengeKey);
        return null;
    }
    return mem.payload;
}

async function consumeChallenge(type, subject) {
    const challengeKey = makeChallengeKey(type, subject);
    try {
        await withTimeout(redis.del(redisKey(challengeKey)));
    } catch (_) {
        /* ignore */
    }
    memoryStore.delete(challengeKey);
}

function newChallengeId() {
    return crypto.randomUUID();
}

module.exports = {
    CHALLENGE_TTL_SEC,
    storeChallenge,
    loadChallenge,
    consumeChallenge,
    makeChallengeKey,
    newChallengeId
};
