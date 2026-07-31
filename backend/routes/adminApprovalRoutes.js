const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminApprovalController = require('../controllers/adminApprovalController');

// Get pending approval requests (Admin only)
router.get('/approvals/pending', authMiddleware, adminApprovalController.getPendingApprovals);

// Approve or reject discount (Admin only)
router.post('/approvals/:id/decide', authMiddleware, adminApprovalController.decideApproval);

module.exports = router;