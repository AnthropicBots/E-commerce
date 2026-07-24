const ApprovalService = require('../services/approvalService');

/**
 * Request approval for a transaction
 */
exports.requestApproval = async (req, res) => {
    try {
        const { transactionId, requiredApprovals, context } = req.body;
        const approval = await ApprovalService.requestApproval(transactionId, requiredApprovals, context);
        res.status(201).json({
            success: true,
            data: approval,
            message: 'Approval request created successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Approve transaction
 */
exports.approveTransaction = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { comment } = req.body;
        const userId = req.user.id;
        const approval = await ApprovalService.approveTransaction(approvalId, userId, comment);
        res.status(200).json({
            success: true,
            data: approval,
            message: 'Transaction approved'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Reject transaction
 */
exports.rejectTransaction = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { comment } = req.body;
        const userId = req.user.id;
        const approval = await ApprovalService.rejectTransaction(approvalId, userId, comment);
        res.status(200).json({
            success: true,
            data: approval,
            message: 'Transaction rejected'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get pending approvals
 */
exports.getPendingApprovals = async (req, res) => {
    try {
        const userId = req.user.id;
        const approvals = await ApprovalService.getPendingApprovals(userId);
        res.status(200).json({
            success: true,
            data: approvals
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Add verification checkpoint
 */
exports.addCheckpoint = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { checkpointName, metadata } = req.body;
        const approval = await ApprovalService.addVerificationCheckpoint(approvalId, checkpointName, metadata);
        res.status(200).json({
            success: true,
            data: approval,
            message: 'Checkpoint added'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Verify checkpoint
 */
exports.verifyCheckpoint = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { checkpointName } = req.body;
        const userId = req.user.id;
        const approval = await ApprovalService.verifyCheckpoint(approvalId, checkpointName, userId);
        res.status(200).json({
            success: true,
            data: approval,
            message: 'Checkpoint verified'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Escalate approval
 */
exports.escalateApproval = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;
        const approval = await ApprovalService.escalateApproval(approvalId, userId, reason);
        res.status(200).json({
            success: true,
            data: approval,
            message: 'Approval escalated successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const ApprovalService = require('../services/approvalService');

// Request approval
exports.requestApproval = async (req, res) => {
    try {
        const { transactionId, requiredApprovals, context } = req.body;
        const result = await ApprovalService.requestApproval(
            transactionId,
            requiredApprovals,
            context
        );
        res.status(201).json({
            success: true,
            data: result,
            message: 'Approval requested'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Approve transaction
exports.approveTransaction = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { comment } = req.body;
        const userId = req.user.id;
        const result = await ApprovalService.approveTransaction(
            approvalId,
            userId,
            comment
        );
        res.status(200).json({
            success: true,
            data: result,
            message: 'Transaction approved'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Reject transaction
exports.rejectTransaction = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { comment } = req.body;
        const userId = req.user.id;
        const result = await ApprovalService.rejectTransaction(
            approvalId,
            userId,
            comment
        );
        res.status(200).json({
            success: true,
            data: result,
            message: 'Transaction rejected'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get pending approvals
exports.getPendingApprovals = async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit } = req.query;
        const result = await ApprovalService.getPendingApprovals(
            userId,
            limit ? parseInt(limit, 10) : undefined
        );
        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Add verification checkpoint
exports.addCheckpoint = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { checkpointName, metadata } = req.body;
        const result = await ApprovalService.addVerificationCheckpoint(
            approvalId,
            checkpointName,
            metadata
        );
        res.status(201).json({
            success: true,
            data: result,
            message: 'Checkpoint added'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Verify checkpoint
exports.verifyCheckpoint = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { checkpointName } = req.body;
        const userId = req.user.id;
        const result = await ApprovalService.verifyCheckpoint(
            approvalId,
            checkpointName,
            userId
        );
        res.status(200).json({
            success: true,
            data: result,
            message: 'Checkpoint verified'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Escalate approval
exports.escalateApproval = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;
        const result = await ApprovalService.escalateApproval(
            approvalId,
            userId,
            reason
        );
        res.status(200).json({
            success: true,
            data: result,
            message: 'Approval escalated'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const ApprovalService = require('../services/approvalService');

// Request approval
exports.requestApproval = async (req, res) => {
    try {
        const { transactionId, requiredApprovals, context } = req.body;
        const result = await ApprovalService.requestApproval(
            transactionId,
            requiredApprovals,
            context
        );
        res.status(201).json({
            success: true,
            data: result,
            message: 'Approval requested'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Approve transaction
exports.approveTransaction = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { comment } = req.body;
        const userId = req.user.id;
        const result = await ApprovalService.approveTransaction(
            approvalId,
            userId,
            comment
        );
        res.status(200).json({
            success: true,
            data: result,
            message: 'Transaction approved'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Reject transaction
exports.rejectTransaction = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { comment } = req.body;
        const userId = req.user.id;
        const result = await ApprovalService.rejectTransaction(
            approvalId,
            userId,
            comment
        );
        res.status(200).json({
            success: true,
            data: result,
            message: 'Transaction rejected'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get pending approvals
exports.getPendingApprovals = async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit } = req.query;
        const result = await ApprovalService.getPendingApprovals(
            userId,
            limit ? parseInt(limit, 10) : undefined
        );
        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Add verification checkpoint
exports.addCheckpoint = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { checkpointName, metadata } = req.body;
        const result = await ApprovalService.addVerificationCheckpoint(
            approvalId,
            checkpointName,
            metadata
        );
        res.status(201).json({
            success: true,
            data: result,
            message: 'Checkpoint added'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Verify checkpoint
exports.verifyCheckpoint = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { checkpointName } = req.body;
        const userId = req.user.id;
        const result = await ApprovalService.verifyCheckpoint(
            approvalId,
            checkpointName,
            userId
        );
        res.status(200).json({
            success: true,
            data: result,
            message: 'Checkpoint verified'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Escalate approval
exports.escalateApproval = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;
        const result = await ApprovalService.escalateApproval(
            approvalId,
            userId,
            reason
        );
        res.status(200).json({
            success: true,
            data: result,
            message: 'Approval escalated'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};