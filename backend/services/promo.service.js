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

const validatePromo = async (code, cartTotal) => {
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

const applyPromoTransaction = async (promoCode, userId, discountAmount) => {
    try {
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

            // Check usage limit with Redis counter for atomic increment
            const usageKey = getPromoUsageKey(promoCode);
            const usedCount = await getUsedCount(promoCode, promo);

            if (promo.usage_limit && usedCount >= promo.usage_limit) {
                throw new Error(`Promo code ${promoCode} usage limit reached`);
            }

            // Increment usage counter atomically in Redis
            const newCount = await redis.incr(usageKey);

            // If usage limit exceeded, rollback Redis counter
            if (promo.usage_limit && newCount > promo.usage_limit) {
                await redis.decr(usageKey);
                throw new Error(`Promo code ${promoCode} usage limit reached`);
            }

            const expiryDate = new Date(promo.expiry_date);
            const ttlSeconds = Math.floor((expiryDate - now) / 1000);
            if (ttlSeconds > 0) {
                await redis.expire(usageKey, ttlSeconds);
            }

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

        console.log(`[AUDIT] Promo ${promoCode} applied by user ${userId} - Discount: ${discountAmount}`);
        return true;

    } catch (error) {
        console.error(`Promo application error for ${promoCode}:`, error);
        throw error;
    }
};

const checkPromoEligibility = async (promoCode, userId) => {
    try {
        const promo = await getPromoByCode(promoCode);
        if (!promo) {
            return { eligible: false, reason: "Promo code not found" };
        }

        // Check user-specific eligibility
        if (promo.user_eligibility) {
            const eligibleUsers = JSON.parse(promo.user_eligibility);
            if (eligibleUsers.length > 0 && !eligibleUsers.includes(userId)) {
                return { eligible: false, reason: "This promo is not available for your account" };
            }
        }

        // Check if user has already used this promo
        const [usageResults] = await db.query(
            "SELECT COUNT(*) as count FROM promo_usage_logs WHERE promo_code = ? AND user_id = ?",
            [promoCode, userId]
        );
        
        if (usageResults[0].count > 0 && promo.per_user_limit) {
            if (usageResults[0].count >= promo.per_user_limit) {
                return { eligible: false, reason: "You have already used this promo the maximum number of times" };
            }
        }

        return { eligible: true };
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
    getPromoUsageStats,
    resetPromoUsage,
    getPromoUsageKey
};