// routes/courierWebhookRoutes.js
// Courier shipment webhook endpoints (Issue #1157).

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const courierWebhookController = require("../controllers/courierWebhookController");
const courierWebhookService = require("../services/courierWebhookService");

const MAX_PROVIDER_LENGTH = 50;

// Validate the provider path segment before the payload is touched, so an
// unknown/oversized provider is rejected with a clear 400.
router.param("provider", (req, res, next, provider) => {
    if (typeof provider !== "string" || provider.length > MAX_PROVIDER_LENGTH) {
        return res.status(400).json({
            success: false,
            message: "Invalid courier provider"
        });
    }
    if (!courierWebhookService.isSupportedProvider(provider)) {
        return res.status(400).json({
            success: false,
            message: `Unsupported courier provider: ${provider}`,
            supportedProviders: [...courierWebhookService.SUPPORTED_PROVIDERS]
        });
    }
    next();
});

// Admin/cron: retry webhooks that were stored but not yet applied. Declared
// before the "/:provider" route so it isn't captured as a provider name.
router.post(
    "/process-pending",
    authMiddleware,
    authorizeRoles("admin", "superadmin"),
    courierWebhookController.processPending
);

// Public ingestion endpoint hit by the courier provider. Authenticated by an
// optional per-provider HMAC signature header rather than a user session.
router.post("/:provider", courierWebhookController.receiveWebhook);

module.exports = router;
