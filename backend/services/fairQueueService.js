/**
 * Stock Reservation Fairness Queue (#1384).
 *
 * Per-SKU Redis ZSET virtual queue: issue wait tokens, admit N users/sec to
 * reservation, expire abandoned slots, light priority for verified accounts.
 * In-memory fallback when Redis is unavailable (tests / local).
 */

"use strict";

const crypto = require("crypto");
const redis = require("../config/redis");

const ENABLED = String(process.env.FAIR_QUEUE_ENABLED || "true").toLowerCase() !== "false";
const ENFORCE = String(process.env.FAIR_QUEUE_ENFORCE || "true").toLowerCase() !== "false";
const FORCE_ALL = String(process.env.FAIR_QUEUE_ALL || "false").toLowerCase() === "true";

const ADMIT_PER_SEC = Math.max(1, parseInt(process.env.FAIR_QUEUE_ADMIT_PER_SEC, 10) || 5);
const MAX_QUEUE_LENGTH = Math.max(10, parseInt(process.env.FAIR_QUEUE_MAX_LENGTH, 10) || 500);
const SLOT_TTL_SEC = Math.max(30, parseInt(process.env.FAIR_QUEUE_SLOT_TTL_SEC, 10) || 180);
const ADMIT_TTL_SEC = Math.max(15, parseInt(process.env.FAIR_QUEUE_ADMIT_TTL_SEC, 10) || 45);
const VERIFIED_BONUS_MS = Math.max(0, parseInt(process.env.FAIR_QUEUE_VERIFIED_BONUS_MS, 10) || 3000);
const REDIS_TIMEOUT_MS = Math.max(50, parseInt(process.env.FAIR_QUEUE_REDIS_TIMEOUT_MS, 10) || 250);
const TOKEN_SECRET =
    process.env.FAIR_QUEUE_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    "fair-queue-dev-secret";

const PREFIX = "fairq:";

/** @type {Map<string, any>} */
const memory = new Map();

function withTimeout(promise, ms = REDIS_TIMEOUT_MS) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const t = setTimeout(() => reject(new Error("redis_timeout")), ms);
            if (typeof t.unref === "function") t.unref();
        })
    ]);
}

function zKey(productId) {
    return `${PREFIX}z:${productId}`;
}
function metaKey(productId, userId) {
    return `${PREFIX}meta:${productId}:${userId}`;
}
function admitKey(productId, userId) {
    return `${PREFIX}admit:${productId}:${userId}`;
}
function rateKey(productId, second) {
    return `${PREFIX}rate:${productId}:${second}`;
}
function activeKey(productId) {
    return `${PREFIX}active:${productId}`;
}
function tokenIndexKey(token) {
    return `${PREFIX}tok:${token}`;
}

function signToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
    return `${body}.${sig}`;
}

function verifySignedToken(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
    const a = Buffer.from(sig || "");
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch (_) {
        return null;
    }
}

function memGet(key) {
    const row = memory.get(key);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt <= Date.now()) {
        memory.delete(key);
        return null;
    }
    return row.value;
}

function memSet(key, value, ttlSec) {
    memory.set(key, {
        value,
        expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : null
    });
}

function memDel(key) {
    memory.delete(key);
}

async function redisSet(key, value, ttlSec) {
    const body = typeof value === "string" ? value : JSON.stringify(value);
    try {
        if (ttlSec) {
            await withTimeout(redis.setex(key, ttlSec, body));
        } else {
            await withTimeout(redis.set(key, body));
        }
        return true;
    } catch (_) {
        memSet(key, typeof value === "string" ? value : value, ttlSec);
        return false;
    }
}

async function redisGet(key) {
    try {
        const raw = await withTimeout(redis.get(key));
        if (raw != null) return raw;
    } catch (_) {
        /* fall through */
    }
    const mem = memGet(key);
    return mem == null ? null : typeof mem === "string" ? mem : JSON.stringify(mem);
}

async function redisDel(...keys) {
    try {
        if (keys.length) await withTimeout(redis.del(...keys));
    } catch (_) {
        /* ignore */
    }
    keys.forEach(memDel);
}

/** In-memory ZSET: Map productId -> Array<{member, score}> */
const memZ = new Map();

function memZAdd(productId, member, score) {
    let arr = memZ.get(productId);
    if (!arr) {
        arr = [];
        memZ.set(productId, arr);
    }
    const idx = arr.findIndex((e) => e.member === member);
    if (idx >= 0) arr[idx].score = score;
    else arr.push({ member, score });
    arr.sort((a, b) => a.score - b.score);
}

