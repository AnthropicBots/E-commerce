// backend/routes/notificationBrokerRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { notificationBroker, NOTIFICATION_TYPES } = require('../services/notificationBrokerService');

/**
 * POST /api/notifications/publish
 * Publish a notification
 */
router.post('/publish', authMiddleware, async (req, res) => {
    try {
        const { type, data, priority, channels } = req.body;

        if (!type) {
            return res.status(400).json({
                success: false,
                error: 'Notification type is required'
            });
        }

        const notification = await notificationBroker.publish(type, {
            ...data,
            userId: req.user.id,
            userEmail: req.user.email
        }, { priority, channels });

        res.json({
            success: true,
            data: notification
        });
    } catch (error) {
        console.error('Publish notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to publish notification'
        });
    }
});

/**
 * GET /api/notifications/user
 * Get user notifications
 */
router.get('/user', authMiddleware, async (req, res) => {
    try {
        const { limit = 20, offset = 0, status } = req.query;
        const notifications = await notificationBroker.getUserNotifications(
            req.user.id,
            { limit, offset, status }
        );

        res.json({
            success: true,
            data: notifications,
            count: notifications.length
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get notifications'
        });
    }
});

/**
 * GET /api/notifications/unread/count
 * Get unread count
 */
router.get('/unread/count', authMiddleware, async (req, res) => {
    try {
        const count = await notificationBroker.getUnreadCount(req.user.id);

        res.json({
            success: true,
            data: { unread: count }
        });
    } catch (error) {
        console.error('Unread count error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get unread count'
        });
    }
});

/**
 * POST /api/notifications/:id/read
 * Mark notification as read
 */
router.post('/:id/read', authMiddleware, async (req, res) => {
    try {
        const notification = await notificationBroker.markAsRead(req.params.id, req.user.id);

        res.json({
            success: true,
            data: notification
        });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to mark as read'
        });
    }
});

/**
 * POST /api/notifications/:id/retry
 * Retry failed notification (admin only)
 */
router.post('/:id/retry', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const notification = await notificationBroker.retryNotification(req.params.id);

        res.json({
            success: true,
            data: notification
        });
    } catch (error) {
        console.error('Retry notification error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to retry notification'
        });
    }
});

/**
 * GET /api/notifications/types
 * Get notification types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: NOTIFICATION_TYPES
    });
});

/**
 * GET /api/notifications/stats
 * Get notification statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await notificationBroker.getStatistics();

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

module.exports = router;