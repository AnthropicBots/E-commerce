/**
 * Wishlist price-drop preference center + unsubscribe (#1394).
 */

"use strict";

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const wishlistNotifyService = require("../services/wishlistNotifyService");
const { sanitizeString } = require("../utils/helpers");

/**
 * GET /api/wishlist-notify/preferences
 */
router.get("/preferences", authMiddleware, async (req, res) => {
    try {
        const preferences = await wishlistNotifyService.getPreferences(req.user.id);
        return res.status(200).json({
            success: true,
            preferences
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to load notification preferences"
        });
    }
});

/**
 * PUT /api/wishlist-notify/preferences
 * Body: { priceDropEmail?, priceDropInApp?, unsubscribedAll? }
 */
router.put("/preferences", authMiddleware, async (req, res) => {
    try {
        const preferences = await wishlistNotifyService.updatePreferences(req.user.id, {
            priceDropEmail: req.body?.priceDropEmail,
            priceDropInApp: req.body?.priceDropInApp,
            unsubscribedAll: req.body?.unsubscribedAll
        });
        return res.status(200).json({
            success: true,
            message: "Notification preferences updated",
            preferences
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to update preferences"
        });
    }
});

/**
 * POST /api/wishlist-notify/unsubscribe
 * Public — signed link from email. Body/query: { token }
 */
router.post("/unsubscribe", async (req, res) => {
    try {
        const token = sanitizeString(
            req.body?.token || req.query?.token || ""
        );
        const result = await wishlistNotifyService.unsubscribeWithToken(token);
        return res.status(200).json({
            success: true,
            message: "You have been unsubscribed from price-drop notifications",
            ...result
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            code: error.code || "UNSUBSCRIBE_FAILED",
            message: error.message || "Unsubscribe failed"
        });
    }
});

/**
 * POST /api/wishlist-notify/baselines/sync
 * Authenticated — ensure baselines for the caller's wishlist (also done by cron).
 */
router.post("/baselines/sync", authMiddleware, async (req, res) => {
    try {
        // Sync all wishlists (worker path); cheap enough for a manual refresh.
        const result = await wishlistNotifyService.syncBaselinesFromWishlist();
        return res.status(200).json({
            success: true,
            message: "Wishlist price baselines synced",
            ...result
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Baseline sync failed"
        });
    }
});

module.exports = router;
