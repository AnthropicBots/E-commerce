// backend/routes/coordinatorRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { 
    aiCoordinatorMiddleware, 
    handleApproval, 
    getCoordinatorStatus 
} = require('../middleware/aiCoordinatorMiddleware');

/**
 * POST /api/coordinator/action
 * Submit AI agent action
 */
router.post('/action', authMiddleware, aiCoordinatorMiddleware);

/**
 * POST /api/coordinator/approve/:approvalId
 * Approve or reject an action
 */
router.post('/approve/:approvalId', authMiddleware, handleApproval);

/**
 * GET /api/coordinator/status
 * Get coordinator status
 */
router.get('/status', authMiddleware, getCoordinatorStatus);

/**
 * GET /api/coordinator/health
 * Health check
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'operational',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;