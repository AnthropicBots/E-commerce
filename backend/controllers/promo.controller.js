
const { validatePromo, calculateDiscount, getPromoByCode, applyPromoTransaction } = require("../services/promo.service");
const { safeNumber, sanitizeString } = require("../utils/helpers");
const NodeCache = require('node-cache');
const Redis = require('ioredis');
const crypto = require('crypto');

const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3
});

const config = {
    rateLimitWindow: parseInt(process.env.PROMO_RATE_LIMIT_WINDOW) || 60000,
    maxRequests: parseInt(process.env.PROMO_MAX_REQUESTS) || 10,
    cacheTTL: parseInt(process.env.PROMO_CACHE_TTL) || 300000,
    maxDiscountPercent: parseFloat(process.env.PROMO_MAX_DISCOUNT_PERCENT) || 90,
    maxStackable: parseInt(process.env.PROMO_MAX_STACKABLE) || 3,
    caseInsensitive: process.env.PROMO_CASE_INSENSITIVE !== 'false',
    lockTTL: parseInt(process.env.PROMO_LOCK_TTL) || 30000, // 30 seconds
    lockRetryDelay: parseInt(process.env.PROMO_LOCK_RETRY_DELAY) || 100,
    lockMaxRetries: parseInt(process.env.PROMO_LOCK_MAX_RETRIES) || 50
};

const rateLimiter = new Map();
const promoCache = new NodeCache({ stdTTL: config.cacheTTL / 1000, checkperiod: 60 });

function normalizePromoCode(promoCode) {
    return config.caseInsensitive ? promoCode.toUpperCase() : promoCode;
}

function validatePromoFormat(promoCode) {
    const regex = /^[A-Za-z0-9\-_]{3,30}$/;
    return regex.test(promoCode);
}

function validateDiscount(discount, discountType) {
    if (discount === null || discount === undefined) return false;
    if (typeof discount !== 'number') return false;
    if (discount <= 0) return false;
    if (discountType === 'percentage' && discount > 100) return false;
    if (discountType === 'fixed' && discount > 10000) return false;
    return true;
}

function calculateMaxDiscount(cartTotal, discountType, discountValue) {
    if (discountType === 'percentage') {
        const maxAllowed = cartTotal * (config.maxDiscountPercent / 100);
        const calculated = (cartTotal * discountValue) / 100;
        return Math.min(calculated, maxAllowed);
    }
    return Math.min(discountValue, cartTotal * (config.maxDiscountPercent / 100));
}

function getCartLockKey(userId, sessionId) {
    return `lock:cart:${userId}:${sessionId || 'default'}`;
}

function getPromoUsageKey(promoCode) {
    return `promo:usage:${promoCode}`;
}

async function acquireLock(lockKey, ttl = config.lockTTL) {
    const lockValue = crypto.randomBytes(16).toString('hex');
    try {
        const result = await redis.set(lockKey, lockValue, 'NX', 'PX', ttl);
        if (result === 'OK') {
            return lockValue;
        }
        return null;
    } catch (error) {
        console.error('Lock acquire error:', error);
        return null;
    }
}

async function releaseLock(lockKey, lockValue) {
    try {
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        const result = await redis.eval(script, 1, lockKey, lockValue);
        return result === 1;
    } catch (error) {
        console.error('Lock release error:', error);
        return false;
    }
}

