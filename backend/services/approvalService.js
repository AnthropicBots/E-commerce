// backend/services/approvalService.js
const Approval = require('../models/Approval');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const mongoose = require('mongoose');

// ============================================
// CONSTANTS
// ============================================

const PRIORITY_LEVELS = ['low', 'medium', 'high', 'critical'];
const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'escalated', 'expired'];
const MAX_COMMENT_LENGTH = 1000;
const MAX_CHECKPOINT_NAME_LENGTH = 100;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ============================================
// CONFIGURATION
// ============================================

const config = {
    thresholds: {
        low: {
            time: parseInt(process.env.APPROVAL_LOW_TIME) || 60,
            approvals: parseInt(process.env.APPROVAL_LOW_COUNT) || 1
        },
        medium: {
            time: parseInt(process.env.APPROVAL_MEDIUM_TIME) || 30,
            approvals: parseInt(process.env.APPROVAL_MEDIUM_COUNT) || 2
        },
        high: {
            time: parseInt(process.env.APPROVAL_HIGH_TIME) || 15,
            approvals: parseInt(process.env.APPROVAL_HIGH_COUNT) || 3
        },
        critical: {
            time: parseInt(process.env.APPROVAL_CRITICAL_TIME) || 5,
            approvals: parseInt(process.env.APPROVAL_CRITICAL_COUNT) || 4
        }
    },
    risk: {
        highAmount: parseInt(process.env.RISK_HIGH_AMOUNT) || 10000,
        mediumAmount: parseInt(process.env.RISK_MEDIUM_AMOUNT) || 5000,
        lowAmount: parseInt(process.env.RISK_LOW_AMOUNT) || 1000,
        criticalThreshold: parseInt(process.env.RISK_CRITICAL_THRESHOLD) || 80,
        highThreshold: parseInt(process.env.RISK_HIGH_THRESHOLD) || 60,
        mediumThreshold: parseInt(process.env.RISK_MEDIUM_THRESHOLD) || 30
    }
};

// ============================================
// CUSTOM ERROR CLASSES
// ============================================

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
    }
}

class AuthorizationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthorizationError';
        this.statusCode = 403;
    }
}

class NotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
        this.statusCode = 404;
    }
}

class ConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
    }
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate ObjectId
 */
function validateObjectId(id, fieldName = 'ID') {
    if (!id || typeof id !== 'string') {
        throw new ValidationError(`${fieldName} is required and must be a string`);
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError(`Invalid ${fieldName} format`);
    }
    return id;
}

/**
 * Validate required approvals count
 */
function validateRequiredApprovals(count) {
    if (count === undefined || count === null) {
        throw new ValidationError('Required approvals count is required');
    }
    const num = Number(count);
    if (!Number.isInteger(num) || num < 1 || num > 10) {
        throw new ValidationError('Required approvals must be between 1 and 10');
    }
    return num;
}

/**
 * Validate comment
 */
function validateComment(comment) {
    if (comment === undefined || comment === null) {
        return null;
    }
    if (typeof comment !== 'string') {
        throw new ValidationError('Comment must be a string');
    }
    const trimmed = comment.trim();
    if (trimmed.length > MAX_COMMENT_LENGTH) {
        throw new ValidationError(`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters`);
    }
    return trimmed;
}

/**
 * Validate checkpoint name
 */
function validateCheckpointName(name) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new ValidationError('Checkpoint name is required');
    }
    const trimmed = name.trim();
    if (trimmed.length > MAX_CHECKPOINT_NAME_LENGTH) {
        throw new ValidationError(`Checkpoint name cannot exceed ${MAX_CHECKPOINT_NAME_LENGTH} characters`);
    }
    return trimmed;
}

/**
 * Validate priority
 */
function validatePriority(priority) {
    if (priority && !PRIORITY_LEVELS.includes(priority)) {
        throw new ValidationError(`Priority must be one of: ${PRIORITY_LEVELS.join(', ')}`);
    }
    return priority || 'low';
}

/**
 * Validate limit
 */
