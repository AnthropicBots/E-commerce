const mongoose = require('mongoose');

const agentTransactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        unique: true,
        required: [true, 'Transaction ID is required'],
        trim: true,
        minlength: [8, 'Transaction ID must be at least 8 characters long'],
        maxlength: [50, 'Transaction ID must be at most 50 characters long']
    },
    agentId: {
        type: String,
        ref: 'AgentIdentity',
        required: [true, 'Agent ID is required'],
        trim: true
    },
    merchantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Merchant ID is required']
    },
    type: {
        type: String,
        required: [true, 'Transaction type is required'],
        enum: {
            values: ['purchase', 'refund', 'inquiry', 'action', 'verification'],
            message: '{VALUE} is not a valid transaction type'
        }
    },
    status: {
        type: String,
        enum: {
            values: ['pending', 'success', 'failed', 'flagged', 'reversed'],
            message: '{VALUE} is not a valid status'
        },
        default: 'pending'
    },
    amount: {
        type: Number,
        default: 0,
        min: [0, 'Amount cannot be negative']
    },
    currency: {
        type: String,
        default: 'USD',
        trim: true,
        minlength: [3, 'Currency code must be at least 3 characters'],
        maxlength: [3, 'Currency code must be exactly 3 characters']
    },
    action: {
        type: String,
        required: [true, 'Action is required'],
        trim: true,
        maxlength: [200, 'Action cannot exceed 200 characters']
    },
    data: mongoose.Schema.Types.Mixed,
    signature: {
        type: String,
        required: [true, 'Signature is required'],
        trim: true
    },
    verification: {
        verified: {
            type: Boolean,
            default: false
        },
        method: {
            type: String,
            trim: true
        },
        verifiedAt: Date,
        verifiedBy: {
            type: String,
            trim: true
        }
    },
    flags: [{
        type: String,
        enum: {
            values: ['suspicious', 'high_risk', 'unusual_pattern', 'impersonation'],
            message: '{VALUE} is not a valid flag type'
        }
    }],
    trustScoreBefore: {
        type: Number,
        min: [0, 'Trust score cannot be less than 0'],
        max: [100, 'Trust score cannot exceed 100']
    },
    trustScoreAfter: {
        type: Number,
        min: [0, 'Trust score cannot be less than 0'],
        max: [100, 'Trust score cannot exceed 100']
    },
    metadata: mongoose.Schema.Types.Mixed,
    ipAddress: {
        type: String,
        trim: true
    },
    userAgent: {
        type: String,
        trim: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Generate transaction ID (Bilkul waisa hi)
agentTransactionSchema.pre('save', function (next) {
    if (this.isNew && !this.transactionId) {
        const crypto = require('crypto');
        this.transactionId = `TXN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    }
    next();
});

// Indexes (Bilkul waisa hi)
agentTransactionSchema.index({ agentId: 1, timestamp: -1 });
agentTransactionSchema.index({ merchantId: 1, timestamp: -1 });
agentTransactionSchema.index({ status: 1, timestamp: -1 });
agentTransactionSchema.index({ transactionId: 1 });

module.exports = mongoose.model('AgentTransaction', agentTransactionSchema);