async function withLock(lockKey, fn, maxRetries = config.lockMaxRetries) {
    let retries = 0;
    let lockValue = null;

    while (retries < maxRetries) {
        lockValue = await acquireLock(lockKey);
        if (lockValue) {
            try {
                const result = await fn();
                return result;
            } finally {
                await releaseLock(lockKey, lockValue);
            }
        }

        retries++;
        const delay = Math.min(config.lockRetryDelay * Math.pow(2, retries), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    throw new Error(`Failed to acquire lock after ${maxRetries} attempts`);
}

async function checkStackableConflicts(promoCode, existingPromoCodes) {
    const promo = await getPromoByCode(promoCode);
    if (!promo) return { stackable: false, reason: 'Promo not found' };

    // Check if promo is stackable
    if (promo.is_stackable === false) {
        return { stackable: false, reason: `${promoCode} is not stackable with other promos` };
    }

    // Check exclusivity conflicts
    if (promo.exclusive_category) {
        for (const existing of existingPromoCodes) {
            const existingPromo = await getPromoByCode(existing);
            if (existingPromo && existingPromo.exclusive_category === promo.exclusive_category) {
                return { 
                    stackable: false, 
                    reason: `${promoCode} conflicts with ${existing} (same exclusive category)` 
                };
            }
        }
    }

    // Check promotional campaign conflicts
    if (promo.campaign_id) {
        for (const existing of existingPromoCodes) {
            const existingPromo = await getPromoByCode(existing);
            if (existingPromo && existingPromo.campaign_id === promo.campaign_id) {
                return { 
                    stackable: false, 
                    reason: `${promoCode} conflicts with ${existing} (same campaign)` 
                };
            }
        }
    }

    // Check max stack limit
    if (existingPromoCodes.length >= config.maxStackable) {
        return { stackable: false, reason: `Maximum ${config.maxStackable} promos can be stacked` };
    }

    return { stackable: true };
}

const validatePromoCode = async (req, res) => {
    try {
        let promoCode = sanitizeString(req.body.promoCode);
        const cartTotal = safeNumber(req.body.cartTotal);
        const userId = req.user ? req.user.id : 'guest';
        const sessionId = req.body.sessionId || req.headers['x-session-id'] || 'default';

        const rateKey = `promo_rate_${userId}`;
        const now = Date.now();
        if (!rateLimiter.has(rateKey)) {
            rateLimiter.set(rateKey, [now]);
        } else {
            const requests = rateLimiter.get(rateKey).filter(time => now - time < config.rateLimitWindow);
            if (requests.length >= config.maxRequests) {
                return res.status(429).json({
                    success: false,
                    message: "Too many promo validation requests. Please try again later."
                });
            }
            requests.push(now);
            rateLimiter.set(rateKey, requests);
        }

        if (!promoCode) {
            return res.status(400).json({ success: false, message: "Promo code is required" });
        }

        promoCode = normalizePromoCode(promoCode);

        if (!validatePromoFormat(promoCode)) {
            return res.status(400).json({
                success: false,
                message: "Invalid promo code format. Use 3-30 alphanumeric characters, hyphens, or underscores"
            });
        }

        if (cartTotal === null || cartTotal <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid cart total. Must be a positive number"
            });
        }

        // Check cache
        const cacheKey = `promo_${promoCode}`;
        let promo = promoCache.get(cacheKey);
        let fromCache = true;

        if (!promo) {
            fromCache = false;
            promo = await getPromoByCode(promoCode);
            if (!promo) {
                return res.status(404).json({ success: false, message: "Promo code not found" });
            }

            if (!validateDiscount(Number(promo.discount_value), promo.discount_type)) {
                return res.status(400).json({ success: false, message: "Invalid discount value" });
            }

            promoCache.set(cacheKey, promo);
        }

        // Validate promo status
        if (!promo.is_active) {
            return res.status(400).json({ success: false, message: "Promo code is inactive" });
        }

        const currentDate = new Date();
        if (new Date(promo.start_date) > currentDate) {
            return res.status(400).json({ success: false, message: "Promo code is not yet active" });
        }

        if (new Date(promo.expiry_date) < currentDate) {
            return res.status(400).json({ success: false, message: "Promo code has expired" });
        }

        if (safeNumber(cartTotal) < safeNumber(promo.minimum_order_amount)) {
            return res.status(400).json({
                success: false,
                message: `Minimum order amount of ₹${promo.minimum_order_amount} required`
            });
        }

        const usageKey = getPromoUsageKey(promoCode);
        const usedCount = parseInt(await redis.get(usageKey) || '0');
        if (promo.usage_limit && usedCount >= promo.usage_limit) {
            return res.status(400).json({
                success: false,
                message: "Promo code usage limit has been reached"
            });
        }

        // Calculate discount
        const discount = calculateDiscount(promo, cartTotal);
        const maxAllowedDiscount = calculateMaxDiscount(
            cartTotal,
            promo.discount_type,
            promo.discount_value
        );
        const finalDiscount = Math.min(discount, maxAllowedDiscount);
        const finalAmount = Number((cartTotal - finalDiscount).toFixed(2));

        const expiresAt = promo.expiry_date;
        const isExpiringSoon = expiresAt && (new Date(expiresAt) - new Date()) < 7 * 24 * 60 * 60 * 1000;

        const promoData = {
            promoCode: promo.code,
            discountType: promo.discount_type || 'percentage',
            discountValue: promo.discount_value || 0,
            maxDiscount: promo.maximum_discount || null,
            minCartValue: promo.minimum_order_amount || 0,
            expiresAt: promo.expiry_date || null,
            usageLimit: promo.usage_limit || null,
            usedCount: usedCount,
            remainingUses: promo.usage_limit ? (promo.usage_limit - usedCount) : null,
            valid: true,
            discount: finalDiscount,
            finalAmount: finalAmount,
            isExpiringSoon: isExpiringSoon,
            isStackable: promo.is_stackable !== false,
            maxStack: promo.max_stack || 1,
            exclusiveCategory: promo.exclusive_category || null
        };

        console.log(`[AUDIT] Promo ${promoCode} validated by user ${userId} - Discount: ${finalDiscount} (Cached: ${fromCache})`);

        return res.status(200).json({ success: true, data: promoData, cached: fromCache });

    } catch (error) {
        console.error("PROMO VALIDATION ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to validate promo code",
        });
    }
};