function memZRem(productId, member) {
    const arr = memZ.get(productId);
    if (!arr) return;
    const next = arr.filter((e) => e.member !== member);
    if (next.length) memZ.set(productId, next);
    else memZ.delete(productId);
}

function memZCard(productId) {
    return memZ.get(productId)?.length || 0;
}

function memZRank(productId, member) {
    const arr = memZ.get(productId) || [];
    const i = arr.findIndex((e) => e.member === member);
    return i >= 0 ? i : null;
}

function memZRange(productId, start, stop) {
    const arr = memZ.get(productId) || [];
    return arr.slice(start, stop + 1).map((e) => e.member);
}

function memZRemRangeByScore(productId, maxScore) {
    const arr = memZ.get(productId) || [];
    const next = arr.filter((e) => e.score > maxScore);
    if (next.length) memZ.set(productId, next);
    else memZ.delete(productId);
    return arr.length - next.length;
}

async function zadd(productId, score, member) {
    try {
        await withTimeout(redis.zadd(zKey(productId), score, member));
        return;
    } catch (_) {
        memZAdd(productId, member, score);
    }
}

async function zrem(productId, member) {
    try {
        await withTimeout(redis.zrem(zKey(productId), member));
    } catch (_) {
        /* ignore */
    }
    memZRem(productId, member);
}

async function zcard(productId) {
    try {
        const n = await withTimeout(redis.zcard(zKey(productId)));
        if (typeof n === "number" && (n > 0 || memZCard(productId) === 0)) return n;
    } catch (_) {
        /* fall through */
    }
    return memZCard(productId);
}

async function zrank(productId, member) {
    try {
        const r = await withTimeout(redis.zrank(zKey(productId), member));
        if (r !== null && r !== undefined) return Number(r);
        // Redis miss — may still be in memory fallback
    } catch (_) {
        /* fall through */
    }
    return memZRank(productId, member);
}

async function zrange(productId, start, stop) {
    try {
        const rows = await withTimeout(redis.zrange(zKey(productId), start, stop));
        if (Array.isArray(rows) && (rows.length > 0 || memZCard(productId) === 0)) {
            return rows;
        }
    } catch (_) {
        /* fall through */
    }
    return memZRange(productId, start, stop);
}

async function expireAbandoned(productId) {
    const cutoff = Date.now() - SLOT_TTL_SEC * 1000;
    try {
        await withTimeout(redis.zremrangebyscore(zKey(productId), "-inf", cutoff));
    } catch (_) {
        memZRemRangeByScore(productId, cutoff);
    }
}

async function isQueueActive(productId) {
    if (!ENABLED) return false;
    if (FORCE_ALL) return true;
    const raw = await redisGet(activeKey(productId));
    return raw === "1" || raw === 1 || raw === true;
}

async function setQueueActive(productId, active) {
    if (active) {
        await redisSet(activeKey(productId), "1", 86400 * 7);
    } else {
        await redisDel(activeKey(productId));
    }
    return isQueueActive(productId);
}

function etaSeconds(position) {
    if (position == null || position < 0) return 0;
    return Math.ceil((position + 1) / ADMIT_PER_SEC);
}

/**
 * Join (or refresh) the fair queue for a product.
 * Anti-refresh: same wait token is returned while the slot is alive.
 */
async function joinQueue(productId, userId, { verified = false, fingerprint = "" } = {}) {
    if (!ENABLED) {
        return { enabled: false, queued: false, message: "Fair queue disabled" };
    }

    const pid = String(productId);
    const uid = String(userId);
    await expireAbandoned(pid);

    // Activate on first join when not force-all (drop mode)
    if (!(await isQueueActive(pid)) && !FORCE_ALL) {
        await setQueueActive(pid, true);
    }

    const existingRaw = await redisGet(metaKey(pid, uid));
    if (existingRaw) {
        let meta;
        try {
            meta = typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw;
        } catch (_) {
            meta = null;
        }
        if (meta?.token) {
            const rank = await zrank(pid, uid);
            if (rank != null) {
                const length = await zcard(pid);
                return {
                    enabled: true,
                    queued: true,
                    waitToken: meta.token,
                    position: rank + 1,
                    queueLength: length,
                    etaSec: etaSeconds(rank),
                    refreshed: true,
                    message: "Already in queue"
                };
            }
        }
    }

    const length = await zcard(pid);
    if (length >= MAX_QUEUE_LENGTH) {
        const err = new Error("Fair queue is full. Please try again shortly.");
        err.code = "FAIR_QUEUE_FULL";
        err.status = 503;
        throw err;
    }

    const now = Date.now();
    const score = now - (verified ? VERIFIED_BONUS_MS : 0);
    const waitToken = signToken({
        typ: "wait",
        pid,
        uid,
        fp: String(fingerprint || "").slice(0, 64),
        nonce: crypto.randomBytes(8).toString("hex"),
        iat: now
    });

    await zadd(pid, score, uid);
    await redisSet(
        metaKey(pid, uid),
        { token: waitToken, joinedAt: now, verified: Boolean(verified), fingerprint: fingerprint || "" },
        SLOT_TTL_SEC
    );
    await redisSet(tokenIndexKey(waitToken), { pid, uid }, SLOT_TTL_SEC);

    const rank = await zrank(pid, uid);
    return {
        enabled: true,
        queued: true,
        waitToken,
        position: (rank ?? 0) + 1,
        queueLength: (await zcard(pid)),
        etaSec: etaSeconds(rank ?? 0),
        refreshed: false,
        message: "Joined fair queue"
    };
}