function validateLimit(limit) {
    const parsed = parseInt(limit, 10);
    if (isNaN(parsed) || parsed < 1) {
        return DEFAULT_LIMIT;
    }
    if (parsed > MAX_LIMIT) {
        return MAX_LIMIT;
    }
    return parsed;
}

/**
 * Validate user role for approval
 */
async function validateApprovalAuthorization(approval, userId) {
    const user = await User.findById(userId);
    if (!user) {
        throw new NotFoundError('User not found');
    }
    
    // Check if user has approver role
    if (!user.roles || !user.roles.includes('approver')) {
        throw new AuthorizationError('User is not authorized to approve');
    }
    
    return user;
}

/**
 * Validate admin exists for escalation
 */
async function validateAdminExists() {
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
        throw new NotFoundError('No admin available for escalation');
    }
    return admin;
}

// ============================================
// AUDIT LOGGER
// ============================================

const auditLogger = {
    log: (action, details) => {
        const logEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            service: 'ApprovalService'
        };
        console.log(JSON.stringify(logEntry));
    }
};

// ============================================
// APPROVAL SERVICE
// ============================================

class ApprovalService {
    constructor() {
        this.escalationThresholds = config.thresholds;
        this.auditTrail = [];
    }

    /**
     * Request approval for a transaction
     */
    async requestApproval(transactionId, requiredApprovals = 1, context = {}) {
        try {
            // Validate inputs
            const validTransactionId = validateObjectId(transactionId, 'Transaction ID');
            const validRequiredApprovals = validateRequiredApprovals(requiredApprovals);

            // Find transaction
            const transaction = await Transaction.findById(validTransactionId);
            if (!transaction) {
                throw new NotFoundError('Transaction not found');
            }

            // Check if transaction already has pending approval
            if (transaction.approvalRequestId) {
                const existingApproval = await Approval.findById(transaction.approvalRequestId);
                if (existingApproval && existingApproval.status === 'pending') {
                    throw new ConflictError('Transaction already has a pending approval request');
                }
            }

            // Calculate risk score
            const riskScore = this.calculateRiskScore(transaction);

            // Determine priority
            const priority = this.determinePriority(riskScore);

            // Validate priority
            const validPriority = validatePriority(priority);

            // Get required approvals based on priority
            const required = validRequiredApprovals || this.getRequiredApprovals(validPriority);

            // Create approval request
            const approval = new Approval({
                transactionId: transaction._id,
                type: 'human_approval',
                requiredApprovals: required,
                riskScore,
                context: {
                    agentId: context.agentId || null,
                    sessionId: context.sessionId || null,
                    reason: context.reason || null,
                    priority: validPriority
                },
                expiresAt: new Date(Date.now() + this.getExpiryTime(validPriority))
            });

            await approval.save();

            // Update transaction
            transaction.approvalRequestId = approval._id;
            transaction.status = 'pending_approval';
            await transaction.save();

            // Notify approvers
            await this.notifyApprovers(approval);

            // Audit log
            auditLogger.log('APPROVAL_REQUESTED', {
                approvalId: approval._id,
                transactionId: transaction._id,
                priority: validPriority,
                requiredApprovals: required,
                riskScore
            });

            return approval;

        } catch (error) {
            auditLogger.log('APPROVAL_REQUEST_FAILED', {
                transactionId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Approve a transaction
     */
    async approveTransaction(approvalId, userId, comment = '') {
        try {
            // Validate inputs
            const validApprovalId = validateObjectId(approvalId, 'Approval ID');
            const validUserId = validateObjectId(userId, 'User ID');
            const validComment = validateComment(comment);

            // Find approval
            const approval = await Approval.findById(validApprovalId);
            if (!approval) {
                throw new NotFoundError('Approval request not found');
            }

            // Check status
            if (approval.status !== 'pending') {
                throw new ConflictError(`Approval already ${approval.status}`);
            }

            // Check expiry
            if (new Date() > new Date(approval.expiresAt)) {
                approval.status = 'expired';
                await approval.save();
                throw new ConflictError('Approval request has expired');
            }

            // Validate authorization
            await validateApprovalAuthorization(approval, validUserId);

            // Check if user already approved
            const alreadyApproved = approval.approvals && 
                approval.approvals.some(a => a.userId.toString() === validUserId.toString());
            if (alreadyApproved) {
                throw new ConflictError('User has already approved this request');
            }

            // Add approval
            await approval.addApproval(validUserId, 'approve', validComment);

            // If approved, execute transaction
            if (approval.status === 'approved') {
                const transaction = await Transaction.findById(approval.transactionId);
                if (transaction) {
                    await transaction.execute();
                }
                
                // Audit log
                auditLogger.log('APPROVAL_APPROVED', {
                    approvalId: approval._id,
                    userId: validUserId,
                    comment: validComment
                });
                
                console.log(`✅ Transaction ${transaction?.transactionId || 'unknown'} approved by ${userId}`);
            }

            return approval;

        } catch (error) {
            auditLogger.log('APPROVAL_APPROVE_FAILED', {
                approvalId,
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Reject a transaction
     */
    async rejectTransaction(approvalId, userId, comment = '') {
        try {
            // Validate inputs
            const validApprovalId = validateObjectId(approvalId, 'Approval ID');
            const validUserId = validateObjectId(userId, 'User ID');
            const validComment = validateComment(comment);

            // Find approval
            const approval = await Approval.findById(validApprovalId);
            if (!approval) {
                throw new NotFoundError('Approval request not found');
            }

            // Check status
            if (approval.status !== 'pending') {
                throw new ConflictError(`Approval already ${approval.status}`);
            }

            // Check expiry
            if (new Date() > new Date(approval.expiresAt)) {
                approval.status = 'expired';
                await approval.save();
                throw new ConflictError('Approval request has expired');
            }

            // Validate authorization
            await validateApprovalAuthorization(approval, validUserId);

            // Add rejection
            await approval.addApproval(validUserId, 'reject', validComment);

            // Update transaction
            const transaction = await Transaction.findById(approval.transactionId);
            if (transaction) {
                transaction.status = 'rejected';
                await transaction.save();
            }

            // Audit log
            auditLogger.log('APPROVAL_REJECTED', {
                approvalId: approval._id,
                userId: validUserId,
                comment: validComment
            });

            console.log(`❌ Transaction ${transaction?.transactionId || 'unknown'} rejected by ${userId}`);

            return approval;

        } catch (error) {
            auditLogger.log('APPROVAL_REJECT_FAILED', {
                approvalId,
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get pending approvals for a user
     */
    async getPendingApprovals(userId, limit = DEFAULT_LIMIT) {
        try {
            const validUserId = validateObjectId(userId, 'User ID');
            const validLimit = validateLimit(limit);

            // Check user authorization
            const user = await User.findById(validUserId);
            if (!user) {
                throw new NotFoundError('User not found');
            }

            const approvals = await Approval.find({
                status: 'pending',
                expiresAt: { $gt: new Date() }
            })
            .populate('transactionId')
            .sort({ priority: -1, createdAt: 1 })
            .limit(validLimit);

            return approvals;

        } catch (error) {
            auditLogger.log('GET_PENDING_APPROVALS_FAILED', {
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Add verification checkpoint
     */
    async addVerificationCheckpoint(approvalId, checkpointName, metadata = {}) {
        try {
            const validApprovalId = validateObjectId(approvalId, 'Approval ID');
            const validCheckpointName = validateCheckpointName(checkpointName);

            const approval = await Approval.findById(validApprovalId);
            if (!approval) {
                throw new NotFoundError('Approval request not found');
            }

            await approval.addCheckpoint(validCheckpointName, metadata);
            
            auditLogger.log('CHECKPOINT_ADDED', {
                approvalId: approval._id,
                checkpointName: validCheckpointName
            });

            return approval;

        } catch (error) {
            auditLogger.log('ADD_CHECKPOINT_FAILED', {
                approvalId,
                checkpointName,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Verify checkpoint
     */
    async verifyCheckpoint(approvalId, checkpointName, userId) {
        try {
            const validApprovalId = validateObjectId(approvalId, 'Approval ID');
            const validCheckpointName = validateCheckpointName(checkpointName);
            const validUserId = validateObjectId(userId, 'User ID');

            const approval = await Approval.findById(validApprovalId);
            if (!approval) {
                throw new NotFoundError('Approval request not found');
            }

            await approval.verifyCheckpoint(validCheckpointName, validUserId);
            
            auditLogger.log('CHECKPOINT_VERIFIED', {
                approvalId: approval._id,
                checkpointName: validCheckpointName,
                userId: validUserId
            });

            return approval;

        } catch (error) {
            auditLogger.log('VERIFY_CHECKPOINT_FAILED', {
                approvalId,
                checkpointName,
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Escalate approval
     */
    async escalateApproval(approvalId, userId, reason = '') {
        try {
            const validApprovalId = validateObjectId(approvalId, 'Approval ID');
            const validUserId = validateObjectId(userId, 'User ID');
            const validReason = validateComment(reason) || 'Escalated due to urgency';

            const approval = await Approval.findById(validApprovalId);
            if (!approval) {
                throw new NotFoundError('Approval request not found');
            }

            // Find admin
            const admin = await validateAdminExists();

            approval.status = 'escalated';
            approval.escalatedTo = admin._id;
            approval.escalationReason = validReason;
            await approval.save();

            // Notify admin
            await this.notifyAdmin(approval, admin);

            auditLogger.log('APPROVAL_ESCALATED', {
                approvalId: approval._id,
                userId: validUserId,
                adminId: admin._id,
                reason: validReason
            });

            return approval;

        } catch (error) {
            auditLogger.log('ESCALATE_APPROVAL_FAILED', {
                approvalId,
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Calculate risk score for transaction
     */
    calculateRiskScore(transaction) {
        let score = 0;
        const factors = [];

        // Amount factor
        if (transaction.amount > config.risk.highAmount) {
            score += 30;
            factors.push('High transaction amount');
        } else if (transaction.amount > config.risk.mediumAmount) {
            score += 20;
            factors.push('Medium transaction amount');
        } else if (transaction.amount > config.risk.lowAmount) {
            score += 10;
        }

        // Type factor
        if (transaction.type === 'refund' || transaction.type === 'cancellation') {
            score += 20;
            factors.push('Refund/Cancellation transaction');
        }

        // Source factor
        if (transaction.source === 'agent_ai') {
            score += 15;
            factors.push('AI-initiated transaction');
        }

        // Confidence factor
        if (transaction.agentDecision?.confidence < 0.7) {
            score += 15;
            factors.push('Low confidence in AI decision');
        }

        // Risk assessment from AI
        if (transaction.agentDecision?.riskAssessment?.score) {
            score += transaction.agentDecision.riskAssessment.score * 0.3;
        }

        return Math.min(100, Math.round(score));
    }

    /**
     * Determine priority based on risk score
     */
    determinePriority(riskScore) {
        if (riskScore > config.risk.criticalThreshold) return 'critical';
        if (riskScore > config.risk.highThreshold) return 'high';
        if (riskScore > config.risk.mediumThreshold) return 'medium';
        return 'low';
    }

    /**
     * Get required approvals based on priority
     */
    getRequiredApprovals(priority) {
        return this.escalationThresholds[priority]?.approvals || 1;
    }

    /**
     * Get expiry time based on priority (in milliseconds)
     */
    getExpiryTime(priority) {
        return (this.escalationThresholds[priority]?.time || 30) * 60 * 1000;
    }

    /**
     * Notify approvers
     */
    async notifyApprovers(approval) {
        // In production, send email, SMS, or push notification
        console.log(`📧 Approval request created: ${approval._id}`);
        console.log(`   Priority: ${approval.context.priority}`);
        console.log(`   Required approvals: ${approval.requiredApprovals}`);
    }

    /**
     * Notify admin about escalation
     */
    async notifyAdmin(approval, admin) {
        console.log(`🔔 Approval escalated to admin ${admin.email}`);
        console.log(`   Approval: ${approval._id}`);
        console.log(`   Reason: ${approval.escalationReason}`);
    }

    /**
     * Get audit trail
     */
    getAuditTrail() {
        return this.auditTrail;
    }
}

module.exports = new ApprovalService();