const validateMultiplePromos = async (req, res) => {
    try {
        const { promoCodes, cartTotal } = req.body;
        const userId = req.user ? req.user.id : 'guest';
        const sessionId = req.body.sessionId || req.headers['x-session-id'] || 'default';

        if (!promoCodes || !Array.isArray(promoCodes) || promoCodes.length === 0) {
            return res.status(400).json({ success: false, message: "At least one promo code is required" });
        }

        if (promoCodes.length > 20) {
            return res.status(400).json({ success: false, message: "Maximum 20 promo codes allowed per request" });
        }

        const total = safeNumber(cartTotal);
        if (total === null || total <= 0) {
            return res.status(400).json({ success: false, message: "Invalid cart total" });
        }

        const lockKey = getCartLockKey(userId, sessionId);
        const results = await withLock(lockKey, async () => {
            const promoResults = [];
            const validatedPromos = [];

            for (const code of promoCodes) {
                const normalizedCode = normalizePromoCode(code);
                if (!validatePromoFormat(normalizedCode)) {
                    promoResults.push({ promoCode: code, valid: false, message: "Invalid promo code format" });
                    continue;
                }

                const promo = await getPromoByCode(normalizedCode);
                if (!promo) {
                    promoResults.push({ promoCode: code, valid: false, message: "Promo code not found" });
                    continue;
                }

                // Check usage limit
                const usageKey = getPromoUsageKey(normalizedCode);
                const usedCount = parseInt(await redis.get(usageKey) || '0');
                if (promo.usage_limit && usedCount >= promo.usage_limit) {
                    promoResults.push({ 
                        promoCode: code, 
                        valid: false, 
                        message: "Promo code usage limit reached" 
                    });
                    continue;
                }

                const validation = await validatePromo(normalizedCode, total);
                if (!validation.valid) {
                    promoResults.push({ promoCode: code, valid: false, message: validation.message });
                    continue;
                }

                const stackCheck = await checkStackableConflicts(
                    normalizedCode, 
                    validatedPromos.map(p => p.code)
                );
                if (!stackCheck.stackable) {
                    promoResults.push({ 
                        promoCode: code, 
                        valid: false, 
                        message: stackCheck.reason 
                    });
                    continue;
                }

                validatedPromos.push(promo);
                promoResults.push({ 
                    promoCode: code, 
                    valid: true, 
                    message: "Promo code is valid" 
                });
            }

            return { promos: promoResults, total: promoResults.length, validatedCount: validatedPromos.length };
        });

        console.log(`[AUDIT] Multiple promos validated by user ${userId}: ${promoCodes.join(', ')}`);

        return res.status(200).json({ success: true, data: results });

    } catch (error) {
        console.error("BULK PROMO VALIDATION ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to validate promo codes"
        });
    }
};

