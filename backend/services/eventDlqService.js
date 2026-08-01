/**
 * Dead-letter queue + poison-message handler for domain/outbox events (#1387).
 *
 * After max retries, events land here with redacted payloads for operator
 * replay/discard. Alerts when DLQ depth grows past a threshold.
 */

"use strict";

const crypto = require("crypto");
const db = require("../config/db");
const logger = require("../utils/logger");

let redis = null;
try {
    redis = require("../config/redis");
} catch (_) {
    redis = null;
}

let metrics = null;
try {
    metrics = require("../config/metrics");
} catch (_) {
    metrics = null;
}

const DLQ_CONFIG = {
    maxRetries: Math.max(
        1,
        parseInt(process.env.OUTBOX_MAX_RETRIES, 10) ||
            parseInt(process.env.EVENT_DLQ_MAX_RETRIES, 10) ||
            5
    ),
    /** Base delay (ms) for exponential backoff: base * 2^(attempt-1) */
    backoffBaseMs: Math.max(
        1000,
        parseInt(process.env.EVENT_DLQ_BACKOFF_BASE_MS, 10) || 30_000
    ),
    backoffMaxMs: Math.max(
        60_000,
        parseInt(process.env.EVENT_DLQ_BACKOFF_MAX_MS, 10) || 15 * 60_000
    ),
    depthAlertThreshold: Math.max(
        1,
        parseInt(process.env.EVENT_DLQ_DEPTH_ALERT, 10) || 25
    ),
    redisDepthKey: "events:dlq:depth",
    redisAlertKey: "events:dlq:depth_alerted"
};

const DLQ_STATUS = Object.freeze({
    OPEN: "open",
    REPLAYED: "replayed",
    DISCARDED: "discarded"
});

/** Keys (case-insensitive) stripped/redacted from DLQ dumps */
const PII_KEY_PATTERN =
    /^(email|e_mail|phone|mobile|password|passwd|token|access_token|refresh_token|secret|ssn|card|card_number|cvv|cvc|pan|authorization|cookie|otp|pin)$/i;

const PII_STRING_PATTERN =
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(\+?\d[\d\s\-()]{8,}\d)/g;

function promInc(name, value = 1) {
    if (metrics && typeof metrics.increment === "function") {
        try {
            metrics.increment(name, value);
        } catch (_) {
            /* never fail callers */
        }
    }
}

function promGauge(name, value) {
    if (metrics && typeof metrics.gauge === "function") {
        try {
            metrics.gauge(name, value);
        } catch (_) {
            /* ignore */
        }
    }
}

/**
 * Deep-clone and redact PII from payloads before DLQ persistence / dumps.
 */
function redactPii(value, depth = 0) {
    if (depth > 12) return "[max-depth]";
    if (value == null) return value;

    if (Array.isArray(value)) {
        return value.map((v) => redactPii(v, depth + 1));
    }

    if (typeof value === "object") {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            if (PII_KEY_PATTERN.test(key)) {
                out[key] = "[REDACTED]";
            } else {
                out[key] = redactPii(val, depth + 1);
            }
        }
        return out;
    }

    if (typeof value === "string") {
        return value.replace(PII_STRING_PATTERN, "[REDACTED]");
    }

    return value;
}

function computeBackoffMs(attempt) {
    const exp = Math.max(0, Number(attempt) - 1);
    const raw = DLQ_CONFIG.backoffBaseMs * 2 ** exp;
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(DLQ_CONFIG.backoffMaxMs, raw + jitter);
}

function nextRetryAt(attempt, from = new Date()) {
    return new Date(from.getTime() + computeBackoffMs(attempt));
}

class EventDlqService {
    constructor() {
        this.stats = {
            enqueued: 0,
            replayed: 0,
            discarded: 0,
            replayFailed: 0,
            alerts: 0
        };
        this._lastDepth = 0;
    }

