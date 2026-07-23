// backend/routes/jaggedFrontierRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { jaggedFrontierService, DECISION_STATUS } = require('../services/jaggedFrontierService');

/**
 * POST /api/jagged-frontier/evaluate
 * Evaluate an agent action
 */
router.post('/evaluate', authMiddleware, async (req, res) => {
    try {
        const { agentId, action, context } = req.body;

        if (!agentId || !action) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID and action are required'
            });
        }

        const evaluation = await jaggedFrontierService.evaluateAction(agentId, action, context);

        res.json({
            success: true,
            data: evaluation
        });
    } catch (error) {
        console.error('Evaluate action error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to evaluate action'
        });
    }
});

/**
 * GET /api/jagged-frontier/pending
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

        const pending = jaggedFrontierService.getPendingReviews();
        res.json({
            success: true,
            data: pending
        });
    } catch (error) {
        console.error('Get pending error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get pending reviews'
        });
    }
});

/**
 * POST /api/jagged-frontier/review/:decisionId
 * Review a decision (admin only)
 */
router.post('/review/:decisionId', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { decisionId } = req.params;
        const { decision, notes } = req.body;

        if (!decision) {
            return res.status(400).json({
                success: false,
                error: 'Decision is required (approved/blocked)'
            });
        }

        const result = await jaggedFrontierService.reviewDecision(
            decisionId,
            req.user.id,
            decision,
            notes
        );

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Review decision error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to review decision'
        });
    }
});

/**
 * GET /api/jagged-frontier/history
 * Get decision history (admin only)
 */
router.get('/history', authMiddleware, (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { limit = 50 } = req.query;
        const history = jaggedFrontierService.getDecisionHistory(parseInt(limit));

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get history'
        });
    }
});

/**
 * GET /api/jagged-frontier/confidence/:agentId
 * Get agent confidence score
 */
router.get('/confidence/:agentId', authMiddleware, (req, res) => {
    try {
        const score = jaggedFrontierService.getConfidenceScore(req.params.agentId);

        res.json({
            success: true,
            data: {
                agentId: req.params.agentId,
                confidence: score
            }
        });
    } catch (error) {
        console.error('Get confidence error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get confidence score'
        });
    }
});

/**
 * GET /api/jagged-frontier/stats
 * Get statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await jaggedFrontierService.getStatistics();
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