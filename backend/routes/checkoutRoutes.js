const express = require('express');
const router = express.Router();
const { sanitizeString } = require('../utils/helpers');
const authMiddleware = require('../middleware/authMiddleware');
const powChallengeService = require('../services/powChallengeService');
const checkoutController = require('../controllers/checkoutController');

// Pricing + mid-session FX lock (#1392). Orders still settle on the orders path.
router.post('/quote', checkoutController.quoteCheckout);

// ==================== FX LOCK (#1392) ====================
router.get('/fx/rates', checkoutController.getFxRates);
router.post('/fx/lock', checkoutController.lockFxRate);
router.post('/fx/validate', checkoutController.validateFxLock);

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