const applyMultiplePromos = async (req, res) => {
    try {
        const { promoCodes, cartTotal, sessionId: bodySessionId } = req.body;
        const userId = req.user ? req.user.id : 'guest';
        const sessionId = bodySessionId || req.headers['x-session-id'] || crypto.randomBytes(8).toString('hex');

        if (!promoCodes || !Array.isArray(promoCodes) || promoCodes.length === 0) {
            return res.status(400).json({ success: false, message: "At least one promo code is required" });
        }

        if (promoCodes.length > config.maxStackable) {
            return res.status(400).json({
                success: false,
                message: `Maximum ${config.maxStackable} promo codes allowed`
            });
        }

        const total = safeNumber(cartTotal);
        if (total === null || total <= 0) {
            return res.status(400).json({ success: false, message: "Invalid cart total" });
        }

        // Normalize and deduplicate
        const normalizedCodes = promoCodes.map(code => normalizePromoCode(code));
        const uniqueCodes = [...new Set(normalizedCodes)];
        if (uniqueCodes.length !== normalizedCodes.length) {
            return res.status(400).json({ success: false, message: "Duplicate promo codes are not allowed" });
        }

        const lockKey = getCartLockKey(userId, sessionId);
        const result = await withLock(lockKey, async () => {
            // Fetch all promos in one go
            const promos = await Promise.all(uniqueCodes.map(code => getPromoByCode(code)));
            
            // Check all promos exist
            const missingIndex = promos.findIndex(p => !p);
            if (missingIndex !== -1) {
                throw new Error(`Promo code not found: ${uniqueCodes[missingIndex]}`);
            }

            const nonStackable = promos.filter(p => p.is_stackable === false);
            if (nonStackable.length > 0) {
                throw new Error(`Promo codes ${nonStackable.map(p => p.code).join(', ')} cannot be stacked`);
            }

            // Check exclusivity conflicts
            const exclusiveGroups = new Map();
            for (const promo of promos) {
                if (promo.exclusive_category) {
                    if (exclusiveGroups.has(promo.exclusive_category)) {
                        throw new Error(
                            `Conflicting promos in exclusive category: ${promo.exclusive_category}`
                        );
                    }
                    exclusiveGroups.set(promo.exclusive_category, promo.code);
                }
            }

            // Check campaign conflicts
            const campaignGroups = new Map();
            for (const promo of promos) {
                if (promo.campaign_id) {
                    if (campaignGroups.has(promo.campaign_id)) {
                        throw new Error(
                            `Conflicting promos from same campaign: ${promo.campaign_id}`
                        );
                    }
                    campaignGroups.set(promo.campaign_id, promo.code);
                }
            }

            // Transactional verification and application
            const results = [];
            let remainingTotal = total;
            let totalDiscount = 0;
            const appliedPromos = [];

            const sortedPromos = [...promos].sort((a, b) => (a.priority || 0) - (b.priority || 0));

            for (const promo of sortedPromos) {
                // Check usage limit atomically
                const usageKey = getPromoUsageKey(promo.code);
                const usedCount = parseInt(await redis.get(usageKey) || '0');
                
                if (promo.usage_limit && usedCount >= promo.usage_limit) {
                    results.push({
                        promoCode: promo.code,
                        valid: false,
                        message: "Promo code usage limit reached",
                        discountApplied: 0
                    });
                    continue;
                }

                // Validate promo against current remaining total
                const validation = await validatePromo(promo.code, remainingTotal);
                if (!validation.valid) {
                    results.push({
                        promoCode: promo.code,
                        valid: false,
                        message: validation.message,
                        discountApplied: 0
                    });
                    continue;
                }

                // Calculate discount
                const discount = calculateDiscount(promo, remainingTotal);
                const maxAllowedDiscount = calculateMaxDiscount(
                    remainingTotal,
                    promo.discount_type,
                    promo.discount_value
                );
                const finalDiscount = Math.min(discount, maxAllowedDiscount);
                const discountApplied = Number(finalDiscount.toFixed(2));

                // Apply promo atomically
                const applied = await applyPromoTransaction(promo.code, userId, discountApplied);
                if (!applied) {
                    results.push({
                        promoCode: promo.code,
                        valid: false,
                        message: "Failed to apply promo",
                        discountApplied: 0
                    });
                    continue;
                }

                remainingTotal = Number((remainingTotal - discountApplied).toFixed(2));
                totalDiscount = Number((totalDiscount + discountApplied).toFixed(2));
                appliedPromos.push(promo.code);

                results.push({
                    promoCode: promo.code,
                    valid: true,
                    discountApplied: discountApplied,
                    remainingTotal: remainingTotal,
                    message: "Promo applied successfully"
                });
            }

            // Update cart in database with atomic transaction
            await db.query(
                `UPDATE carts 
                 SET promo_codes = ?, 
                     discount_total = ?, 
                     final_total = ?,
                     updated_at = NOW()
                 WHERE user_id = ? AND session_id = ?`,
                [JSON.stringify(appliedPromos), totalDiscount, remainingTotal, userId, sessionId]
            );

            return {
                originalTotal: total,
                finalTotal: remainingTotal,
                totalDiscount: totalDiscount,
                appliedPromos: results,
                appliedCodes: appliedPromos
            };
        });

        console.log(`[AUDIT] Promos applied by user ${userId}: ${result.appliedCodes.join(', ')} - Final: ${result.finalTotal}`);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("APPLY MULTIPLE PROMOS ERROR:", error);
        
        // Handle lock errors
        if (error.message.includes('Failed to acquire lock')) {
            return res.status(409).json({
                success: false,
                message: "Cart is currently being processed. Please try again.",
                error: "CONCURRENT_MODIFICATION"
            });
        }

        return res.status(500).json({
            success: false,
            message: error.message || "Failed to apply promo codes",
        });
    }
};

