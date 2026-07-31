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
 * Parse a value that must be a whole number, returning `null` when it is not.
 *
 * `parseInt` is deliberately avoided: it turns "10abc" into 10 and "abc" into
 * NaN, and NaN then flowed all the way into a SQL LIMIT. Every endpoint here
 * previously forwarded raw query/body values straight to the service, so
 * `?limit=abc` reached MySQL and `{ points: -3 }` reached the ledger (#1341).
 *
 * @param {*} value
 * @returns {number|null}
 */
function toInteger(value) {
    if (value === undefined || value === null || value === '') return null;
    const asNumber = Number(value);
    return Number.isInteger(asNumber) ? asNumber : null;
}

/**
 * Validate the `limit`/`offset` pair shared by the paginated endpoints.
 *
 * @returns {{ok: true, value: {limit: number, offset: number}}|{ok: false, error: string}}
 */
function parsePagination(query) {
    const limit = query.limit === undefined ? 50 : toInteger(query.limit);
    const offset = query.offset === undefined ? 0 : toInteger(query.offset);

    if (limit === null || limit < 1 || limit > 500) {
        return { ok: false, error: 'limit must be an integer between 1 and 500' };
    }
    if (offset === null || offset < 0) {
        return { ok: false, error: 'offset must be an integer of 0 or more' };
    }

    return { ok: true, value: { limit, offset } };
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
        const pagination = parsePagination(req.query);
        if (!pagination.ok) {
            return res.status(400).json({ success: false, error: pagination.error });
        }

        const history = await loyaltyService.getHistory(resolveUserId(req), pagination.value);
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

        // Redeeming a negative or fractional number of points is nonsense, and
        // a negative value would have been written to the ledger as a *credit*.
        // Reject before the service is called at all.
        const redeemPoints = toInteger(points);
        if (redeemPoints === null || redeemPoints <= 0) {
            return res
                .status(400)
                .json({ success: false, error: 'points must be a positive integer' });
        }

        const result = await loyaltyService.redeem(resolveUserId(req), {
            points: redeemPoints,
            reason
        });
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

        // An adjustment is signed -- admins correct in both directions -- so
        // zero and fractions are the only invalid values here.
        const adjustPoints = toInteger(points);
        if (adjustPoints === null || adjustPoints === 0) {
            return res.status(400).json({
                success: false,
                error: 'points must be a non-zero integer'
            });
        }

        const result = await loyaltyService.adjust(userId, { points: adjustPoints, reason });
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Adjust loyalty points error:', error);
        res.status(400).json({ success: false, error: error.message || 'Failed to adjust points' });
    }
});

module.exports = router;
