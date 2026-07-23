const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        unique: true,
        required: true
    },
    type: {
        type: String,
        enum: ['payment', 'refund', 'order', 'cancellation', 'inventory_update'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'USD'
    },
    status: {
        type: String,
        enum: [
            'pending_approval',
            'approved',
            'executing',
            'executed',
            'failed',
            'rejected',
            'rolled_back',
            'rollback_pending',
            'rollback_completed'
        ],
        default: 'pending_approval'
    },
    source: {
        type: String,
        enum: ['agent_ai', 'user', 'admin', 'system', 'webhook'],
        required: true
    },
    agentDecision: {
        confidence: {
            type: Number,
            min: 0,
            max: 1
        },
        reasoning: String,
        alternatives: [String],
        riskAssessment: {
            score: Number,
            factors: [String],
            recommendation: String
        }
    },
    requiredApprovals: {
        type: Number,
        default: 1
    },
    approvals: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        action: {
            type: String,
            enum: ['approve', 'reject']
        },
        timestamp: Date,
        comment: String
    }],
    execution: {
        startedAt: Date,
        completedAt: Date,
        duration: Number,
        response: mongoose.Schema.Types.Mixed,
        error: String
    },
    rollback: {
        status: {
            type: String,
            enum: ['not_started', 'pending', 'in_progress', 'completed', 'failed']
        },
        initiatedAt: Date,
        completedAt: Date,
        reason: String,
        steps: [{
            action: String,
            status: String,
            timestamp: Date,
            error: String
        }],
        compensationAmount: Number
    },
    verification: {
        required: Boolean,
        completed: Boolean,
        checks: [{
            name: String,
            passed: Boolean,
            timestamp: Date,
            details: mongoose.Schema.Types.Mixed
        }]
    },
    metadata: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    initiatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvalRequestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Approval'
    },
    rollbackRequestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Approval'
    }
}, {
    timestamps: true
});

// Generate transaction ID
transactionSchema.pre('save', async function(next) {
    if (this.isNew && !this.transactionId) {
        const count = await mongoose.model('Transaction').countDocuments();
        this.transactionId = `TXN-${String(count + 1).padStart(8, '0')}`;
    }
    next();
});

// Methods
transactionSchema.methods.execute = async function() {
    this.status = 'executing';
    this.execution.startedAt = new Date();
    await this.save();

    try {
        // Simulate execution
        // In real implementation, this would call the actual execution service
        this.status = 'executed';
        this.execution.completedAt = new Date();
        this.execution.duration = 
            (this.execution.completedAt - this.execution.startedAt) / 1000;
    } catch (error) {
        this.status = 'failed';
        this.execution.error = error.message;
    }
    return this.save();
};

transactionSchema.methods.initiateRollback = async function(reason) {
    this.status = 'rollback_pending';
    this.rollback.status = 'pending';
    this.rollback.initiatedAt = new Date();
    this.rollback.reason = reason;
    return this.save();
};

transactionSchema.methods.completeRollback = async function() {
    this.status = 'rolled_back';
    this.rollback.status = 'completed';
    this.rollback.completedAt = new Date();
    return this.save();
};

transactionSchema.methods.failRollback = async function(error) {
    this.rollback.status = 'failed';
    this.rollback.completedAt = new Date();
    this.rollback.steps.push({
        action: 'rollback_failed',
        status: 'failed',
        timestamp: new Date(),
        error
    });
    return this.save();
};

// Virtual for risk level
transactionSchema.virtual('riskLevel').get(function() {
    const score = this.agentDecision?.riskAssessment?.score || 0;
    if (score > 80) return 'critical';
    if (score > 60) return 'high';
    if (score > 30) return 'medium';
    return 'low';
});

module.exports = mongoose.model('Transaction', transactionSchema);