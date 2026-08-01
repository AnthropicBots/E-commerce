/**
 * Feature Flag Service — percentage rollouts, allowlists, kill switches (#1390).
 *
 * Server-driven flags cached in Redis (short TTL) with an in-memory fallback.
 * Evaluation is sticky per userId via a stable hash bucket (0–99).
 */

"use strict";

const crypto = require("crypto");
const db = require("../config/db");
const redis = require("../config/redis");
const logger = require("../utils/logger");

const FLAG_TYPES = Object.freeze({
    BOOLEAN: "boolean",
    PERCENTAGE: "percentage",
    USER_GROUP: "user_group",
    ENVIRONMENT: "environment",
    ROLLOUT: "rollout"
});

const FLAG_STATUS = Object.freeze({
    DRAFT: "draft",
    ACTIVE: "active",
    PAUSED: "paused",
    KILLED: "killed",
    ARCHIVED: "archived"
});

const ROLLOUT_STRATEGIES = Object.freeze({
    GRADUAL: "gradual",
    BETA: "beta",
    CANARY: "canary",
    A_B_TEST: "a_b_test"
});

const REDIS_PREFIX = "ff:";
const REDIS_FLAG_PREFIX = `${REDIS_PREFIX}flag:`;
const REDIS_EVAL_PREFIX = `${REDIS_PREFIX}eval:`;
const REDIS_INDEX_KEY = `${REDIS_PREFIX}index`;

const CACHE_TTL_SEC = Math.max(
    5,
    parseInt(process.env.FEATURE_FLAG_CACHE_TTL_SEC, 10) || 30
);

/** Seed defaults used when DB is empty / unreachable (safe off). */
const DEFAULT_FLAGS = Object.freeze({
    new_checkout: {
        key: "new_checkout",
        name: "New Checkout",
        description: "Revamped checkout flow",
        type: FLAG_TYPES.PERCENTAGE,
        status: FLAG_STATUS.ACTIVE,
        value: { enabled: true },
        rolloutPercentage: 0,
        allowlist: [],
        killSwitch: false
    },
    ai_widgets: {
        key: "ai_widgets",
        name: "AI Widgets",
        description: "Storefront AI recommendation widgets",
        type: FLAG_TYPES.BOOLEAN,
        status: FLAG_STATUS.ACTIVE,
        value: { enabled: false },
        rolloutPercentage: 0,
        allowlist: [],
        killSwitch: false
    }
});

class FeatureFlagService {
    constructor() {
        this.flags = new Map();
        /** Local eval cache when Redis is unavailable */
        this.memoryCache = new Map();
        this.auditLog = [];
        this.initialized = false;
        this.cacheTTL = CACHE_TTL_SEC;
    }

    async initialize() {
        if (this.initialized) return this;
        await this.loadFlags();
        this.initialized = true;
        logger.info(
            `Feature Flag Service initialized (${this.flags.size} flags, TTL ${this.cacheTTL}s)`
        );
        return this;
    }

