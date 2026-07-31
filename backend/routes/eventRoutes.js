// backend/routes/eventRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { domainEventService, DOMAIN_EVENTS } = require('../services/domainEventService');

/**
 * GET /api/events
 * Get all events
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { eventName, fromDate, toDate } = req.query;
        const events = domainEventService.getEvents({ eventName, fromDate, toDate });

        res.json({
            success: true,
            data: events,
            count: events.length
        });
    } catch (error) {
        console.error('Get events error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get events'
        });
    }
});

/**
 * GET /api/events/statistics
 * Get event statistics
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = domainEventService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Statistics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

/**
 * GET /api/events/subscribers
 * Get subscribers
 */
router.get('/subscribers', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { eventName } = req.query;
        const subscribers = eventName 
            ? domainEventService.getSubscribers(eventName)
            : Array.from(domainEventService.subscribers.entries());

        res.json({
            success: true,
            data: subscribers
        });
    } catch (error) {
        console.error('Get subscribers error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get subscribers'
        });
    }
});

/**
 * POST /api/events/emit
 * Emit an event (for testing)
 */
router.post('/emit', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { eventName, data, metadata } = req.body;

        if (!eventName) {
            return res.status(400).json({
                success: false,
                error: 'Event name is required'
            });
        }

        const event = await domainEventService.emit(eventName, data, metadata);

        res.json({
            success: true,
            data: event
        });
    } catch (error) {
        console.error('Emit event error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to emit event'
        });
    }
});

module.exports = router;