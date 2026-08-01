const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/rbacMiddleware');
const {
    registerAgent,
    verifyAgent,
    getAgent,
    getTrustScore,
    getReputation,
    getTransactions,
    suspendAgent,
    revokeAgent,
    listAgents,
    getCrossMerchantReputation,
    flagAgent
} = require('../controllers/agentController');

// Protected routes
router.post('/register', authMiddleware, registerAgent);
router.get('/my-agents', authMiddleware, listAgents);
router.get('/:agentId', authMiddleware, getAgent);
router.get('/:agentId/trust-score', authMiddleware, getTrustScore);
router.get('/:agentId/reputation', authMiddleware, getReputation);
router.get('/:agentId/transactions', authMiddleware, getTransactions);
router.get('/:agentId/cross-merchant', authMiddleware, authorizeRoles('admin'), getCrossMerchantReputation);

// Admin only routes
router.post('/:agentId/verify', authMiddleware, authorizeRoles('admin'), verifyAgent);
router.post('/:agentId/suspend', authMiddleware, authorizeRoles('admin'), suspendAgent);
router.post('/:agentId/revoke', authMiddleware, authorizeRoles('admin'), revokeAgent);
router.post('/:agentId/flag', authMiddleware, authorizeRoles('admin'), flagAgent);

module.exports = router;