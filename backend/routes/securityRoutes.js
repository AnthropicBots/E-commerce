const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/rbacMiddleware');
const {
    getAlerts,
    getAgentScore,
    getCardActivity,
    getVelocitySummary,
    blockUser,
    getFraudPatterns
} = require('../controllers/securityController');

// Admin only routes
router.get('/alerts', authMiddleware, authorizeRoles('admin'), getAlerts);
router.get('/agent/:userId', authMiddleware, authorizeRoles('admin'), getAgentScore);
router.get('/activity/:userId', authMiddleware, authorizeRoles('admin'), getCardActivity);
router.get('/velocity/:userId', authMiddleware, authorizeRoles('admin'), getVelocitySummary);
router.get('/fraud-patterns', authMiddleware, authorizeRoles('admin'), getFraudPatterns);
router.post('/block/:userId', authMiddleware, authorizeRoles('admin'), blockUser);

module.exports = router;