function assertWaitToken(waitToken, productId, userId, fingerprint = "") {
    const payload = verifySignedToken(waitToken);
    if (!payload || payload.typ !== "wait") {
        const err = new Error("Invalid queue token");
        err.code = "FAIR_QUEUE_TOKEN_INVALID";
        err.status = 400;
        throw err;
    }
    if (String(payload.pid) !== String(productId) || String(payload.uid) !== String(userId)) {
        const err = new Error("Queue token does not match this product/user");
        err.code = "FAIR_QUEUE_TOKEN_MISMATCH";
        err.status = 403;
        throw err;
    }
    if (payload.fp && fingerprint && payload.fp !== String(fingerprint).slice(0, 64)) {
        const err = new Error("Queue token bound to another device");
        err.code = "FAIR_QUEUE_TOKEN_BOUND";
        err.status = 403;
        throw err;
    }
    return payload;
}

async function bumpSlotTtl(productId, userId, waitToken) {
    const metaRaw = await redisGet(metaKey(productId, userId));
    let meta = {};
    try {
        meta = metaRaw ? JSON.parse(metaRaw) : {};
    } catch (_) {
        meta = { token: waitToken };
    }
    meta.token = waitToken;
    meta.lastSeenAt = Date.now();
    await redisSet(metaKey(productId, userId), meta, SLOT_TTL_SEC);
    await redisSet(tokenIndexKey(waitToken), { pid: productId, uid: userId }, SLOT_TTL_SEC);
}

/**
 * Try to admit the next N users this second; return status for caller.
 */
async function getStatus(productId, userId, waitToken, { fingerprint = "" } = {}) {
    if (!ENABLED) {
        return { enabled: false, queued: false, admitted: true, message: "Fair queue disabled" };
    }

    const pid = String(productId);
    const uid = String(userId);
    assertWaitToken(waitToken, pid, uid, fingerprint);
    await expireAbandoned(pid);
    await bumpSlotTtl(pid, uid, waitToken);

    // Already holding an admit pass?
    const existingAdmit = await redisGet(admitKey(pid, uid));
    if (existingAdmit) {
        let pass;
        try {
            pass = JSON.parse(existingAdmit);
        } catch (_) {
            pass = { admitToken: existingAdmit };
        }
        return {
            enabled: true,
            queued: false,
            admitted: true,
            admitToken: pass.admitToken || existingAdmit,
            position: 0,
            etaSec: 0,
            queueLength: await zcard(pid),
            message: "Admitted — complete your reservation"
        };
    }

    const rank = await zrank(pid, uid);
    if (rank == null) {
        const err = new Error("Not in queue or slot expired — please rejoin");
        err.code = "FAIR_QUEUE_NOT_IN_QUEUE";
        err.status = 404;
        throw err;
    }

    // Admit front-of-queue users up to ADMIT_PER_SEC this second
    const second = Math.floor(Date.now() / 1000);
    let admittedCount = 0;
    const rateRaw = await redisGet(rateKey(pid, second));
    if (rateRaw) admittedCount = parseInt(rateRaw, 10) || 0;

    if (rank < ADMIT_PER_SEC && admittedCount < ADMIT_PER_SEC) {
            const admitToken = signToken({
                typ: "admit",
                pid,
                uid,
                iat: Date.now(),
                exp: Date.now() + ADMIT_TTL_SEC * 1000
            });
            await redisSet(admitKey(pid, uid), { admitToken }, ADMIT_TTL_SEC);
            await redisSet(rateKey(pid, second), String(admittedCount + 1), 3);
            await zrem(pid, uid);
            await redisDel(metaKey(pid, uid), tokenIndexKey(waitToken));

            return {
                enabled: true,
                queued: false,
                admitted: true,
                admitToken,
                position: 0,
                etaSec: 0,
                queueLength: await zcard(pid),
                message: "You are next — reserve stock now"
            };
    }

    return {
        enabled: true,
        queued: true,
        admitted: false,
        waitToken,
        position: rank + 1,
        etaSec: etaSeconds(rank),
        queueLength: await zcard(pid),
        message: "Waiting in fair queue"
    };
}

