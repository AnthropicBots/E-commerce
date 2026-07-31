// backend/routes/outboxRoutes.js
// Issue #1263: Outbox admin routes + idempotency / stale-lock controls
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
    outboxService,
    OUTBOX_CONFIG
} = require('../services/outboxService');
const {
    consumerIdempotencyMiddleware
} = require('../services/domainEventService');

function requireAdmin(req, res) {
    if (req.user?.role !== 'admin') {
        res.status(403).json({
            success: false,
            error: 'Admin access required'
        });
        return false;
    }
    return true;
}

/**
 * GET /api/outbox/stats
 * Get outbox statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;

        const stats = await outboxService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

/**
 * POST /api/outbox/retry
 * Retry failed events (admin only)
 */
router.post('/retry', authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;

        await outboxService.retryFailedEvents();

        res.json({
            success: true,
            message: 'Failed events retried'
        });
    } catch (error) {
        console.error('Retry error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retry events'
        });
    }
});

/**
 * GET /api/outbox/pending
 * Get pending events count
 */
router.get('/pending', authMiddleware, async (req, res) => {
    try {
        const count = await outboxService.getPendingCount();

        res.json({
            success: true,
            data: { pending: count }
        });
    } catch (error) {
        console.error('Pending count error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get pending count'
        });
    }
});

/**
 * POST /api/outbox/reset-stale-locks
 * Manually reset PROCESSING rows older than 30 seconds (admin only)
 */
router.post('/reset-stale-locks', authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;

        const resetCount = await outboxService.resetStaleProcessingLocks();

        res.json({
            success: true,
            message: 'Stale processing locks reset',
            data: {
                resetCount,
                staleProcessingMs: OUTBOX_CONFIG.staleProcessingMs
            }
        });
    } catch (error) {
        console.error('Reset stale locks error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset stale processing locks'
        });
    }
});

/**
 * GET /api/outbox/idempotency/:key
 * Inspect a consumer idempotency record (admin only)
 */
router.get('/idempotency/:key', authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;

        const record = await outboxService.getIdempotencyRecord(req.params.key);

        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'Idempotency key not found'
            });
        }

        res.json({
            success: true,
            data: record
        });
    } catch (error) {
        console.error('Idempotency lookup error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to lookup idempotency key'
        });
    }
});

/**
 * POST /api/outbox/process
 * Trigger one pending-event batch (admin only) — useful after lock resets
 */
router.post('/process', authMiddleware, async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;

        await outboxService.processPendingEvents();

        res.json({
            success: true,
            message: 'Outbox batch processing triggered'
        });
    } catch (error) {
        console.error('Process trigger error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process pending events'
        });
    }
});

/**
 * Example protected write path demonstrating consumer idempotency middleware.
 * Clients should send Idempotency-Key header to prevent double side-effects.
 */
router.post(
    '/demo/idempotent-action',
    authMiddleware,
    consumerIdempotencyMiddleware({
        consumerName: 'outbox-demo',
        requireKey: true
    }),
    async (req, res) => {
        res.json({
            success: true,
            message: 'Idempotent action accepted',
            idempotencyKey: req.idempotencyKey
        });
    }
);

module.exports = router;
