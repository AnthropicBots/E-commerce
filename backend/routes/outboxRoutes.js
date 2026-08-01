// backend/routes/outboxRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { outboxService } = require('../services/outboxService');
const { consumerIdempotencyMiddleware } = require('../services/domainEventService');

/**
 * GET /api/outbox/stats
 * Get outbox statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

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
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

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
 * POST /api/outbox/reset-stale
 * Reset stale PROCESSING locks older than 30s (#1263)
 */
router.post('/reset-stale', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const result = await outboxService.resetStaleProcessingLocks();

        res.json({
            success: true,
            message: 'Stale processing locks reset',
            data: result
        });
    } catch (error) {
        console.error('Reset stale error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset stale locks'
        });
    }
});

/**
 * GET /api/outbox/idempotency/:key
 * Inspect consumer idempotency ledger entry
 */
router.get('/idempotency/:key', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const consumer = req.query.consumer || 'outbox-dispatcher';
        const result = await outboxService.checkIdempotency(req.params.key, consumer);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Idempotency check error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check idempotency key'
        });
    }
});

/**
 * POST /api/outbox/idempotent-echo
 * Demo / health path for consumer-side Idempotency-Key middleware (#1263)
 */
router.post(
    '/idempotent-echo',
    authMiddleware,
    consumerIdempotencyMiddleware({ consumer: 'outbox-echo', eventType: 'outbox.echo' }),
    (req, res) => {
        res.json({
            success: true,
            message: 'Idempotent request accepted',
            idempotencyKey: req.idempotencyKey
        });
    }
);

module.exports = router;
