const db = require("../config/db");
const { withTransaction } = require("../config/db");
const { safeArray, safeNumber, sanitizeString } = require("../utils/helpers");

// Shared client -- see config/redis.js. This module used to construct its own
// `new Redis({ ... })`, which meant an extra connection per module and made
// the module impossible to load without a live Redis (#1341).
const redis = require("../config/redis");

function getPromoUsageKey(promoCode) {
    return `promo:usage:${promoCode}`;
}

/**
 * Read a promo's usage counter, degrading to the database when Redis is
 * unavailable.
 *
 * Redis here is a fast counter in front of `promo_codes.usage_count`, not the
 * system of record. Before this, a Redis outage made `redis.get()` reject and
 * that rejection propagated straight out of `validatePromo()`, so **every**
 * promo code in the store stopped validating the moment Redis went down --
 * a cache being unavailable took out checkout discounts entirely.
 *
 * The stored `usage_count` is the durable value written inside the same
 * transaction that records the usage, so falling back to it is correct; the
 * counter can only ever be as stale as the last committed application.
 *
 * @param {string} promoCode
 * @param {object} promo the row already loaded for this code
 * @returns {Promise<number>}
 */
const getUsedCount = async (promoCode, promo) => {
    try {
        const cached = await redis.get(getPromoUsageKey(promoCode));
        if (cached !== null && cached !== undefined) {
            return parseInt(cached, 10) || 0;
        }
    } catch (error) {
        console.error(`Promo usage counter unavailable for ${promoCode}, falling back to usage_count:`, error.message);
    }

    return safeNumber(promo && promo.usage_count);
};

const getPromoByCode = async (code) => {
    const [results] = await db.query("SELECT * FROM promo_codes WHERE code = ? LIMIT 1", [code]);
    return safeArray(results)[0];
};

// ============================================================================
// PER-USER ELIGIBILITY
// ============================================================================
//
// `per_user_limit` and `user_eligibility` were columns nothing read (#1475).
// The helpers below are what reads them, and they are shared by the pre-flight
// check and the one inside the apply transaction so the two cannot disagree
// about what a value means.

// The controllers hand a guest the literal string "guest" rather than an id, so
// every anonymous caller shares one identity. Counting per-user usage against
// that is meaningless -- it would let the first guest exhaust the allowance for
// all of them -- so a per-user rule needs a real account behind it.
const GUEST_USER_ID = "guest";

const isIdentifiedUser = (userId) =>
    userId !== null
    && userId !== undefined
    && userId !== ""
    && userId !== GUEST_USER_ID;

/**
 * How many times one user may use this code.
 *
 * NULL means unlimited; a number, including zero, is a limit. The distinction
 * matters: `0` is legal (`CHECK (per_user_limit >= 0)` in
 * migrations/0002_promo_schema.sql) and reads as "nobody may use this", but a
 * truthiness test folds it into "unlimited" -- the exact opposite of what it
 * says.
 *
 * @param {unknown} value
 * @returns {number|null} null when unlimited.
 */
const parsePerUserLimit = (value) => {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const limit = Number(value);

    return Number.isFinite(limit) && limit >= 0 ? limit : null;
};

/**
 * The account allow-list, if the promo carries one.
 *
 * Stored as JSON text. A malformed value is treated as "no allow-list" rather
 * than being allowed to throw: a bad column should not take down validation for
 * a code that is otherwise fine, and the surrounding checks still apply.
 *
 * An empty array means the same as no list at all -- that is the reading the
 * original helper had, and rows exist that rely on it.
 *
 * @param {unknown} raw
 * @returns {string[]|null} null when the promo is open to everybody.
 */
const parseEligibleUsers = (raw) => {
    if (!raw) return null;

    let parsed;

    try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
        console.error("Promo user_eligibility is not valid JSON, ignoring it:", error.message);
        return null;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        return null;
    }

    return parsed.map((id) => String(id));
};

