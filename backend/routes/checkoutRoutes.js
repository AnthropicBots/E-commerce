const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { resolveOrderLines } = require('../services/order.service');
const { validatePromo } = require('../services/promo.service');
const pricing = require('../services/pricing.service');
const shipping = require('../services/shipping.service');
const { safeArray, sanitizeString } = require('../utils/helpers');
const authMiddleware = require('../middleware/authMiddleware');
const powChallengeService = require('../services/powChallengeService');

// Pricing only. Orders are created on the orders path, which is the one that
// resolves prices under lock, enforces stock and consumes inventory holds.
router.post('/quote', async (req, res) => {
    try {
        const { items, promoCode, couponCode, shippingMethod, destination } = req.body;
        const requestedItems = safeArray(items);

        // Nothing to price and nothing to deliver, so no options are offered
        // either: on an empty basket every one of them would read as free.
        if (!requestedItems.length) {
            return res.status(200).json({
                success: true,
                breakdown: pricing.quote({ items: [] })
            });
        }

        // Prices come from the database, never from the request body.
        const lines = await resolveOrderLines(db, requestedItems, {
            lockRows: false,
            enforceStock: false
        });

        const rawCode = couponCode || promoCode;
        const requestedCode = rawCode ? sanitizeString(rawCode) : '';
        let promo = null;
        let promoMessage = null;

        if (requestedCode) {
            const { subtotal } = pricing.priceLineItems(lines);
            const couponService = require('../services/couponService');
            const couponVal = await couponService.validateCoupon(requestedCode, subtotal);

            if (couponVal.valid) {
                promo = couponVal.coupon;
            } else {
                const validation = await validatePromo(requestedCode, subtotal);
                if (validation.valid) {
                    promo = validation.promo;
                } else {
                    // An unusable code must not fail the quote — the shopper still
                    // needs to see what the basket costs without it.
                    promoMessage = couponVal.message || validation.message;
                }
            }
        }

        // Every option is priced alongside the chosen one, so the shopper can
        // compare them without the browser doing any arithmetic and without a
        // second round trip per option.
        const { subtotal } = pricing.priceLineItems(lines);
        const discount = pricing.applyDiscount(promo, subtotal);

        const delivery = await shipping.quoteOptions({
            postDiscountSubtotal: subtotal - discount.amount,
            isShippingWaived: discount.isShippingWaived,
            selectedCode: shippingMethod,
            // A destination is optional: the cart page has no address yet, and
            // a basket still has to be priced there. Rules scoped to a place
            // simply do not match until one is known.
            destination: destination || null,
            weightKg: shipping.basketWeightKg(lines)
        });

        const breakdown = pricing.quote({
            items: lines,
            promo,
            promoCode: promo ? promo.code : null,
            shippingMethod: delivery.selected
        });

        return res.status(200).json({
            success: true,
            breakdown,
            shippingOptions: delivery.options,
            freeShipping: delivery.freeShipping,
            promoMessage
        });
    } catch (error) {
        console.error('Quote error:', error);
        return res.status(400).json({
            success: false,
            error: error.message || 'Could not price this basket'
        });
    }
});

// ==================== BOT-RESISTANT CHECKOUT CHALLENGE (#1396) ====================

/**
 * POST /api/checkout/challenge/issue
 * Issue a PoW puzzle bound to the checkout idempotency key.
 */
router.post('/challenge/issue', authMiddleware, async (req, res) => {
    try {
        const idempotencyKey = sanitizeString(
            req.body?.idempotencyKey ||
            req.get('Idempotency-Key') ||
            req.get('X-Idempotency-Key') ||
            ''
        );
        const riskScore = Number(req.body?.riskScore) || 0;
        const riskLevel = sanitizeString(req.body?.riskLevel || 'medium') || 'medium';

        const challenge = await powChallengeService.issueChallenge({
            idempotencyKey,
            userId: req.user.id,
            riskScore,
            riskLevel
        });

        return res.status(201).json({
            success: true,
            message: 'Checkout challenge issued',
            challenge
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            code: error.code || 'CHALLENGE_ISSUE_FAILED',
            message: error.message || 'Failed to issue challenge'
        });
    }
});

/**
 * POST /api/checkout/challenge/verify
 * Verify a PoW solution (or Private Access Token) and bind it to the key.
 */
router.post('/challenge/verify', authMiddleware, async (req, res) => {
    try {
        const idempotencyKey = sanitizeString(
            req.body?.idempotencyKey ||
            req.get('Idempotency-Key') ||
            ''
        );
        const pat = sanitizeString(
            req.body?.privateAccessToken ||
            req.body?.captchaToken ||
            req.get('X-Private-Access-Token') ||
            ''
        );

        if (pat) {
            const patResult = await powChallengeService.verifyPrivateAccessToken({
                token: pat,
                idempotencyKey,
                userId: req.user.id
            });
            if (!patResult.ok) {
                return res.status(400).json({
                    success: false,
                    code: 'PAT_INVALID',
                    message: 'Private access / CAPTCHA token was rejected'
                });
            }
            return res.status(200).json({
                success: true,
                message: 'Checkout challenge passed',
                method: patResult.method,
                idempotencyKey: patResult.idempotencyKey
            });
        }

        const result = await powChallengeService.verifyChallenge({
            challengeId: sanitizeString(req.body?.challengeId || ''),
            nonce: sanitizeString(req.body?.nonce || req.body?.challengeNonce || ''),
            idempotencyKey,
            userId: req.user.id
        });

        return res.status(200).json({
            success: true,
            message: 'Checkout challenge passed',
            ...result
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            code: error.code || 'CHALLENGE_VERIFY_FAILED',
            message: error.message || 'Failed to verify challenge'
        });
    }
});

/**
 * GET /api/checkout/challenge/metrics
 * Challenge issued / failed / passed counters (admin-friendly; auth required).
 */
router.get('/challenge/metrics', authMiddleware, async (req, res) => {
    try {
        const role = req.user?.role;
        if (role !== 'admin' && role !== 'superadmin' && role !== 'support') {
            return res.status(403).json({
                success: false,
                message: 'Admin or support role required'
            });
        }
        const metrics = await powChallengeService.getMetrics();
        return res.status(200).json({
            success: true,
            metrics
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to load challenge metrics'
        });
    }
});

module.exports = router;
