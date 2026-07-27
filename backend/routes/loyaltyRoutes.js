// backend/routes/loyaltyRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { loyaltyService } = require('../services/loyaltyService');

/**
 * GET /api/loyalty/balance
 * Current user's points balance, lifetime total, and tier.
 */
router.get('/balance', authMiddleware, async (req, res) => {
    try {
        const balance = await loyaltyService.getBalance(req.user.id);

        res.json({
            success: true,
            data: balance
        });
    } catch (error) {
        console.error('Get loyalty balance error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get loyalty balance'
        });
    }
});

/**
 * GET /api/loyalty/history
 * Paginated ledger for the current user (?limit & ?offset).
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        const { limit, offset } = req.query;

        if (limit !== undefined && !isPositiveInteger(limit)) {
            return res.status(400).json({
                success: false,
                error: 'limit must be a positive integer'
            });
        }

        if (offset !== undefined && !isNonNegativeInteger(offset)) {
            return res.status(400).json({
                success: false,
                error: 'offset must be a non-negative integer'
            });
        }

        const history = await loyaltyService.getHistory(req.user.id, {
            limit: limit !== undefined ? parseInt(limit, 10) : undefined,
            offset: offset !== undefined ? parseInt(offset, 10) : undefined
        });

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Get loyalty history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get loyalty history'
        });
    }
});

/**
 * POST /api/loyalty/redeem
 * Redeem points for a discount. Body: { points }.
 */
router.post('/redeem', authMiddleware, async (req, res) => {
    try {
        const { points } = req.body || {};

        if (!Number.isInteger(points) || points <= 0) {
            return res.status(400).json({
                success: false,
                error: 'points must be a positive integer'
            });
        }

        const result = await loyaltyService.redeem(req.user.id, { points });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        if (error && error.code === 'INSUFFICIENT_POINTS') {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }

        console.error('Redeem loyalty points error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to redeem loyalty points'
        });
    }
});

function isPositiveInteger(value) {
    return /^\d+$/.test(String(value)) && parseInt(value, 10) > 0;
}

function isNonNegativeInteger(value) {
    return /^\d+$/.test(String(value)) && parseInt(value, 10) >= 0;
}

module.exports = router;
