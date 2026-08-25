// backend/routes/stockAlertRoutes.js
//
// Authenticated user endpoints for managing back-in-stock / price-drop alert
// subscriptions (#1233). Thin handlers over stockAlertService; every route is
// scoped to the caller (req.user) so a user can only touch their own alerts.

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const stockAlertService = require("../services/stockAlertService");

// The JWT payload carries the id under either `id` or `userId` depending on
// which login path minted it; accept both so this route works for every token.
function resolveUserId(req) {
    return req.user && (req.user.id || req.user.userId);
}

// POST /api/stock-alerts — subscribe the caller to alerts for a product.
router.post("/", authMiddleware, async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { productId, alertType, referencePrice } = req.body || {};
    if (!productId || !alertType) {
        return res.status(400).json({
            success: false,
            message: "productId and alertType are required"
        });
    }

    try {
        const subscription = await stockAlertService.subscribe({
            userId,
            productId,
            alertType,
            referencePrice: referencePrice === undefined ? null : referencePrice
        });
        return res.status(201).json({ success: true, subscription });
    } catch (error) {
        // A subscription against a product no shopper may see is a 404, not a
        // 400: the request was well formed, the product simply is not there as
        // far as this caller is concerned (#1609). Same answer the product
        // detail endpoint gives, so a client cannot use this route to probe for
        // unreleased catalogue.
        if (error && error.code === "PRODUCT_NOT_VISIBLE") {
            return res.status(404).json({ success: false, message: error.message });
        }

        return res.status(400).json({ success: false, message: error.message });
    }
});

// DELETE /api/stock-alerts — soft-cancel one of the caller's subscriptions.
// productId and alertType identify which alert to drop.
router.delete("/", authMiddleware, async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { productId, alertType } = req.body || {};
    if (!productId || !alertType) {
        return res.status(400).json({
            success: false,
            message: "productId and alertType are required"
        });
    }

    try {
        const result = await stockAlertService.unsubscribe({ userId, productId, alertType });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
});

// GET /api/stock-alerts — list the caller's subscriptions, optionally filtered
// by ?alertType= and ?status=.
router.get("/", authMiddleware, async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
    }

    try {
        const subscriptions = await stockAlertService.listSubscriptions(userId, {
            alertType: req.query.alertType,
            status: req.query.status
        });
        return res.status(200).json({ success: true, subscriptions });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
});

module.exports = router;