async function leaveQueue(productId, userId, waitToken) {
    const pid = String(productId);
    const uid = String(userId);
    if (waitToken) {
        try {
            assertWaitToken(waitToken, pid, uid);
        } catch (_) {
            /* still remove if present */
        }
    }
    await zrem(pid, uid);
    await redisDel(metaKey(pid, uid), admitKey(pid, uid));
    if (waitToken) await redisDel(tokenIndexKey(waitToken));
    return { success: true, message: "Left fair queue" };
}

/**
 * Validate admit token before inventory reservation.
 * Returns { required, ok, code?, message? }
 */
async function assertAdmission(productId, userId, admitToken) {
    if (!ENABLED || !ENFORCE) {
        return { required: false, ok: true };
    }
    const active = await isQueueActive(productId);
    if (!active) {
        return { required: false, ok: true };
    }

    if (!admitToken) {
        return {
            required: true,
            ok: false,
            code: "FAIR_QUEUE_ADMIT_REQUIRED",
            message: "Join the fair queue and wait for admission before reserving this item"
        };
    }

    const payload = verifySignedToken(admitToken);
    if (!payload || payload.typ !== "admit") {
        return {
            required: true,
            ok: false,
            code: "FAIR_QUEUE_ADMIT_INVALID",
            message: "Invalid admission token"
        };
    }
    if (String(payload.pid) !== String(productId) || String(payload.uid) !== String(userId)) {
        return {
            required: true,
            ok: false,
            code: "FAIR_QUEUE_ADMIT_MISMATCH",
            message: "Admission token mismatch"
        };
    }
    if (payload.exp && Date.now() > Number(payload.exp)) {
        return {
            required: true,
            ok: false,
            code: "FAIR_QUEUE_ADMIT_EXPIRED",
            message: "Admission expired — rejoin the queue"
        };
    }

    const stored = await redisGet(admitKey(productId, userId));
    if (!stored) {
        return {
            required: true,
            ok: false,
            code: "FAIR_QUEUE_ADMIT_EXPIRED",
            message: "Admission expired — rejoin the queue"
        };
    }

    return { required: true, ok: true, admitToken };
}

/** Consume admit pass after successful reservation (one-shot). */
async function consumeAdmission(productId, userId) {
    await redisDel(admitKey(productId, userId));
}

/**
 * Admin emergency unlock: flush queue + admit passes for a SKU.
 */
async function emergencyUnlock(productId) {
    const pid = String(productId);
    const members = await zrange(pid, 0, -1);
    for (const uid of members) {
        await redisDel(metaKey(pid, uid), admitKey(pid, uid));
        memZRem(pid, uid);
    }
    try {
        await withTimeout(redis.del(zKey(pid)));
    } catch (_) {
        memZ.delete(pid);
    }
    await redisDel(activeKey(pid));
    // Clear rate keys for a few recent seconds
    const sec = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 5; i += 1) {
        await redisDel(rateKey(pid, sec - i));
    }
    return {
        success: true,
        message: "Fair queue unlocked — reservations no longer gated",
        clearedMembers: members.length
    };
}

function getConfig() {
    return {
        enabled: ENABLED,
        enforce: ENFORCE,
        forceAll: FORCE_ALL,
        admitPerSec: ADMIT_PER_SEC,
        maxQueueLength: MAX_QUEUE_LENGTH,
        slotTtlSec: SLOT_TTL_SEC,
        admitTtlSec: ADMIT_TTL_SEC,
        verifiedBonusMs: VERIFIED_BONUS_MS
    };
}

module.exports = {
    ENABLED,
    ENFORCE,
    joinQueue,
    getStatus,
    leaveQueue,
    assertAdmission,
    consumeAdmission,
    emergencyUnlock,
    isQueueActive,
    setQueueActive,
    getConfig,
    verifySignedToken,
    // test helpers
    _memory: memory,
    _memZ: memZ
};
