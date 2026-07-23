const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/rbacMiddleware');
const {
    initiateRollback,
    executeRollback,
    getRollbackStatus,
    canRollback
} = require('../controllers/rollbackController');

// Protected routes
router.post('/:transactionId/initiate', authMiddleware, initiateRollback);
router.post('/:transactionId/execute', authMiddleware, authorizeRoles('admin'), executeRollback);
router.get('/:transactionId/status', authMiddleware, getRollbackStatus);
router.get('/:transactionId/can-rollback', authMiddleware, canRollback);

module.exports = router;