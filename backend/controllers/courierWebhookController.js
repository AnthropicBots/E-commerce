// backend/controllers/courierWebhookController.js
// HTTP handlers for courier shipment webhooks with Circuit Breaker & DLQ support.
// The receive endpoint is intentionally forgiving: once a well-formed payload is
// durably stored we answer 200/202 so the courier stops retrying, even if the downstream shipment update failed (those rows are retried by the background
// job). Only malformed/unauthorized deliveries get 4xx.

const { courierWebhookService } = require("../services/courierWebhookService");
const { WebhookError } = require("../services/courierWebhookService");
const logger = require("../utils/logger");

const SIGNATURE_HEADER = "x-courier-signature";

const receiveWebhook = async (req, res) => {
    const provider = req.params.provider;
    const signature = req.get(SIGNATURE_HEADER);
    const startTime = Date.now();

    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({
                success: false,
                message: "Invalid webhook payload"
            });
        }

        // Ingest with circuit breaker protection
        const result = await courierWebhookService.ingestWebhook({
            provider,
            payload: req.body,
            signature
        });

        // Log processing time for monitoring
        const processingTime = Date.now() - startTime;
        logger.info(`Webhook ${provider} processed in ${processingTime}ms`, {
            provider,
            webhookId: result.webhookId,
            duplicate: result.duplicate,
            processed: result.processed
        });

        // Circuit breaker status header for monitoring
        const cbStatus = courierWebhookService.getCircuitBreakerStatus();
        res.setHeader('X-Circuit-Breaker-Status', cbStatus[provider]?.state || 'CLOSED');

        if (result.duplicate) {
            return res.status(200).json({
                success: true,
                message: "Duplicate webhook ignored",
                webhookId: result.webhookId,
                processingTime
            });
        }

        const statusCode = result.processed ? 200 : 202;
        return res.status(statusCode).json({
            success: true,
            message: result.processed
                ? "Webhook processed successfully"
                : "Webhook accepted; processing deferred",
            webhookId: result.webhookId,
            shipmentId: result.shipmentId,
            status: result.status,
            error: result.error,
            processingTime,
            circuitBreakerState: cbStatus[provider]?.state || 'CLOSED'
        });

    } catch (error) {
        const processingTime = Date.now() - startTime;
        logger.error(`Courier webhook ingestion error: ${error.message}`, {
            provider,
            processingTime,
            stack: error.stack
        });

        if (error instanceof WebhookError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
                processingTime
            });
        }

        // Check if circuit breaker is open
        const cbStatus = courierWebhookService.getCircuitBreakerStatus();
        if (cbStatus[provider]?.state === 'OPEN') {
            return res.status(503).json({
                success: false,
                message: "Service temporarily unavailable. Circuit breaker is OPEN.",
                circuitBreakerState: 'OPEN',
                processingTime,
                estimatedRecoveryTime: '30 seconds'
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to ingest courier webhook",
            processingTime,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ============================================
// PROCESS PENDING - Admin endpoint for retries
// ============================================

const processPending = async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const summary = await courierWebhookService.processPendingWebhooks(limit);
        
        return res.status(200).json({
            success: true,
            ...summary,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error(`Courier webhook batch processing error: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: "Failed to process pending courier webhooks",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ============================================
// DLQ MANAGEMENT ENDPOINTS
// ============================================

/**
 * Get DLQ statistics
 */
const getDLQStats = async (req, res) => {
    try {
        const stats = await courierWebhookService.getDLQStats();
        return res.status(200).json({
            success: true,
            ...stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('DLQ stats error:', error);
        return res.status(500).json({
            success: false,
            message: "Failed to get DLQ statistics"
        });
    }
};

/**
 * Manual retry of DLQ item
 */
const retryDLQItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const result = await courierWebhookService.manualRetryDLQ(itemId);
        return res.status(200).json({
            success: result.success,
            message: result.message
        });
    } catch (error) {
        logger.error('DLQ retry error:', error);
        return res.status(500).json({
            success: false,
            message: "Failed to retry DLQ item"
        });
    }
};

// ============================================
// CIRCUIT BREAKER MANAGEMENT
// ============================================

/**
 * Get circuit breaker status
 */
const getCircuitBreakerStatus = async (req, res) => {
    try {
        const status = courierWebhookService.getCircuitBreakerStatus();
        return res.status(200).json({
            success: true,
            ...status,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Circuit breaker status error:', error);
        return res.status(500).json({
            success: false,
            message: "Failed to get circuit breaker status"
        });
    }
};

/**
 * Reset circuit breaker for a provider
 */
const resetCircuitBreaker = async (req, res) => {
    try {
        const { provider } = req.params;
        const cb = courierWebhookService.getCircuitBreaker(provider);
        if (cb) {
            // Reset the circuit breaker
            cb.breaker.close();
            return res.status(200).json({
                success: true,
                message: `Circuit breaker reset for provider: ${provider}`,
                newState: 'CLOSED'
            });
        }
        return res.status(404).json({
            success: false,
            message: `Provider ${provider} not found`
        });
    } catch (error) {
        logger.error('Circuit breaker reset error:', error);
        return res.status(500).json({
            success: false,
            message: "Failed to reset circuit breaker"
        });
    }
};

// ============================================
// HEALTH CHECK
// ============================================

const healthCheck = async (req, res) => {
    try {
        const status = courierWebhookService.getStatus();
        const dlqStats = await courierWebhookService.getDLQStats();
        const cbStatus = courierWebhookService.getCircuitBreakerStatus();

        // Check Redis connection
        const redis = require('../config/redis');
        const redisStatus = await redis.ping().then(() => 'connected').catch(() => 'disconnected');

        return res.status(200).json({
            success: true,
            service: 'courier_webhook',
            status: 'healthy',
            timestamp: new Date().toISOString(),
            redisStatus,
            ...status,
            dlqStats,
            circuitBreakers: cbStatus
        });
    } catch (error) {
        logger.error('Health check error:', error);
        return res.status(503).json({
            success: false,
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

// ============================================
// EXPORT
// ============================================

module.exports = {
    receiveWebhook,
    processPending,
    getDLQStats,
    retryDLQItem,
    getCircuitBreakerStatus,
    resetCircuitBreaker,
    healthCheck
};