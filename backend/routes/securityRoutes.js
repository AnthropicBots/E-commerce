const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/rbacMiddleware');
const { ROLES } = require('../config/policy');
const {
    getAlerts,
    getAgentScore,
    getCardActivity,
    getVelocitySummary,
    blockUser,
    getFraudPatterns
} = require('../controllers/securityController');

// Admin only routes
router.get('/alerts', authMiddleware, authorizeRoles(ROLES.ADMIN), getAlerts);
router.get('/agent/:userId', authMiddleware, authorizeRoles(ROLES.ADMIN), getAgentScore);
router.get('/activity/:userId', authMiddleware, authorizeRoles(ROLES.ADMIN), getCardActivity);
router.get('/velocity/:userId', authMiddleware, authorizeRoles(ROLES.ADMIN), getVelocitySummary);
router.get('/fraud-patterns', authMiddleware, authorizeRoles(ROLES.ADMIN), getFraudPatterns);
router.post('/block/:userId', authMiddleware, authorizeRoles(ROLES.ADMIN), blockUser);

module.exports = router;