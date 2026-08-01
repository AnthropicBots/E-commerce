// backend/routes/multiAgentRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { multiAgentCoordinationService } = require('../services/multiAgentCoordinationService');

/**
 * POST /api/multi-agent/register
 * Register an agent
 */
router.post('/register', authMiddleware, async (req, res) => {
    try {
        const agent = await multiAgentCoordinationService.registerAgent(req.body);
        res.json({ success: true, data: agent });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/multi-agent/evaluate
 * Evaluate a decision
 */
router.post('/evaluate', authMiddleware, async (req, res) => {
    try {
        const { agentId, decision, context } = req.body;
        const evaluation = await multiAgentCoordinationService.evaluateDecision(agentId, decision, context);
        res.json({ success: true, data: evaluation });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/multi-agent/agents
 * Get all agents
 */
router.get('/agents', authMiddleware, (req, res) => {
    const agents = multiAgentCoordinationService.getAllAgents();
    res.json({ success: true, data: agents });
});

/**
 * GET /api/multi-agent/agents/:id
 * Get agent status
 */
router.get('/agents/:id', authMiddleware, (req, res) => {
    const status = multiAgentCoordinationService.getAgentStatus(req.params.id);
    if (!status) {
        return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    res.json({ success: true, data: status });
});

/**
 * GET /api/multi-agent/stats
 * Get statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await multiAgentCoordinationService.getStatistics();
        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get statistics' });
    }
});

module.exports = router;