    /**
     * Persist a poison message after outbox max retries.
     */
    async enqueuePoison({
        eventId,
        eventType,
        idempotencyKey = null,
        payload = {},
        metadata = {},
        errorMessage = "",
        errorStack = null,
        attempts = 0,
        source = "outbox"
    } = {}) {
        const id = crypto.randomUUID();
        const redactedPayload = redactPii(payload);
        const redactedMeta = redactPii(metadata);
        const errorPayload = redactPii({
            message: String(errorMessage || "unknown error").slice(0, 2000),
            stack: errorStack ? String(errorStack).slice(0, 4000) : null,
            attempts,
            failedAt: new Date().toISOString()
        });

        try {
            await db.query(
                `INSERT INTO event_dlq
                 (id, event_id, event_type, idempotency_key, source,
                  payload_json, metadata_json, error_json, attempts,
                  status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    id,
                    eventId,
                    eventType,
                    idempotencyKey,
                    source,
                    JSON.stringify(redactedPayload),
                    JSON.stringify(redactedMeta),
                    JSON.stringify(errorPayload),
                    attempts,
                    DLQ_STATUS.OPEN
                ]
            );
        } catch (error) {
            // Fallback when table missing during migrate — keep in-memory note
            logger.warn(`eventDlq enqueue failed: ${error.message}`);
            this.stats.enqueued += 1;
            promInc("event_dlq.enqueue_failed");
            throw error;
        }

        this.stats.enqueued += 1;
        promInc("event_dlq.enqueued");
        await this.refreshDepthMetrics();
        logger.error(
            `💀 Event moved to DLQ: ${eventType} (${eventId}) dlq=${id}`
        );
        return { id, eventId, eventType, status: DLQ_STATUS.OPEN };
    }

    async getDepth() {
        try {
            const [rows] = await db.query(
                `SELECT COUNT(*) AS cnt FROM event_dlq WHERE status = ?`,
                [DLQ_STATUS.OPEN]
            );
            return Number(rows[0]?.cnt) || 0;
        } catch (_) {
            return this._lastDepth;
        }
    }

    async refreshDepthMetrics() {
        const depth = await this.getDepth();
        this._lastDepth = depth;
        promGauge("event_dlq.dlq_depth", depth);
        promInc("event_dlq.depth_sample");

        try {
            if (redis && typeof redis.set === "function") {
                await redis.set(DLQ_CONFIG.redisDepthKey, String(depth));
            }
        } catch (_) {
            /* optional */
        }

        if (depth >= DLQ_CONFIG.depthAlertThreshold) {
            await this.alertDepthGrowth(depth);
        }
        return depth;
    }

    async alertDepthGrowth(depth) {
        let shouldLog = true;
        try {
            if (redis && typeof redis.get === "function") {
                const flagged = await redis.get(DLQ_CONFIG.redisAlertKey);
                if (flagged === "1") shouldLog = false;
                else {
                    await redis.setex(DLQ_CONFIG.redisAlertKey, 300, "1");
                }
            }
        } catch (_) {
            /* log every time if redis down */
        }

        if (shouldLog) {
            this.stats.alerts += 1;
            promInc("event_dlq.depth_alert");
            logger.error(
                `🚨 DLQ depth alert: ${depth} open poison messages (threshold ${DLQ_CONFIG.depthAlertThreshold})`
            );
        }
    }

    async list({ status = DLQ_STATUS.OPEN, limit = 50, offset = 0 } = {}) {
        const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
        const safeOffset = Math.max(0, Number(offset) || 0);
        const params = [];
        let sql = `SELECT id, event_id, event_type, idempotency_key, source,
                          payload_json, metadata_json, error_json, attempts,
                          status, replay_count, last_replayed_at,
                          discarded_at, discarded_by, created_at, updated_at
                   FROM event_dlq`;
        if (status) {
            sql += ` WHERE status = ?`;
            params.push(status);
        }
        sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(safeLimit, safeOffset);

        const [rows] = await db.query(sql, params);
        return rows.map((row) => this.rowToDto(row));
    }

    rowToDto(row, { includePayload = true } = {}) {
        const parse = (v, fallback) => {
            if (v == null) return fallback;
            if (typeof v === "object") return v;
            try {
                return JSON.parse(v);
            } catch (_) {
                return fallback;
            }
        };
        const dto = {
            id: row.id,
            eventId: row.event_id,
            eventType: row.event_type,
            idempotencyKey: row.idempotency_key,
            source: row.source,
            attempts: row.attempts,
            status: row.status,
            replayCount: row.replay_count || 0,
            lastReplayedAt: row.last_replayed_at,
            discardedAt: row.discarded_at,
            discardedBy: row.discarded_by,
            error: parse(row.error_json, {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
        if (includePayload) {
            // Always re-redact on dump so older rows stay safe if rules tighten
            dto.payload = redactPii(parse(row.payload_json, {}));
            dto.metadata = redactPii(parse(row.metadata_json, {}));
        }
        return dto;
    }

    async getById(id) {
        const [rows] = await db.query(
            `SELECT * FROM event_dlq WHERE id = ? LIMIT 1`,
            [id]
        );
        return rows[0] ? this.rowToDto(rows[0]) : null;
    }

    /**
     * Re-queue a DLQ item back onto the outbox as pending.
     * @param {object} outboxService — must expose storeEvent / resetForReplay
     */
    async replayOne(id, { outboxService, actorId = null } = {}) {
        const [rows] = await db.query(
            `SELECT * FROM event_dlq WHERE id = ? LIMIT 1`,
            [id]
        );

        const row = rows[0];
        if (!row) {
            const err = new Error("DLQ entry not found");
            err.status = 404;
            err.code = "DLQ_NOT_FOUND";
            throw err;
        }
        if (row.status !== DLQ_STATUS.OPEN) {
            const err = new Error(`DLQ entry is ${row.status}, not open`);
            err.status = 409;
            err.code = "DLQ_NOT_OPEN";
            throw err;
        }

        const parse = (v) => {
            if (v == null) return {};
            if (typeof v === "object") return v;
            try {
                return JSON.parse(v);
            } catch (_) {
                return {};
            }
        };

        if (!outboxService || typeof outboxService.requeueFromDlq !== "function") {
            const err = new Error("Outbox requeue hook is not available");
            err.status = 500;
            err.code = "DLQ_REQUEUE_UNAVAILABLE";
            throw err;
        }

        try {
            await outboxService.requeueFromDlq({
                eventId: row.event_id,
                eventType: row.event_type,
                idempotencyKey: row.idempotency_key,
                data: parse(row.payload_json),
                metadata: {
                    ...parse(row.metadata_json),
                    replayedFromDlq: row.id,
                    replayedBy: actorId
                }
            });

            await db.query(
                `UPDATE event_dlq
                 SET status = ?, replay_count = COALESCE(replay_count, 0) + 1,
                     last_replayed_at = NOW(), updated_at = NOW()
                 WHERE id = ?`,
                [DLQ_STATUS.REPLAYED, id]
            );

            this.stats.replayed += 1;
            promInc("event_dlq.replay_success");
            await this.refreshDepthMetrics();
            return { id, status: DLQ_STATUS.REPLAYED, eventId: row.event_id };
        } catch (error) {
            this.stats.replayFailed += 1;
            promInc("event_dlq.replay_failed");
            throw error;
        }
    }

    async replayBatch(ids = [], opts = {}) {
        const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
        const results = [];
        for (const id of list) {
            try {
                const r = await this.replayOne(id, opts);
                results.push({ id, success: true, ...r });
            } catch (error) {
                results.push({
                    id,
                    success: false,
                    code: error.code || "DLQ_REPLAY_FAILED",
                    message: error.message
                });
            }
        }
        return {
            total: list.length,
            succeeded: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results
        };
    }

    async discard(id, { actorId = null, reason = "" } = {}) {
        const [result] = await db.query(
            `UPDATE event_dlq
             SET status = ?, discarded_at = NOW(), discarded_by = ?,
                 discard_reason = ?, updated_at = NOW()
             WHERE id = ? AND status = ?`,
            [
                DLQ_STATUS.DISCARDED,
                actorId,
                String(reason || "").slice(0, 500) || null,
                id,
                DLQ_STATUS.OPEN
            ]
        );
        if (!result.affectedRows) {
            const err = new Error("DLQ entry not found or not open");
            err.status = 404;
            err.code = "DLQ_NOT_FOUND";
            throw err;
        }
        this.stats.discarded += 1;
        promInc("event_dlq.discarded");
        await this.refreshDepthMetrics();
        return { id, status: DLQ_STATUS.DISCARDED };
    }

    async getMetrics() {
        const depth = await this.refreshDepthMetrics();
        let byType = [];
        try {
            const [rows] = await db.query(
                `SELECT event_type, COUNT(*) AS cnt
                 FROM event_dlq
                 WHERE status = ?
                 GROUP BY event_type
                 ORDER BY cnt DESC
                 LIMIT 20`,
                [DLQ_STATUS.OPEN]
            );
            byType = rows;
        } catch (_) {
            byType = [];
        }

        return {
            dlq_depth: depth,
            depthAlertThreshold: DLQ_CONFIG.depthAlertThreshold,
            byType,
            local: { ...this.stats },
            config: {
                maxRetries: DLQ_CONFIG.maxRetries,
                backoffBaseMs: DLQ_CONFIG.backoffBaseMs,
                backoffMaxMs: DLQ_CONFIG.backoffMaxMs
            },
            generatedAt: new Date().toISOString()
        };
    }
}

const eventDlqService = new EventDlqService();

module.exports = {
    EventDlqService,
    eventDlqService,
    DLQ_CONFIG,
    DLQ_STATUS,
    redactPii,
    computeBackoffMs,
    nextRetryAt
};
