const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/rbacMiddleware');
const {
    requestApproval,
    approveTransaction,
    rejectTransaction,
    getPendingApprovals,
    addCheckpoint,
    verifyCheckpoint,
    escalateApproval
} = require('../controllers/approvalController');

// Protected routes
router.post('/request', authMiddleware, requestApproval);
router.post('/:approvalId/approve', authMiddleware, approveTransaction);
router.post('/:approvalId/reject', authMiddleware, rejectTransaction);
router.get('/pending', authMiddleware, getPendingApprovals);
router.post('/:approvalId/checkpoint', authMiddleware, addCheckpoint);
router.post('/:approvalId/verify', authMiddleware, verifyCheckpoint);
router.post('/:approvalId/escalate', authMiddleware, authorizeRoles('admin'), escalateApproval);

module.exports = router;