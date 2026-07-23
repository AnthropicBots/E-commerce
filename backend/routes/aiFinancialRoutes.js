// backend/routes/aiFinancialRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { aiFinancialGuard } = require('../middleware/aiFinancialGuard');
const aiFinancialController = require('../controllers/aiFinancialController');

/**
 * POST /api/ai/financial/action
 * Execute AI financial action with guard
 */
router.post('/action', authMiddleware, aiFinancialGuard, aiFinancialController.executeAction);

/**
 * POST /api/ai/financial/approve/:id
 * Approve pending AI decision (admin only)
 */
router.post('/approve/:id', authMiddleware, aiFinancialController.approveDecision);

/**
 * GET /api/ai/financial/pending
 * Get pending approvals (admin only)
 */
router.get('/pending', authMiddleware, aiFinancialController.getPending);

/**
 * GET /api/ai/financial/audit
 * Get audit logs (admin only)
 */
router.get('/audit', authMiddleware, aiFinancialController.getAuditLogs);

/**
 * GET /api/ai/financial/limits
 * Get financial limits configuration
 */
router.get('/limits', authMiddleware, aiFinancialController.getLimits);

module.exports = router;