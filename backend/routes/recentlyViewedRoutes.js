// backend/routes/recentlyViewedRoutes.js
//
// Mounted at /api/recently-viewed.
//
// These two routes, `services/recentlyViewedService.js` (453 lines) and the
// `recently_viewed` table have all existed for some time and no frontend file
// has ever referenced the path (#1497). The site kept its history in
// localStorage instead, so a signed-in shopper's history was per-browser, was
// lost when they cleared site data, and did not follow them to another device
// -- while the server-side store built for exactly that sat empty.
//
// frontend/scripts/recently-viewed-store.js is the first caller. Two things
// were fixed on the way to giving them one:
//
//   * the failure envelope used `error` where the rest of the API uses
//     `message` (AGENTS.md), so a client reading `response.message` on a
//     failure got undefined;
//   * `productId` was checked for presence and nothing else, so a malformed id
//     reached the service and came back as a 500.

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const recentlyViewedService = require('../services/recentlyViewedService');
const { safeUUID } = require('../utils/helpers');

/** The id on the token, under either of the two names login paths mint. */
function callerId(req) {
    return req.user && (req.user.id || req.user.userId);
}

/**
 * GET /api/recently-viewed
 * Get recently viewed products
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const viewed = await recentlyViewedService.getRecentlyViewed(callerId(req));

        res.json({
            success: true,
            message: 'Recently viewed products retrieved',
            data: viewed
        });
    } catch (error) {
        console.error('Get recently viewed error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get recently viewed'
        });
    }
});

/**
 * POST /api/recently-viewed
 * Add product to recently viewed
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        const productId = safeUUID(req.body?.productId);

        if (!productId) {
            // `products.id` is a CHAR(36) UUID. This used to check only that
            // the field was present, so anything else went to the service and
            // came back as a 500 -- a client mistake reported as a server
            // fault.
            return res.status(400).json({
                success: false,
                message: 'A valid product ID is required'
            });
        }

        const viewed = await recentlyViewedService.addViewed(callerId(req), productId);

        res.json({
            success: true,
            message: 'Recently viewed updated',
            data: viewed
        });
    } catch (error) {
        console.error('Add recently viewed error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add recently viewed'
        });
    }
});

module.exports = router;
