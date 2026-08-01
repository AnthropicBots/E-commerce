// backend/routes/liabilityRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const agentLiabilityService = require('../services/agentLiabilityService');

/**
 * POST /api/liability/register
 * Register an AI agent
 */
router.post('/register', authMiddleware, async (req, res) => {
    try {
        const registration = await agentLiabilityService.registerAgent(req.body);
        res.json({ success: true, data: registration });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/liability/authorize
 * Authorize an agent action
 */
router.post('/authorize', authMiddleware, async (req, res) => {
    try {
        const { agentId, action, data } = req.body;
        const result = await agentLiabilityService.authorizeAction(agentId, action, data);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/liability/claim
 * Submit a liability claim
 */
router.post('/claim', authMiddleware, async (req, res) => {
    try {
        const claim = await agentLiabilityService.handleLiabilityClaim(req.body);
        res.json({ success: true, data: claim });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/liability/stats
 * Get liability statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await agentLiabilityService.getStatistics();
        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get statistics' });
    }
});

module.exports = router;