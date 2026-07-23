// backend/routes/outboxRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { outboxService } = require('../services/outboxService');

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

module.exports = router;