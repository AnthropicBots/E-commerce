const Approval = require('../models/Approval');
const Transaction = require('../models/Transaction');

/**
 * Middleware to verify human-in-the-loop
 */
const verifyHumanInLoop = async (req, res, next) => {
    try {
        const { transactionId, action } = req.body;

        // Check if transaction needs approval
        const transaction = await Transaction.findById(transactionId);
        if (!transaction) {
            return res.status(404).json({
                error: 'Transaction not found'
            });
        }

        // Check if approval is required
        if (transaction.status === 'pending_approval') {
            const approval = await Approval.findById(transaction.approvalRequestId);
            if (approval && approval.status === 'pending') {
                return res.status(403).json({
                    error: 'Transaction pending human approval',
                    approvalId: approval._id,
                    requiredApprovals: approval.requiredApprovals,
                    currentApprovals: approval.approvals.length
                });
            }
        }

        next();
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Middleware to enforce multi-party authorization
 */
const enforceMultiPartyAuth = (requiredRoles = ['admin', 'manager']) => {
    return async (req, res, next) => {
        try {
            const { transactionId } = req.params;
            const user = req.user;

            // Get transaction
            const transaction = await Transaction.findById(transactionId);
            if (!transaction) {
                return res.status(404).json({
                    error: 'Transaction not found'
                });
            }

            // Check if user has required role
            if (!requiredRoles.includes(user.role)) {
                return res.status(403).json({
                    error: `Insufficient permissions. Required: ${requiredRoles.join(' or ')}`
                });
            }

            // Check if this is a multi-sig transaction
            if (transaction.requiredApprovals > 1) {
                const approval = await Approval.findById(transaction.approvalRequestId);
                if (approval) {
                    // Check if user already approved
                    const alreadyApproved = approval.approvals.some(
                        a => a.userId.toString() === user._id.toString()
                    );
                    if (alreadyApproved) {
                        return res.status(400).json({
                            error: 'You have already approved this transaction'
                        });
                    }
                }
            }

            next();
        } catch (error) {
            res.status(500).json({
                error: error.message
            });
        }
    };
};

/**
 * Middleware to enforce mandatory checkpoints
 */
const enforceCheckpoints = (checkpoints = []) => {
    return async (req, res, next) => {
        try {
            const { transactionId } = req.params;

            const transaction = await Transaction.findById(transactionId);
            if (!transaction) {
                return res.status(404).json({
                    error: 'Transaction not found'
                });
            }

            const approval = await Approval.findById(transaction.approvalRequestId);
            if (!approval) {
                return next();
            }

            // Check each required checkpoint
            for (const checkpoint of checkpoints) {
                const found = approval.checkpoints.find(c => c.name === checkpoint);
                if (!found || !found.verified) {
                    return res.status(403).json({
                        error: `Verification checkpoint '${checkpoint}' required`,
                        checkpoint: checkpoint
                    });
                }
            }

            next();
        } catch (error) {
            res.status(500).json({
                error: error.message
            });
        }
    };
};

/**
 * Middleware to check if rollback is possible
 */
const checkRollbackPossible = async (req, res, next) => {
    try {
        const { transactionId } = req.params;

        const transaction = await Transaction.findById(transactionId);
        if (!transaction) {
            return res.status(404).json({
                error: 'Transaction not found'
            });
        }

        // Check if rollback is possible
        const RollbackService = require('../services/rollbackService');
        if (!RollbackService.canRollback(transaction)) {
            return res.status(400).json({
                error: `Rollback not possible for transaction in ${transaction.status} state`
            });
        }

        next();
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

module.exports = {
    verifyHumanInLoop,
    enforceMultiPartyAuth,
    enforceCheckpoints,
    checkRollbackPossible
};