/**
 * How many times this user has already used this code.
 *
 * Runs on the caller's connection when one is given, so the count can be taken
 * inside the apply transaction and under the same row lock as the global
 * counter. Taken outside it, two concurrent requests both read "0 so far" and
 * both proceed.
 *
 * @param {string} promoCode
 * @param {string} userId
 * @param {object} [connection]
 * @returns {Promise<number>}
 */
const countUserUsage = async (promoCode, userId, connection = db) => {
    const [rows] = await connection.query(
        "SELECT COUNT(*) AS count FROM promo_usage_logs WHERE promo_code = ? AND user_id = ?",
        [promoCode, userId]
    );

    return safeNumber(safeArray(rows)[0]?.count) || 0;
};

/**
 * Is this user allowed to use this code?
 *
 * Split out from the row fetch so the transaction can call it with a row it has
 * already locked instead of reading the same row a second time.
 *
 * @param {object} promo
 * @param {string} userId
 * @param {object} [connection]
 * @returns {Promise<{eligible: boolean, reason?: string}>}
 */
const checkEligibilityForRow = async (promo, userId, connection = db) => {
    const eligibleUsers = parseEligibleUsers(promo.user_eligibility);
    const perUserLimit = parsePerUserLimit(promo.per_user_limit);

    // A promo with no per-user rule is open to anyone, signed in or not.
    if (eligibleUsers === null && perUserLimit === null) {
        return { eligible: true };
    }

    if (!isIdentifiedUser(userId)) {
        return {
            eligible: false,
            reason: "Sign in to use this promo code"
        };
    }

    if (eligibleUsers !== null && !eligibleUsers.includes(String(userId))) {
        return {
            eligible: false,
            reason: "This promo is not available for your account"
        };
    }

    if (perUserLimit !== null) {
        if (perUserLimit === 0) {
            return {
                eligible: false,
                reason: "This promo is not available for your account"
            };
        }

        const used = await countUserUsage(promo.code, userId, connection);

        if (used >= perUserLimit) {
            return {
                eligible: false,
                reason: "You have already used this promo the maximum number of times"
            };
        }
    }

    return { eligible: true };
};

const validatePromo = async (code, cartTotal, userId = null) => {
    const promo = await getPromoByCode(code);
    if (!promo) {
        return { valid: false, message: "Invalid promo code" };
    }
    if (!promo.is_active) {
        return { valid: false, message: "Promo code is inactive" };
    }
    const now = new Date();
    if (new Date(promo.start_date) > now) {
        return { valid: false, message: "Promo code is not yet active" };
    }
    if (new Date(promo.expiry_date) < now) {
        return { valid: false, message: "Promo code has expired" };
    }
    if (safeNumber(cartTotal) < safeNumber(promo.minimum_order_amount)) {
        return { valid: false, message: `Minimum order amount of ₹${promo.minimum_order_amount} required` };
    }

    // Check usage limit against the Redis counter, falling back to the stored
    // usage_count if Redis is down.
    const usedCount = await getUsedCount(code, promo);
    if (promo.usage_limit && usedCount >= promo.usage_limit) {
        return { valid: false, message: "Promo code usage limit has been reached" };
    }

    // Per-user eligibility. Advisory here and re-checked under the row lock in
    // `applyPromoTransaction` -- this call exists so the shopper is turned away
    // at the cart with a reason, rather than at the moment they try to pay.
    //
    // `userId` is optional so existing callers keep working; when it is absent
    // a per-user rule cannot be evaluated and the code passes this stage, which
    // is why the authoritative check is the one in the transaction.
    if (userId !== null && userId !== undefined) {
        const eligibility = await checkEligibilityForRow(promo, userId);

        if (!eligibility.eligible) {
            return { valid: false, message: eligibility.reason };
        }
    }

    return { valid: true, promo };
};

