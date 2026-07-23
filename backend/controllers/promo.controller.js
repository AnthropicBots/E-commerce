const { validatePromo, calculateDiscount, getPromoByCode } = require("../services/promo.service");
const { safeNumber, sanitizeString } = require("../utils/helpers");
const NodeCache = require('node-cache');

const config = {
    rateLimitWindow: parseInt(process.env.PROMO_RATE_LIMIT_WINDOW) || 60000,
    maxRequests: parseInt(process.env.PROMO_MAX_REQUESTS) || 10,
    cacheTTL: parseInt(process.env.PROMO_CACHE_TTL) || 300000,
    maxDiscountPercent: parseFloat(process.env.PROMO_MAX_DISCOUNT_PERCENT) || 90,
    maxStackable: parseInt(process.env.PROMO_MAX_STACKABLE) || 3,
    caseInsensitive: process.env.PROMO_CASE_INSENSITIVE !== 'false'
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

const validatePromoCode = async (req, res) => {
    try {
        let promoCode = sanitizeString(req.body.promoCode);
        const cartTotal = safeNumber(req.body.cartTotal);
        const userId = req.user ? req.user.id : 'guest';

        const rateKey = `promo_${userId}`;
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

        const cacheKey = `promo_${promoCode}`;
        const cached = promoCache.get(cacheKey);
        if (cached) {
            // Only return cached success responses, not errors
            if (cached.valid === false) {
                return res.status(404).json({ success: false, message: cached.message });
            }
            return res.status(200).json({ success: true, data: cached, cached: true });
        }

        const promo = await getPromoByCode(promoCode);
        if (!promo) {
            // Do NOT cache negative results - only cache successful validations
            return res.status(404).json({ success: false, message: "Promo code not found" });
        }

        if (!validateDiscount(promo.discount_value, promo.discount_type)) {
            // Do NOT cache negative results
            return res.status(400).json({ success: false, message: "Invalid discount value" });
        }

        const validation = await validatePromo(promoCode, cartTotal);
        if (!validation.valid) {
            // Do NOT cache negative results
            return res.status(400).json({ success: false, message: validation.message });
        }

        const discount = calculateDiscount(validation.promo, cartTotal);
        const maxAllowedDiscount = calculateMaxDiscount(
            cartTotal,
            validation.promo.discount_type,
            validation.promo.discount_value
        );
        const finalDiscount = Math.min(discount, maxAllowedDiscount);
        const finalAmount = Number((cartTotal - finalDiscount).toFixed(2));

        const expiresAt = validation.promo.expires_at;
        const isExpiringSoon = expiresAt && (new Date(expiresAt) - new Date()) < 7 * 24 * 60 * 60 * 1000;

        const promoData = {
            promoCode: validation.promo.code,
            discountType: validation.promo.discount_type || 'percentage',
            discountValue: validation.promo.discount_value || 0,
            maxDiscount: validation.promo.max_discount || null,
            minCartValue: validation.promo.min_cart_value || 0,
            expiresAt: validation.promo.expires_at || null,
            usageLimit: validation.promo.usage_limit || null,
            usedCount: validation.promo.used_count || 0,
            remainingUses: validation.promo.usage_limit ? (validation.promo.usage_limit - (validation.promo.used_count || 0)) : null,
            valid: true,
            discount: finalDiscount,
            finalAmount: finalAmount,
            isExpiringSoon: isExpiringSoon,
            isStackable: validation.promo.is_stackable !== false,
            maxStack: validation.promo.max_stack || 1
        };

        promoCache.set(cacheKey, promoData);

        console.log(`[AUDIT] Promo ${promoCode} validated by user ${userId} - Discount: ${finalDiscount}`);

        return res.status(200).json({ success: true, data: promoData, cached: false });

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

        const results = [];
        for (const code of promoCodes) {
            const normalizedCode = normalizePromoCode(code);
            if (!validatePromoFormat(normalizedCode)) {
                results.push({ promoCode: code, valid: false, message: "Invalid promo code format" });
                continue;
            }

            const promo = await getPromoByCode(normalizedCode);
            if (!promo) {
                results.push({ promoCode: code, valid: false, message: "Promo code not found" });
                continue;
            }

            const validation = await validatePromo(normalizedCode, total);
            if (!validation.valid) {
                results.push({ promoCode: code, valid: false, message: validation.message });
                continue;
            }

            results.push({ promoCode: code, valid: true, message: "Promo code is valid" });
        }

        console.log(`[AUDIT] Multiple promos validated by user ${userId}: ${promoCodes.join(', ')}`);

        return res.status(200).json({ success: true, data: { promos: results, total: results.length } });

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
        const { promoCodes, cartTotal } = req.body;
        const userId = req.user ? req.user.id : 'guest';

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

        const normalizedCodes = promoCodes.map(code => normalizePromoCode(code));
        const uniqueCodes = new Set(normalizedCodes);
        if (uniqueCodes.size !== normalizedCodes.length) {
            return res.status(400).json({ success: false, message: "Duplicate promo codes are not allowed" });
        }

        const results = [];
        let remainingTotal = total;
        let totalDiscount = 0;

        const promos = await Promise.all(normalizedCodes.map(code => getPromoByCode(code)));

        for (let i = 0; i < promos.length; i++) {
            if (!promos[i]) {
                return res.status(404).json({ success: false, message: `Promo code not found: ${normalizedCodes[i]}` });
            }
        }

        const stackable = promos.every(p => p.is_stackable !== false);
        if (!stackable) {
            return res.status(400).json({ success: false, message: "Some promos cannot be stacked together" });
        }

        for (let i = 0; i < promos.length; i++) {
            const promo = promos[i];
            const code = normalizedCodes[i];

            const validation = await validatePromo(code, remainingTotal);
            if (!validation.valid) {
                results.push({ promoCode: code, valid: false, message: validation.message });
                continue;
            }

            const discount = calculateDiscount(promo, remainingTotal);
            const maxAllowedDiscount = calculateMaxDiscount(remainingTotal, promo.discount_type, promo.discount_value);
            const finalDiscount = Math.min(discount, maxAllowedDiscount);
            const discountApplied = Number(finalDiscount.toFixed(2));

            remainingTotal = Number((remainingTotal - discountApplied).toFixed(2));
            totalDiscount = Number((totalDiscount + discountApplied).toFixed(2));

            results.push({
                promoCode: code,
                valid: true,
                discountApplied: discountApplied,
                remainingTotal: remainingTotal,
                message: "Promo applied successfully"
            });
        }

        console.log(`[AUDIT] Multiple promos applied by user ${userId}: ${normalizedCodes.join(', ')} - Final: ${remainingTotal}`);

        return res.status(200).json({
            success: true,
            data: {
                originalTotal: total,
                finalTotal: remainingTotal,
                totalDiscount: totalDiscount,
                appliedPromos: results
            }
        });

    } catch (error) {
        console.error("APPLY MULTIPLE PROMOS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to apply multiple promo codes",
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

        console.log(`[AUDIT] Promo details requested for ${promoCode} by user ${userId}`);

        return res.status(200).json({
            success: true,
            data: {
                code: promo.code,
                discountType: promo.discount_type,
                discountValue: promo.discount_value,
                maxDiscount: promo.max_discount,
                minCartValue: promo.min_cart_value,
                expiresAt: promo.expires_at,
                usageLimit: promo.usage_limit,
                usedCount: promo.used_count,
                remainingUses: promo.usage_limit ? (promo.usage_limit - (promo.used_count || 0)) : null,
                isStackable: promo.is_stackable !== false,
                status: promo.status || 'active'
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
        if (req.user.role !== 'admin') {
            console.log(`[AUDIT] Unauthorized cache clear attempt by user ${req.user.id}`);
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

module.exports = {
    validatePromoCode,
    validateMultiplePromos,
    applyMultiplePromos,
    getPromoDetails,
    clearPromoCache
};