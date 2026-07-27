// backend/routes/loyaltyRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { adminMiddleware } = require('../middleware/rbacMiddleware');
const { loyaltyService } = require('../services/loyaltyService');

// authMiddleware attaches the decoded token (id or userId); adminMiddleware
// later replaces it with a full User model. Resolve either shape.
function resolveUserId(req) {
    return req.user?.id ?? req.user?.userId;
}

/**
 * GET /api/loyalty/balance
 * Current user's points balance, lifetime total, and tier.
 */
router.get('/balance', authMiddleware, async (req, res) => {
    try {
        const balance = await loyaltyService.getBalance(resolveUserId(req));
        res.json({ success: true, data: balance });
    } catch (error) {
        console.error('Get loyalty balance error:', error);
        res.status(500).json({ success: false, error: 'Failed to get balance' });
    }
});

/**
 * GET /api/loyalty/history
 * Current user's ledger history (newest first).
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        const { limit } = req.query;
        const history = await loyaltyService.getHistory(resolveUserId(req), limit);
        res.json({ success: true, data: history });
    } catch (error) {
        console.error('Get loyalty history error:', error);
        res.status(500).json({ success: false, error: 'Failed to get history' });
    }
});

/**
 * POST /api/loyalty/redeem
 * Redeem points for a discount. Body: { points, reason? }.
 */
router.post('/redeem', authMiddleware, async (req, res) => {
    try {
        const { points, reason } = req.body;
        if (points === undefined || points === null) {
            return res.status(400).json({ success: false, error: 'points is required' });
        }

        const result = await loyaltyService.redeem(resolveUserId(req), { points, reason });
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Redeem loyalty points error:', error);
        // Validation / insufficient-balance errors are client errors.
        res.status(400).json({ success: false, error: error.message || 'Failed to redeem points' });
    }
});

/**
 * GET /api/loyalty/tiers
 * The full tier ladder plus the current user's tier position.
 */
router.get('/tiers', authMiddleware, async (req, res) => {
    try {
        const tiers = loyaltyService.getTiers();
        const currentTier = await loyaltyService.getTier(resolveUserId(req));
        res.json({ success: true, data: { tiers, currentTier } });
    } catch (error) {
        console.error('Get loyalty tiers error:', error);
        res.status(500).json({ success: false, error: 'Failed to get tiers' });
    }
});

/**
 * POST /api/loyalty/admin/adjust
 * Admin-only manual points correction. Body: { userId, points, reason? }.
 */
router.post('/admin/adjust', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId, points, reason } = req.body;
        if (userId === undefined || userId === null) {
            return res.status(400).json({ success: false, error: 'userId is required' });
        }
        if (points === undefined || points === null) {
            return res.status(400).json({ success: false, error: 'points is required' });
        }

        const result = await loyaltyService.adjust(userId, { points, reason });
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Adjust loyalty points error:', error);
        res.status(400).json({ success: false, error: error.message || 'Failed to adjust points' });
    }
});

module.exports = router;