const calculateDiscount = (promo, cartTotal) => {
    let discount = 0;
    const value = safeNumber(promo.discount_value);
    
    if (promo.discount_type === 'percentage') {
        discount = safeNumber(cartTotal) * (value / 100);
        if (promo.maximum_discount && safeNumber(promo.maximum_discount) > 0) {
            discount = Math.min(discount, safeNumber(promo.maximum_discount));
        }
    } else {
        discount = value;
    }
    
    // final amount shouldn't be negative
    if (discount > cartTotal) discount = cartTotal;
    
    return Number(discount.toFixed(2));
};

/**
 * Bring the Redis counter back in line with the durable value.
 *
 * Called *after* the transaction commits, with the number that was committed.
 * Redis is a cache in front of `promo_codes.usage_count`, not the system of
 * record, so it is written from the record rather than incremented alongside
 * it -- an increment that happens inside a transaction survives that
 * transaction rolling back, and `getUsedCount` prefers Redis, so the drift is
 * permanent and always upward (#1475).
 *
 * Failing to write the cache is not a failure of the redemption: the durable
 * count is already committed and `getUsedCount` falls back to it.
 *
 * @param {string} promoCode
 * @param {number} usageCount The committed `usage_count`.
 * @param {Date|string|null} expiryDate Used to expire the key with the promo.
 */
const refreshUsageCounter = async (promoCode, usageCount, expiryDate) => {
    const usageKey = getPromoUsageKey(promoCode);

    try {
        await redis.set(usageKey, String(usageCount));

        const ttlSeconds = expiryDate
            ? Math.floor((new Date(expiryDate).getTime() - Date.now()) / 1000)
            : 0;

        if (ttlSeconds > 0) {
            await redis.expire(usageKey, ttlSeconds);
        }
    } catch (error) {
        console.error(
            `Could not refresh the promo usage counter for ${promoCode}; `
            + `usage_count is committed at ${usageCount} and remains authoritative:`,
            error.message
        );
    }
};

const applyPromoTransaction = async (promoCode, userId, discountAmount) => {
    try {
        // Captured inside the transaction, used after it commits.
        let committedUsageCount = null;
        let promoExpiryDate = null;

        await withTransaction(async (connection) => {
            // Lock the promo row for update (prevents concurrent usage)
            const [promoResults] = await connection.query(
                "SELECT * FROM promo_codes WHERE code = ? FOR UPDATE",
                [promoCode]
            );

            if (promoResults.length === 0) {
                throw new Error(`Promo code ${promoCode} not found`);
            }

            const promo = promoResults[0];

            // Check if promo is still valid
            if (!promo.is_active) {
                throw new Error(`Promo code ${promoCode} is inactive`);
            }

            const now = new Date();
            if (new Date(promo.start_date) > now) {
                throw new Error(`Promo code ${promoCode} is not yet active`);
            }
            if (new Date(promo.expiry_date) < now) {
                throw new Error(`Promo code ${promoCode} has expired`);
            }

            // The global usage limit, read from the row this transaction has
            // locked. `usage_count` is the durable counter and it is what the
            // lock protects, so it is the value the limit has to be tested
            // against -- consulting the Redis cache here means testing a number
            // that another transaction may already have moved.
            const usedCount = safeNumber(promo.usage_count) || 0;

            if (promo.usage_limit && usedCount >= promo.usage_limit) {
                throw new Error(`Promo code ${promoCode} usage limit reached`);
            }

            // The per-user rule, under that same lock.
            //
            // This is the authoritative check -- `validatePromo` runs one too,
            // but it runs unlocked and possibly minutes earlier, so it can only
            // ever be advice. Taking the count here, against a row no other
            // transaction can touch until this one ends, is what makes two
            // simultaneous redemptions of a one-per-customer code impossible
            // rather than merely unlikely.
            const eligibility = await checkEligibilityForRow(promo, userId, connection);

            if (!eligibility.eligible) {
                throw new Error(
                    `Promo code ${promoCode} is not available for user ${userId}: ${eligibility.reason}`
                );
            }

            committedUsageCount = usedCount + 1;
            promoExpiryDate = promo.expiry_date;

            // Update database usage count
            await connection.query(
                `UPDATE promo_codes 
                 SET usage_count = usage_count + 1, 
                     updated_at = NOW() 
                 WHERE code = ?`,
                [promoCode]
            );

            // Log promo usage
            await connection.query(
                `INSERT INTO promo_usage_logs 
                 (promo_code, user_id, discount_amount, applied_at)
                 VALUES (?, ?, ?, NOW())`,
                [promoCode, userId, discountAmount]
            );
        });

        // Only now, and from the value that was actually committed. Nothing
        // above this line touches Redis, so a rollback anywhere in the
        // transaction leaves the counter exactly as it found it.
        await refreshUsageCounter(promoCode, committedUsageCount, promoExpiryDate);

        console.log(`[AUDIT] Promo ${promoCode} applied by user ${userId} - Discount: ${discountAmount}`);
        return true;

    } catch (error) {
        console.error(`Promo application error for ${promoCode}:`, error);
        throw error;
    }
};

