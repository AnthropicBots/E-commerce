// backend/routes/protocolRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { agentProtocolService, PROTOCOL_TYPES } = require('../services/agentProtocolService');

/**
 * POST /api/protocol/identity
 * Register agent identity
 */
router.post('/identity', authMiddleware, async (req, res) => {
    try {
        const identity = await agentProtocolService.registerIdentity(req.body);
        res.json({ success: true, data: identity });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/protocol/verify
 * Verify agent identity
 */
router.post('/verify', authMiddleware, async (req, res) => {
    try {
        const { agentId, signature } = req.body;
        const result = await agentProtocolService.verifyIdentity(agentId, signature);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/protocol/session
 * Create a session between agents
 */
router.post('/session', authMiddleware, async (req, res) => {
    try {
        const { agentA, agentB, context } = req.body;
        const session = await agentProtocolService.createSession(agentA, agentB, context);
        res.json({ success: true, data: session });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/protocol/message
 * Send a message between agents
 */
router.post('/message', authMiddleware, async (req, res) => {
    try {
        const { sessionId, from, to, type, payload } = req.body;
        const message = await agentProtocolService.sendMessage(sessionId, from, to, type, payload);
        res.json({ success: true, data: message });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/protocol/agreement
 * Create an agreement
 */
router.post('/agreement', authMiddleware, async (req, res) => {
    try {
        const { sessionId, terms } = req.body;
        const agreement = await agentProtocolService.createAgreement(sessionId, terms);
        res.json({ success: true, data: agreement });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/protocol/agreement/:id/confirm
 * Confirm an agreement
 */
router.post('/agreement/:id/confirm', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { agentId, signature } = req.body;
        const agreement = await agentProtocolService.confirmAgreement(id, agentId, signature);
        res.json({ success: true, data: agreement });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/protocol/session/:id
 * Get session details
 */
router.get('/session/:id', authMiddleware, (req, res) => {
    try {
        const session = agentProtocolService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }
        res.json({ success: true, data: session });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/protocol/session/:id/messages
 * Get session messages
 */
router.get('/session/:id/messages', authMiddleware, (req, res) => {
    try {
        const messages = agentProtocolService.getSessionMessages(req.params.id);
        res.json({ success: true, data: messages });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/protocol/session/:id/agreements
 * Get session agreements
 */
router.get('/session/:id/agreements', authMiddleware, (req, res) => {
    try {
        const agreements = agentProtocolService.getSessionAgreements(req.params.id);
        res.json({ success: true, data: agreements });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/protocol/session/:id/close
 * Close a session
 */
router.post('/session/:id/close', authMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;
        const session = await agentProtocolService.closeSession(req.params.id, reason);
        res.json({ success: true, data: session });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/protocol/identity/:id
 * Get agent identity
 */
router.get('/identity/:id', authMiddleware, (req, res) => {
    try {
        const identity = agentProtocolService.getIdentity(req.params.id);
        if (!identity) {
            return res.status(404).json({ success: false, error: 'Identity not found' });
        }
        res.json({ success: true, data: identity });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/protocol/types
 * Get protocol types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({ success: true, data: PROTOCOL_TYPES });
});

/**
 * GET /api/protocol/stats
 * Get protocol statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await agentProtocolService.getStatistics();
        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get statistics' });
    }
});

module.exports = router;