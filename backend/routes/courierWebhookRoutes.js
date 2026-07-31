const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const courierWebhookController = require("../controllers/courierWebhookController");
const { courierWebhookService } = require("../services/courierWebhookService");

const MAX_PROVIDER_LENGTH = 50;

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


router.post("/:provider", courierWebhookController.receiveWebhook);

router.post(
    "/process-pending",
    authMiddleware,
    authorizeRoles("admin", "superadmin"),
    courierWebhookController.processPending
);

// Get DLQ statistics
router.get(
    "/dlq/stats",
    authMiddleware,
    authorizeRoles("admin", "superadmin", "support"),
    courierWebhookController.getDLQStats
);

router.post(
    "/dlq/retry/:itemId",
    authMiddleware,
    authorizeRoles("admin", "superadmin"),
    courierWebhookController.retryDLQItem
);

router.get(
    "/circuit-breaker/status",
    authMiddleware,
    authorizeRoles("admin", "superadmin", "support"),
    courierWebhookController.getCircuitBreakerStatus
);

router.post(
    "/circuit-breaker/reset/:provider",
    authMiddleware,
    authorizeRoles("admin", "superadmin"),
    courierWebhookController.resetCircuitBreaker
);

// Public health check
router.get(
    "/health",
    courierWebhookController.healthCheck
);

module.exports = router;