const getPromoDetails = async (req, res) => {
    try {
        const promoCode = normalizePromoCode(req.params.promoCode);
        const userId = req.user ? req.user.id : 'guest';

        if (!validatePromoFormat(promoCode)) {
            return res.status(400).json({ success: false, message: "Invalid promo code format" });
        }

        const promo = await getPromoByCode(promoCode);
        if (!promo) {
            return res.status(404).json({ success: false, message: "Promo code not found" });
        }

        // Get current usage count from Redis
        const usageKey = getPromoUsageKey(promoCode);
        const usedCount = parseInt(await redis.get(usageKey) || '0');

        console.log(`[AUDIT] Promo details requested for ${promoCode} by user ${userId}`);

        return res.status(200).json({
            success: true,
            data: {
                code: promo.code,
                discountType: promo.discount_type,
                discountValue: promo.discount_value,
                maxDiscount: promo.maximum_discount,
                minCartValue: promo.minimum_order_amount,
                expiresAt: promo.expiry_date,
                usageLimit: promo.usage_limit,
                usedCount: usedCount,
                remainingUses: promo.usage_limit ? (promo.usage_limit - usedCount) : null,
                isStackable: promo.is_stackable !== false,
                exclusiveCategory: promo.exclusive_category || null,
                campaignId: promo.campaign_id || null,
                status: promo.is_active ? 'active' : 'inactive',
                priority: promo.priority || 0
            }
        });

    } catch (error) {
        console.error("GET PROMO DETAILS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to get promo details",
        });
    }
};

const clearPromoCache = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            console.log(`[AUDIT] Unauthorized cache clear attempt by user ${req.user?.id || 'unknown'}`);
            return res.status(403).json({ success: false, message: "Unauthorized: Only admins can clear promo cache" });
        }

        const cacheSize = promoCache.keys().length;
        promoCache.flushAll();
        rateLimiter.clear();

        console.log(`[AUDIT] Admin ${req.user.id} cleared promo cache (${cacheSize} entries)`);

        return res.status(200).json({
            success: true,
            message: `Promo cache cleared successfully (${cacheSize} entries removed)`
        });

    } catch (error) {
        console.error("CLEAR PROMO CACHE ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to clear promo cache" });
    }
};

const getCartLockStatus = async (req, res) => {
    try {
        const userId = req.user ? req.user.id : 'guest';
        const sessionId = req.query.sessionId || req.headers['x-session-id'] || 'default';
        const lockKey = getCartLockKey(userId, sessionId);
        
        const lockValue = await redis.get(lockKey);
        
        return res.status(200).json({
            success: true,
            data: {
                isLocked: !!lockValue,
                lockKey: lockKey,
                userId: userId,
                sessionId: sessionId
            }
        });
    } catch (error) {
        console.error("GET CART LOCK STATUS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to get cart lock status"
        });
    }
};

module.exports = {
    validatePromoCode,
    validateMultiplePromos,
    applyMultiplePromos,
    getPromoDetails,
    clearPromoCache,
    getCartLockStatus
};