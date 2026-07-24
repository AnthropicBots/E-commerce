// backend/routes/agentCheckoutRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { agentCheckoutService, CHECKOUT_STATUS } = require('../services/agentCheckoutService');

/**
 * POST /api/agent-checkout/initiate
 * Initiate agent checkout
 */
router.post('/initiate', authMiddleware, async (req, res) => {
    try {
        const { agentId, orderData, authData } = req.body;

        if (!agentId || !orderData) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID and order data are required'
            });
        }

        const result = await agentCheckoutService.initiateCheckout(agentId, orderData, authData);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Initiate checkout error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to initiate checkout'
        });
    }
});

/**
 * POST /api/agent-checkout/:sessionId/review
 * Review a checkout session (admin only)
 */
router.post('/:sessionId/review', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { sessionId } = req.params;
        const { decision, notes } = req.body;

        if (!decision) {
            return res.status(400).json({
                success: false,
                error: 'Decision is required (approved/rejected)'
            });
        }

        const result = await agentCheckoutService.reviewCheckout(
            sessionId,
            req.user.id,
            decision,
            notes
        );

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Review checkout error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to review checkout'
        });
    }
});

/**
 * GET /api/agent-checkout/:sessionId/status
 * Get checkout status
 */
router.get('/:sessionId/status', authMiddleware, (req, res) => {
    try {
        const status = agentCheckoutService.getCheckoutStatus(req.params.sessionId);

        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'Checkout session not found'
            });
        }

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get status'
        });
    }
});

/**
 * GET /api/agent-checkout/pending
 * Get pending reviews (admin only)
 */
router.get('/pending', authMiddleware, (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const pending = agentCheckoutService.getPendingReviews();
        res.json({
            success: true,
            data: pending
        });
    } catch (error) {
        console.error('Get pending reviews error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get pending reviews'
        });
    }
});

/**
 * GET /api/agent-checkout/:sessionId/audit
 * Get audit logs
 */
router.get('/:sessionId/audit', authMiddleware, (req, res) => {
    try {
        const logs = agentCheckoutService.getAuditLogs(req.params.sessionId);
        res.json({
            success: true,
            data: logs
        });
    } catch (error) {
        console.error('Get audit logs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get audit logs'
        });
    }
});

/**
 * POST /api/agent-checkout/:sessionId/cancel
 * Cancel checkout
 */
router.post('/:sessionId/cancel', authMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await agentCheckoutService.cancelCheckout(req.params.sessionId, reason);
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Cancel checkout error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to cancel checkout'
        });
    }
});

/**
 * GET /api/agent-checkout/stats
 * Get statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await agentCheckoutService.getStatistics();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

module.exports = router;