/**
 * Is this user allowed to use this code, by code rather than by row?
 *
 * The public entry point, kept for callers that have a code and not a row. The
 * rules themselves live in `checkEligibilityForRow` so that this and the check
 * inside `applyPromoTransaction` cannot drift apart -- when they were separate,
 * one of them was simply never called.
 *
 * Two behaviours here changed with #1475, both of them bugs:
 *
 *   * `per_user_limit = 0` used to mean unlimited, because the guard was a
 *     truthiness test. Zero is a legal value with an obvious meaning and it is
 *     now honoured; NULL is what means unlimited.
 *   * `count > 0 && per_user_limit` short-circuited before comparing, so the
 *     comparison only ran for a user who had already used the code -- which is
 *     harmless but was doing no work, and hid how little the function was
 *     consulted.
 *
 * @param {string} promoCode
 * @param {string} userId
 * @param {object} [connection] Runs on the caller's transaction when supplied.
 * @returns {Promise<{eligible: boolean, reason?: string}>}
 */
const checkPromoEligibility = async (promoCode, userId, connection = db) => {
    try {
        const promo = await getPromoByCode(promoCode);
        if (!promo) {
            return { eligible: false, reason: "Promo code not found" };
        }

        return await checkEligibilityForRow(promo, userId, connection);
    } catch (error) {
        console.error("Promo eligibility check error:", error);
        return { eligible: false, reason: "Failed to check eligibility" };
    }
};

const getPromoUsageStats = async (promoCode) => {
    try {
        const [results] = await db.query(
            `SELECT 
                COUNT(*) as total_uses,
                SUM(discount_amount) as total_discount,
                COUNT(DISTINCT user_id) as unique_users,
                DATE_FORMAT(MAX(applied_at), '%Y-%m-%d %H:%i:%s') as last_used
             FROM promo_usage_logs 
             WHERE promo_code = ?`,
            [promoCode]
        );

        const redisCount = parseInt(await redis.get(getPromoUsageKey(promoCode)) || '0');

        return {
            promoCode,
            totalUses: results[0].total_uses || 0,
            totalDiscount: results[0].total_discount || 0,
            uniqueUsers: results[0].unique_users || 0,
            lastUsed: results[0].last_used || null,
            redisCounter: redisCount
        };
    } catch (error) {
        console.error("Promo usage stats error:", error);
        return null;
    }
};

const resetPromoUsage = async (promoCode) => {
    try {
        await redis.del(getPromoUsageKey(promoCode));
        await db.query("UPDATE promo_codes SET usage_count = 0 WHERE code = ?", [promoCode]);
        return { success: true };
    } catch (error) {
        console.error("Reset promo usage error:", error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    getPromoByCode,
    getUsedCount,
    validatePromo,
    calculateDiscount,
    applyPromoTransaction,
    checkPromoEligibility,
    checkEligibilityForRow,
    countUserUsage,
    parsePerUserLimit,
    parseEligibleUsers,
    refreshUsageCounter,
    getPromoUsageStats,
    resetPromoUsage,
    getPromoUsageKey,
    GUEST_USER_ID
};