    // ------------------------------------------------------------------ load
    async loadFlags() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM feature_flags
                 WHERE status != 'archived'
                 ORDER BY updated_at DESC`
            );

            this.flags.clear();
            for (const row of rows || []) {
                const flag = this.rowToFlag(row);
                this.flags.set(flag.key, flag);
                await this.cacheFlagDefinition(flag);
            }

            if (this.flags.size === 0) {
                for (const seed of Object.values(DEFAULT_FLAGS)) {
                    this.flags.set(seed.key, this.normalizeFlag({ ...seed }));
                }
            }
        } catch (error) {
            logger.warn(
                `featureFlagService.loadFlags falling back to defaults: ${error.message}`
            );
            for (const seed of Object.values(DEFAULT_FLAGS)) {
                if (!this.flags.has(seed.key)) {
                    this.flags.set(seed.key, this.normalizeFlag({ ...seed }));
                }
            }
        }
    }

    rowToFlag(row) {
        const parseJson = (value, fallback) => {
            if (value == null) return fallback;
            if (typeof value === "object") return value;
            try {
                return JSON.parse(value);
            } catch (_) {
                return fallback;
            }
        };

        return this.normalizeFlag({
            id: row.flag_id,
            name: row.name,
            key: row.flag_key || row.key,
            description: row.description || "",
            type: row.type,
            status: row.status,
            value: parseJson(row.value, { enabled: false }),
            conditions: parseJson(row.conditions, {}),
            rolloutStrategy: row.rollout_strategy || ROLLOUT_STRATEGIES.GRADUAL,
            rolloutPercentage: Number(row.rollout_percentage) || 0,
            environments: parseJson(row.environments, []),
            userGroups: parseJson(row.user_groups, []),
            allowlist: parseJson(row.allowlist, []),
            killSwitch: Boolean(row.kill_switch),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }

    normalizeFlag(input = {}) {
        const key =
            input.key ||
            this.generateKey(input.name || `flag_${Date.now()}`);
        return {
            id: input.id || this.generateFlagId(),
            name: input.name || key,
            key,
            description: input.description || "",
            type: input.type || FLAG_TYPES.BOOLEAN,
            status: input.status || FLAG_STATUS.DRAFT,
            value:
                input.value && typeof input.value === "object"
                    ? input.value
                    : { enabled: Boolean(input.value) },
            conditions: input.conditions || {},
            rolloutStrategy: input.rolloutStrategy || ROLLOUT_STRATEGIES.GRADUAL,
            rolloutPercentage: Math.min(
                100,
                Math.max(0, Number(input.rolloutPercentage) || 0)
            ),
            environments: Array.isArray(input.environments)
                ? input.environments
                : ["development", "staging", "production"],
            userGroups: Array.isArray(input.userGroups) ? input.userGroups : [],
            allowlist: Array.isArray(input.allowlist)
                ? input.allowlist.map(String)
                : [],
            killSwitch: Boolean(input.killSwitch),
            createdAt: input.createdAt || new Date().toISOString(),
            updatedAt: input.updatedAt || new Date().toISOString()
        };
    }

    // ---------------------------------------------------------------- evaluate
    /**
     * Sticky percentage bucket 0–99 from userId + flagKey.
     */
    userBucket(userId, flagKey) {
        const material = `${String(userId || "anonymous")}:${String(flagKey || "")}`;
        const digest = crypto.createHash("sha256").update(material).digest();
        return digest.readUInt32BE(0) % 100;
    }

    evaluatePercentage(percentage, context, flagKey) {
        const pct = Number(percentage) || 0;
        if (pct >= 100) return true;
        if (pct <= 0) return false;
        const userId = context.userId || context.user?.id || "anonymous";
        return this.userBucket(userId, flagKey) < pct;
    }

    isAllowlisted(flag, context) {
        const list = flag.allowlist || [];
        if (!list.length) return false;
        const userId = String(context.userId || context.user?.id || "");
        if (!userId) return false;
        return list.map(String).includes(userId);
    }

    async evaluateFlag(flagKey, context = {}) {
        const cacheKey = this.generateCacheKey(flagKey, context);

        const cached = await this.getCachedEval(cacheKey);
        if (cached) {
            return cached;
        }

        let flag = this.flags.get(flagKey);
        if (!flag) {
            flag = await this.loadFlagFromCacheOrDb(flagKey);
        }

        if (!flag) {
            return { enabled: false, reason: "Flag not found", key: flagKey };
        }

        let enabled = false;
        let reason = "";

        if (flag.killSwitch || flag.status === FLAG_STATUS.KILLED) {
            enabled = false;
            reason = "Kill switch active";
        } else if (flag.status !== FLAG_STATUS.ACTIVE) {
            enabled = false;
            reason = `Flag status: ${flag.status}`;
        } else if (this.isAllowlisted(flag, context)) {
            enabled = true;
            reason = "User allowlist";
        } else {
            switch (flag.type) {
                case FLAG_TYPES.BOOLEAN:
                    enabled = Boolean(flag.value && flag.value.enabled);
                    reason = enabled ? "Boolean enabled" : "Boolean disabled";
                    break;
                case FLAG_TYPES.PERCENTAGE:
                    enabled = this.evaluatePercentage(
                        flag.rolloutPercentage,
                        context,
                        flag.key
                    );
                    reason = enabled
                        ? `Percentage (${flag.rolloutPercentage}%)`
                        : "Percentage not met";
                    break;
                case FLAG_TYPES.USER_GROUP: {
                    const groups = flag.userGroups || [];
                    const userGroup =
                        context.userGroup || context.user?.group || "default";
                    enabled = groups.length === 0 || groups.includes(userGroup);
                    reason = enabled
                        ? "User in allowed group"
                        : "User not in allowed group";
                    break;
                }
                case FLAG_TYPES.ENVIRONMENT: {
                    const envs = flag.environments || [];
                    const currentEnv =
                        process.env.NODE_ENV ||
                        context.environment ||
                        "development";
                    enabled = envs.length === 0 || envs.includes(currentEnv);
                    reason = enabled
                        ? "Environment matches"
                        : "Environment mismatch";
                    break;
                }
                case FLAG_TYPES.ROLLOUT:
                    enabled = this.evaluateRollout(flag, context);
                    reason = enabled
                        ? "Rollout conditions met"
                        : "Rollout conditions not met";
                    break;
                default:
                    enabled = false;
                    reason = "Unknown flag type";
            }
        }

        const result = {
            enabled,
            reason,
            key: flag.key,
            flag: flag.name,
            type: flag.type,
            killSwitch: Boolean(flag.killSwitch),
            timestamp: new Date().toISOString()
        };

        await this.cacheEval(cacheKey, result);
        // Fire-and-forget audit of evaluations (non-blocking)
        this.logEvaluation(flagKey, context, result).catch(() => {});

        return result;
    }

    evaluateRollout(flag, context) {
        if (flag.rolloutPercentage >= 100) return true;
        if (flag.userGroups && flag.userGroups.length > 0) {
            const userGroup =
                context.userGroup || context.user?.group || "default";
            if (!flag.userGroups.includes(userGroup)) return false;
        }
        const currentEnv =
            process.env.NODE_ENV || context.environment || "development";
        if (
            flag.environments &&
            flag.environments.length > 0 &&
            !flag.environments.includes(currentEnv)
        ) {
            return false;
        }
        return this.evaluatePercentage(
            flag.rolloutPercentage,
            context,
            flag.key
        );
    }

    async isEnabled(flagKey, context = {}) {
        const result = await this.evaluateFlag(flagKey, context);
        return result.enabled;
    }

    /**
     * Bootstrap map for the storefront: { [flagKey]: boolean }
     */
    async bootstrap(context = {}) {
        if (!this.initialized) {
            await this.initialize();
        }
        const out = {};
        for (const key of this.flags.keys()) {
            const result = await this.evaluateFlag(key, context);
            out[key] = Boolean(result.enabled);
        }
        return {
            flags: out,
            ttlSec: this.cacheTTL,
            evaluatedAt: new Date().toISOString()
        };
    }

    // ----------------------------------------------------------- CRUD + kill
    async createFlag(flagData, actor = null) {
        const flag = this.normalizeFlag({
            ...flagData,
            key: flagData.key || this.generateKey(flagData.name || ""),
            status: flagData.status || FLAG_STATUS.DRAFT
        });
        this.validateFlag(flag);

        if (this.flags.has(flag.key)) {
            throw Object.assign(new Error(`Flag already exists: ${flag.key}`), {
                status: 409,
                code: "FLAG_EXISTS"
            });
        }

        this.flags.set(flag.key, flag);
        await this.storeFlag(flag);
        await this.cacheFlagDefinition(flag);
        await this.writeAudit("create", flag.key, actor, { flag });
        return flag;
    }

    async updateFlag(flagKey, updates, actor = null) {
        const existing = this.flags.get(flagKey) || (await this.loadFlagFromCacheOrDb(flagKey));
        if (!existing) {
            throw Object.assign(new Error(`Flag not found: ${flagKey}`), {
                status: 404,
                code: "FLAG_NOT_FOUND"
            });
        }

        const flag = this.normalizeFlag({
            ...existing,
            ...updates,
            key: existing.key,
            id: existing.id,
            updatedAt: new Date().toISOString()
        });
        this.validateFlag(flag);

        this.flags.set(flagKey, flag);
        await this.storeFlag(flag);
        await this.clearFlagCache(flagKey);
        await this.cacheFlagDefinition(flag);
        await this.writeAudit("update", flagKey, actor, { updates });
        return flag;
    }

    async deleteFlag(flagKey, actor = null) {
        return this.updateFlag(
            flagKey,
            { status: FLAG_STATUS.ARCHIVED },
            actor
        ).then(async (flag) => {
            await this.writeAudit("archive", flagKey, actor, {});
            return flag;
        });
    }

    /**
     * Instant kill switch: disable feature + clear Redis eval cache globally.
     */
    async killSwitch(flagKey, { reason = "", actor = null } = {}) {
        const existing =
            this.flags.get(flagKey) || (await this.loadFlagFromCacheOrDb(flagKey));
        if (!existing) {
            throw Object.assign(new Error(`Flag not found: ${flagKey}`), {
                status: 404,
                code: "FLAG_NOT_FOUND"
            });
        }

        const flag = await this.updateFlag(
            flagKey,
            {
                killSwitch: true,
                status: FLAG_STATUS.KILLED,
                value: { ...(existing.value || {}), enabled: false },
                rolloutPercentage: 0
            },
            actor
        );

        await this.clearAllCaches();
        await this.writeAudit("kill", flagKey, actor, { reason });
        logger.warn(`Feature flag KILLED: ${flagKey} — ${reason || "no reason"}`);
        return flag;
    }

    /** Re-enable after a kill (does not auto-roll out — percentage stays 0). */
    async unkilled(flagKey, actor = null) {
        return this.updateFlag(
            flagKey,
            {
                killSwitch: false,
                status: FLAG_STATUS.PAUSED,
                value: { enabled: false }
            },
            actor
        );
    }

    getAllFlags(filters = {}) {
        let flags = Array.from(this.flags.values());
        if (filters.status) {
            flags = flags.filter((f) => f.status === filters.status);
        }
        if (filters.type) {
            flags = flags.filter((f) => f.type === filters.type);
        }
        return flags;
    }

    getFlag(flagKey) {
        return this.flags.get(flagKey) || null;
    }

    getAuditLog(limit = 50) {
        return this.auditLog.slice(0, Math.max(1, limit));
    }

    // --------------------------------------------------------------- cache
    generateCacheKey(flagKey, context) {
        const userId = context.userId || context.user?.id || "anonymous";
        const env = process.env.NODE_ENV || "development";
        return `${flagKey}:${userId}:${env}`;
    }

    async getCachedEval(cacheKey) {
        try {
            const raw = await redis.get(`${REDIS_EVAL_PREFIX}${cacheKey}`);
            if (raw) return JSON.parse(raw);
        } catch (_) {
            /* fall through to memory */
        }
        const mem = this.memoryCache.get(cacheKey);
        if (mem && mem.expiresAt > Date.now()) return mem.result;
        return null;
    }

    async cacheEval(cacheKey, result) {
        this.memoryCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + this.cacheTTL * 1000
        });
        try {
            await redis.setex(
                `${REDIS_EVAL_PREFIX}${cacheKey}`,
                this.cacheTTL,
                JSON.stringify(result)
            );
        } catch (_) {
            /* memory already set */
        }
    }

    async cacheFlagDefinition(flag) {
        try {
            await redis.setex(
                `${REDIS_FLAG_PREFIX}${flag.key}`,
                this.cacheTTL,
                JSON.stringify(flag)
            );
            await redis.sadd(REDIS_INDEX_KEY, flag.key);
        } catch (_) {
            /* optional */
        }
    }

    async clearFlagCache(flagKey) {
        for (const key of [...this.memoryCache.keys()]) {
            if (key.startsWith(`${flagKey}:`)) {
                this.memoryCache.delete(key);
            }
        }
        try {
            const pattern = `${REDIS_EVAL_PREFIX}${flagKey}:*`;
            const keys = await this.scanKeys(pattern);
            if (keys.length) await redis.del(...keys);
            await redis.del(`${REDIS_FLAG_PREFIX}${flagKey}`);
        } catch (_) {
            /* best effort */
        }
    }

    /**
     * Kill-switch / admin flush: wipe all flag eval caches globally.
     */
    async clearAllCaches() {
        this.memoryCache.clear();
        try {
            const keys = await this.scanKeys(`${REDIS_PREFIX}*`);
            if (keys.length) {
                // delete in chunks
                for (let i = 0; i < keys.length; i += 100) {
                    await redis.del(...keys.slice(i, i + 100));
                }
            }
        } catch (error) {
            logger.warn(`clearAllCaches Redis error: ${error.message}`);
        }
        return { clearedAt: new Date().toISOString() };
    }

    async scanKeys(pattern) {
        const found = [];
        if (typeof redis.keys === "function") {
            try {
                const keys = await redis.keys(pattern);
                return keys || [];
            } catch (_) {
                return found;
            }
        }
        return found;
    }

    async loadFlagFromCacheOrDb(flagKey) {
        try {
            const raw = await redis.get(`${REDIS_FLAG_PREFIX}${flagKey}`);
            if (raw) {
                const flag = this.normalizeFlag(JSON.parse(raw));
                this.flags.set(flag.key, flag);
                return flag;
            }
        } catch (_) {
            /* continue */
        }

        try {
            const [rows] = await db.query(
                `SELECT * FROM feature_flags WHERE flag_key = ? LIMIT 1`,
                [flagKey]
            );
            if (rows && rows[0]) {
                const flag = this.rowToFlag(rows[0]);
                this.flags.set(flag.key, flag);
                return flag;
            }
        } catch (_) {
            /* ignore */
        }
        return null;
    }

    // --------------------------------------------------------------- persist
    async storeFlag(flag) {
        try {
            await db.query(
                `INSERT INTO feature_flags
                 (flag_id, name, flag_key, description, type, status,
                  value, conditions, rollout_strategy, rollout_percentage,
                  environments, user_groups, allowlist, kill_switch,
                  created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name),
                 description = VALUES(description),
                 type = VALUES(type),
                 status = VALUES(status),
                 value = VALUES(value),
                 conditions = VALUES(conditions),
                 rollout_strategy = VALUES(rollout_strategy),
                 rollout_percentage = VALUES(rollout_percentage),
                 environments = VALUES(environments),
                 user_groups = VALUES(user_groups),
                 allowlist = VALUES(allowlist),
                 kill_switch = VALUES(kill_switch),
                 updated_at = VALUES(updated_at)`,
                [
                    flag.id,
                    flag.name,
                    flag.key,
                    flag.description,
                    flag.type,
                    flag.status,
                    JSON.stringify(flag.value),
                    JSON.stringify(flag.conditions),
                    flag.rolloutStrategy,
                    flag.rolloutPercentage,
                    JSON.stringify(flag.environments),
                    JSON.stringify(flag.userGroups),
                    JSON.stringify(flag.allowlist),
                    flag.killSwitch ? 1 : 0,
                    flag.createdAt,
                    flag.updatedAt
                ]
            );
        } catch (error) {
            logger.warn(`storeFlag error (in-memory still updated): ${error.message}`);
        }
    }

    async logEvaluation(flagKey, context, result) {
        try {
            await db.query(
                `INSERT INTO feature_flag_evaluations
                 (flag_key, user_id, context_json, result_json, evaluated_at)
                 VALUES (?, ?, ?, ?, NOW())`,
                [
                    flagKey,
                    context.userId || context.user?.id || "anonymous",
                    JSON.stringify(context),
                    JSON.stringify(result)
                ]
            );
        } catch (_) {
            /* optional table */
        }
    }

    async writeAudit(action, flagKey, actor, meta = {}) {
        const entry = {
            id: crypto.randomUUID(),
            action,
            flagKey,
            actorId: actor?.id || actor?.userId || null,
            actorEmail: actor?.email || null,
            meta,
            at: new Date().toISOString()
        };
        this.auditLog.unshift(entry);
        if (this.auditLog.length > 500) this.auditLog.pop();

        try {
            await db.query(
                `INSERT INTO feature_flag_audit
                 (id, action, flag_key, actor_id, actor_email, meta_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    entry.id,
                    action,
                    flagKey,
                    entry.actorId,
                    entry.actorEmail,
                    JSON.stringify(meta)
                ]
            );
        } catch (_) {
            /* optional */
        }
        return entry;
    }

    validateFlag(flag) {
        if (!flag.name) throw new Error("Flag name is required");
        if (!flag.key) throw new Error("Flag key is required");
        if (!/^[a-z0-9_]+$/.test(flag.key)) {
            throw new Error(
                "Flag key must be lowercase alphanumeric with underscores"
            );
        }
        if (!Object.values(FLAG_TYPES).includes(flag.type)) {
            throw new Error(`Invalid flag type: ${flag.type}`);
        }
        if (flag.rolloutPercentage < 0 || flag.rolloutPercentage > 100) {
            throw new Error("Rollout percentage must be between 0 and 100");
        }
    }

    generateFlagId() {
        return `FLAG_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    }

    generateKey(name) {
        return String(name || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "")
            .replace(/_+/g, "_") || `flag_${Date.now()}`;
    }

    async getStatistics() {
        return {
            totalFlags: this.flags.size,
            activeFlags: Array.from(this.flags.values()).filter(
                (f) => f.status === FLAG_STATUS.ACTIVE
            ).length,
            killedFlags: Array.from(this.flags.values()).filter(
                (f) => f.killSwitch || f.status === FLAG_STATUS.KILLED
            ).length,
            cacheTTL: this.cacheTTL,
            memoryCacheSize: this.memoryCache.size,
            auditEntries: this.auditLog.length,
            flagTypes: FLAG_TYPES,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            totalFlags: this.flags.size,
            activeFlags: Array.from(this.flags.values()).filter(
                (f) => f.status === "active"
            ).length,
            cacheSize: this.memoryCache.size,
            flagTypes: Object.values(FLAG_TYPES),
            statuses: Object.values(FLAG_STATUS),
            initialized: this.initialized
        };
    }
}

const featureFlagService = new FeatureFlagService();

module.exports = {
    FeatureFlagService,
    FLAG_TYPES,
    FLAG_STATUS,
    ROLLOUT_STRATEGIES,
    DEFAULT_FLAGS,
    featureFlagService
};
