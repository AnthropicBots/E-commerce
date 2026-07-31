// backend/routes/workflowRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { workflowEngine, checkoutWorkflow } = require('../services/workflowEngineService');

// Register default workflows
workflowEngine.registerWorkflow('checkout', checkoutWorkflow);

/**
 * POST /api/workflows/start
 * Start a workflow
 */
router.post('/start', authMiddleware, async (req, res) => {
    try {
        const { workflowName, context } = req.body;

        if (!workflowName) {
            return res.status(400).json({
                success: false,
                error: 'Workflow name is required'
            });
        }

        const workflow = await workflowEngine.startWorkflow(workflowName, {
            ...context,
            userId: req.user.id,
            userEmail: req.user.email
        });

        res.json({
            success: true,
            data: workflow
        });
    } catch (error) {
        console.error('Start workflow error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to start workflow'
        });
    }
});

/**
 * GET /api/workflows/:id
 * Get workflow status
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const workflow = workflowEngine.workflows.get(req.params.id);

        if (!workflow) {
            return res.status(404).json({
                success: false,
                error: 'Workflow not found'
            });
        }

        res.json({
            success: true,
            data: workflow
        });
    } catch (error) {
        console.error('Get workflow error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get workflow'
        });
    }
});

/**
 * POST /api/workflows/:id/pause
 * Pause a workflow
 */
router.post('/:id/pause', authMiddleware, async (req, res) => {
    try {
        const workflow = await workflowEngine.pauseWorkflow(req.params.id);

        res.json({
            success: true,
            data: workflow
        });
    } catch (error) {
        console.error('Pause workflow error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to pause workflow'
        });
    }
});

/**
 * POST /api/workflows/:id/resume
 * Resume a workflow
 */
router.post('/:id/resume', authMiddleware, async (req, res) => {
    try {
        const workflow = await workflowEngine.resumeWorkflow(req.params.id);

        res.json({
            success: true,
            data: workflow
        });
    } catch (error) {
        console.error('Resume workflow error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to resume workflow'
        });
    }
});

/**
 * POST /api/workflows/:id/cancel
 * Cancel a workflow
 */
router.post('/:id/cancel', authMiddleware, async (req, res) => {
    try {
        const workflow = await workflowEngine.cancelWorkflow(req.params.id);

        res.json({
            success: true,
            data: workflow
        });
    } catch (error) {
        console.error('Cancel workflow error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to cancel workflow'
        });
    }
});

/**
 * GET /api/workflows/definitions
 * Get registered workflow definitions
 */
router.get('/definitions', authMiddleware, (req, res) => {
    const definitions = Array.from(workflowEngine.workflowDefinitions.keys());

    res.json({
        success: true,
        data: definitions
    });
});

/**
 * GET /api/workflows/stats
 * Get workflow statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await workflowEngine.getStatistics();

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