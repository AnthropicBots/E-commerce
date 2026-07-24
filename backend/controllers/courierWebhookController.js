// HTTP handlers for courier shipment webhooks (Issue #1157).
//
// The receive endpoint is intentionally forgiving: once a well-formed payload is
// durably stored we answer 200/202 so the courier stops retrying, even if the
// downstream shipment update failed (those rows are retried by the background
// job). Only malformed/unauthorized deliveries get 4xx.

const courierWebhookService = require("../services/courierWebhookService");
const { WebhookError } = courierWebhookService;
const logger = require("../utils/logger");

const SIGNATURE_HEADER = "x-courier-signature";

const receiveWebhook = async (req, res) => {
    const provider = req.params.provider;
    const signature = req.get(SIGNATURE_HEADER);

    try {
        const result = await courierWebhookService.ingestWebhook({
            provider,
            payload: req.body,
            signature
        });

        if (result.duplicate) {
            return res.status(200).json({
                success: true,
                message: "Duplicate webhook ignored",
                webhookId: result.webhookId
            });
        }

        // 202 Accepted: payload is stored; the shipment update may still be
        // pending if it failed and will be retried by the background job.
        const statusCode = result.processed ? 200 : 202;
        return res.status(statusCode).json({
            success: true,
            message: result.processed
                ? "Webhook processed"
                : "Webhook accepted; processing deferred",
            webhookId: result.webhookId,
            shipmentId: result.shipmentId,
            status: result.status,
            error: result.error
        });
    } catch (error) {
        if (error instanceof WebhookError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        logger.error(`Courier webhook ingestion error: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: "Failed to ingest courier webhook"
        });
    }
};

// Admin/cron trigger to reprocess webhooks that were stored but not applied.
const processPending = async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const summary = await courierWebhookService.processPendingWebhooks(limit);
        return res.status(200).json({ success: true, ...summary });
    } catch (error) {
        logger.error(`Courier webhook batch processing error: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: "Failed to process pending courier webhooks"
        });
    }
};

module.exports = {
    receiveWebhook,
    processPending
};
