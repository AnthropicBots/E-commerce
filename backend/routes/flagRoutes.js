/**
 * Feature flag routes (#1390).
 * Public bootstrap for storefront; admin CRUD, kill switch, audit.
 */

"use strict";

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
    featureFlagService,
    FLAG_TYPES,
    FLAG_STATUS
} = require("../services/featureFlagService");

function requireAdmin(req, res) {
    if (!req.user || req.user.role !== "admin") {
        res.status(403).json({
            success: false,
            message: "Admin access required"
        });
        return false;
    }
    return true;
}

/**
 * Soft optional auth — never blocks the request; attaches req.user when possible.
 */
async function optionalAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const hasCookie = Boolean(req.cookies?.accessToken);
    if (!header && !hasCookie) {
        return next();
    }

    let settled = false;
    const softRes = {
        status() {
            return softRes;
        },
        json() {
            settled = true;
            return softRes;
        }
    };

    try {
        await new Promise((resolve) => {
            authMiddleware(req, softRes, () => {
                settled = true;
                resolve();
            });
            // If authMiddleware returned a 401 via softRes without calling next
            setImmediate(() => resolve());
        });
    } catch (_) {
        /* ignore */
    }

    return next();
}

// ==================== PUBLIC / SHARED (static paths first) ====================

/**
 * GET /api/flags/bootstrap
 * Hydrate frontend CONFIG.FLAGS — no auth required (uses user when present).
 */
router.get("/bootstrap", optionalAuth, async (req, res) => {
    try {
        if (!featureFlagService.initialized) {
            await featureFlagService.initialize();
        }
        const context = {
            userId: req.user?.id || req.query.userId || "anonymous",
            userGroup: req.user?.group || req.query.userGroup || "default",
            environment: process.env.NODE_ENV || "development"
        };
        const payload = await featureFlagService.bootstrap(context);
        res.setHeader("Cache-Control", `public, max-age=${payload.ttlSec}`);
        return res.status(200).json({
            success: true,
            message: "Feature flags bootstrapped",
            ...payload
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to bootstrap flags"
        });
    }
});

router.get("/types", authMiddleware, (req, res) => {
    res.json({ success: true, data: FLAG_TYPES, statuses: FLAG_STATUS });
});

router.get("/statistics", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const stats = await featureFlagService.getStatistics();
        return res.json({ success: true, data: stats });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to get statistics"
        });
    }
});

router.get("/audit", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        return res.json({
            success: true,
            data: featureFlagService.getAuditLog(limit)
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to load flag audit"
        });
    }
});

/**
 * POST /api/flags/cache/flush
 * Admin: clear Redis + memory flag caches globally.
 */
router.post("/cache/flush", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const result = await featureFlagService.clearAllCaches();
        await featureFlagService.writeAudit("cache_flush", "*", req.user, {});
        return res.json({
            success: true,
            message: "Feature flag caches cleared",
            ...result
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to flush cache"
        });
    }
});

/**
 * GET /api/flags
 */
router.get("/", authMiddleware, async (req, res) => {
    try {
        if (!featureFlagService.initialized) {
            await featureFlagService.initialize();
        }
        const { status, type } = req.query;
        const flags = featureFlagService.getAllFlags({ status, type });
        return res.json({
            success: true,
            data: flags,
            count: flags.length
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to get flags"
        });
    }
});

/**
 * POST /api/flags
 */
router.post("/", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const flag = await featureFlagService.createFlag(req.body, req.user);
        return res.status(201).json({
            success: true,
            message: "Feature flag created",
            data: flag
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            code: error.code,
            message: error.message || "Failed to create flag"
        });
    }
});

/**
 * POST /api/flags/:key/kill
 * Instant kill switch — disables flag and clears caches globally.
 */
router.post("/:key/kill", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const flag = await featureFlagService.killSwitch(req.params.key, {
            reason: req.body?.reason || "",
            actor: req.user
        });
        return res.json({
            success: true,
            message: `Kill switch activated for ${req.params.key}`,
            data: flag
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            code: error.code,
            message: error.message || "Failed to kill flag"
        });
    }
});

router.post("/:key/unkill", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const flag = await featureFlagService.unkilled(req.params.key, req.user);
        return res.json({
            success: true,
            message: `Kill switch cleared for ${req.params.key}`,
            data: flag
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Failed to clear kill switch"
        });
    }
});

router.post("/:key/enable", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const flag = await featureFlagService.updateFlag(
            req.params.key,
            {
                status: FLAG_STATUS.ACTIVE,
                killSwitch: false,
                value: { enabled: true }
            },
            req.user
        );
        return res.json({ success: true, data: flag });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Failed to enable flag"
        });
    }
});

router.post("/:key/disable", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const flag = await featureFlagService.updateFlag(
            req.params.key,
            {
                status: FLAG_STATUS.PAUSED,
                value: { enabled: false }
            },
            req.user
        );
        return res.json({ success: true, data: flag });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Failed to disable flag"
        });
    }
});

router.get("/:key/evaluate", optionalAuth, async (req, res) => {
    try {
        if (!featureFlagService.initialized) {
            await featureFlagService.initialize();
        }
        const context = {
            userId: req.query.userId || req.user?.id || "anonymous",
            userGroup: req.query.userGroup || req.user?.group || "default",
            environment: process.env.NODE_ENV || "development"
        };
        const result = await featureFlagService.evaluateFlag(
            req.params.key,
            context
        );
        return res.json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to evaluate flag"
        });
    }
});

router.get("/:key", authMiddleware, async (req, res) => {
    try {
        if (!featureFlagService.initialized) {
            await featureFlagService.initialize();
        }
        const flag = featureFlagService.getFlag(req.params.key);
        if (!flag) {
            return res.status(404).json({
                success: false,
                message: "Flag not found"
            });
        }
        return res.json({ success: true, data: flag });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to get flag"
        });
    }
});

router.put("/:key", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const flag = await featureFlagService.updateFlag(
            req.params.key,
            req.body,
            req.user
        );
        return res.json({
            success: true,
            message: "Feature flag updated",
            data: flag
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            code: error.code,
            message: error.message || "Failed to update flag"
        });
    }
});

router.delete("/:key", authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;
        const flag = await featureFlagService.deleteFlag(
            req.params.key,
            req.user
        );
        return res.json({
            success: true,
            message: "Feature flag archived",
            data: flag
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Failed to delete flag"
        });
    }
});

module.exports = router;
