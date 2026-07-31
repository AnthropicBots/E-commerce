const mongoose = require('mongoose');

const negotiationSchema = new mongoose.Schema({
    negotiationId: {
        type: String,
        unique: true,
        required: [true, 'Negotiation ID is required'],
        trim: true,
        minlength: [10, 'Negotiation ID must be at least 10 characters long'],
        maxlength: [50, 'Negotiation ID must be at most 50 characters long']
    },
    agentId: {
        type: String,
        ref: 'AgentIdentity',
        required: [true, 'Agent ID is required'],
        trim: true
    },
    agentName: {
        type: String,
        required: [true, 'Agent name is required'],
        trim: true,
        minlength: [3, 'Agent name must be at least 3 characters long'],
        maxlength: [100, 'Agent name cannot exceed 100 characters']
    },
    counterparty: {
        type: String,
        required: [true, 'Counterparty is required'],
        trim: true,
        minlength: [2, 'Counterparty name must be at least 2 characters long'],
        maxlength: [100, 'Counterparty name cannot exceed 100 characters']
    },
    counterpartyType: {
        type: String,
        required: [true, 'Counterparty type is required'],
        enum: {
            values: ['individual', 'business', 'organization', 'ai_agent'],
            message: '{VALUE} is not a valid counterparty type'
        }
    },
    product: {
        type: String,
        required: [true, 'Product is required'],
        trim: true,
        minlength: [2, 'Product name must be at least 2 characters long'],
        maxlength: [100, 'Product name cannot exceed 100 characters']
    },
    productDetails: {
        category: { type: String, trim: true, maxlength: [100, 'Category cannot exceed 100 characters'] },
        description: { type: String, trim: true, maxlength: [1000, 'Description cannot exceed 1000 characters'] },
        quantity: { type: Number, min: [0, 'Quantity cannot be negative'] },
        unit: { type: String, trim: true }
    },
    // Negotiation details
    initialPrice: {
        type: Number,
        required: [true, 'Initial price is required'],
        min: [0, 'Initial price cannot be negative']
    },
    finalPrice: {
        type: Number,
        required: [true, 'Final price is required'],
        min: [0, 'Final price cannot be negative']
    },
    marketPrice: {
        type: Number,
        min: [0, 'Market price cannot be negative']
    },
    discountPercentage: {
        type: Number,
        default: 0,
        min: [0, 'Discount percentage cannot be negative'],
        max: [100, 'Discount percentage cannot exceed 100']
    },
    currency: {
        type: String,
        default: 'USD',
        trim: true,
        minlength: [3, 'Currency must be 3 characters long'],
        maxlength: [3, 'Currency must be 3 characters long']
    },
    // Negotiation steps
    steps: [{
        stepNumber: Number,
        action: {
            type: String,
            enum: {
                values: ['offer', 'counter_offer', 'acceptance', 'rejection', 'concession'],
                message: '{VALUE} is not a valid step action'
            }
        },
        proposer: {
            type: String,
            enum: {
                values: ['agent', 'counterparty'],
                message: '{VALUE} is not a valid proposer'
            }
        },
        price: { type: Number, min: [0, 'Price in step cannot be negative'] },
        message: { type: String, trim: true },
        timestamp: {
            type: Date,
            default: Date.now
        },
        reasoning: { type: String, trim: true },
        metadata: mongoose.Schema.Types.Mixed
    }],
    // Decision points
    decisions: [{
        type: {
            type: String,
            enum: {
                values: ['price_acceptance', 'concession', 'counter_proposal', 'termination'],
                message: '{VALUE} is not a valid decision type'
            }
        },
        reason: { type: String, trim: true },
        confidence: {
            type: Number,
            min: [0, 'Confidence cannot be less than 0'],
            max: [1, 'Confidence cannot exceed 1']
        },
        alternatives: [{ type: String, trim: true, maxlength: [100, 'Alternative cannot exceed 100 characters'] }],
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    // Status
    status: {
        type: String,
        enum: {
            values: ['initiated', 'in_progress', 'accepted', 'rejected', 'expired', 'completed'],
            message: '{VALUE} is not a valid status'
        },
        default: 'initiated'
    },
    outcome: {
        type: String,
        enum: {
            values: ['successful', 'failed', 'cancelled'],
            message: '{VALUE} is not a valid outcome'
        }
    },
    // Legal framework
    legalStatus: {
        type: String,
        enum: {
            values: ['pending_review', 'compliant', 'non_compliant', 'needs_approval'],
            message: '{VALUE} is not a valid legal status'
        },
        default: 'pending_review'
    },
    complianceChecks: [{
        check: { type: String, trim: true, maxlength: [100, 'Check name cannot exceed 100 characters'] },
        passed: Boolean,
        details: { type: String, trim: true, maxlength: [500, 'Check details cannot exceed 500 characters'] },
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    // Audit trail
    auditTrail: [{
        event: { type: String, trim: true, maxlength: [100, 'Event name cannot exceed 100 characters'] },
        details: mongoose.Schema.Types.Mixed,
        timestamp: {
            type: Date,
            default: Date.now
        },
        actor: { type: String, trim: true, maxlength: [50, 'Actor name cannot exceed 50 characters'] }
    }],
    // Signature
    signature: {
        type: String,
        select: false,
        trim: true
    },
    // Metadata
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    sessionId: { type: String, trim: true },
    metadata: mongoose.Schema.Types.Mixed
}, {
    timestamps: true
});

// Generate negotiation ID before validation so required validation does not fail
negotiationSchema.pre('validate', function (next) {
    if (this.isNew && !this.negotiationId) {
        const crypto = require('crypto');
        this.negotiationId = `NEG-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    }
    next();
});

// Methods (Bilkul waisa hi)
negotiationSchema.methods.addStep = function (stepData) {
    this.steps.push({
        ...stepData,
        stepNumber: this.steps.length + 1,
        timestamp: new Date()
    });
    return this.save();
};

negotiationSchema.methods.addDecision = function (decisionData) {
    this.decisions.push({
        ...decisionData,
        timestamp: new Date()
    });
    return this.save();
};

negotiationSchema.methods.addAuditEvent = function (event, details, actor) {
    this.auditTrail.push({
        event,
        details,
        timestamp: new Date(),
        actor: actor || 'system'
    });
    return this.save();
};

// Indexes (Bilkul waisa hi)
negotiationSchema.index({ agentId: 1, timestamp: -1 });
negotiationSchema.index({ status: 1, timestamp: -1 });
negotiationSchema.index({ legalStatus: 1 });
negotiationSchema.index({ negotiationId: 1 });
negotiationSchema.index({ counterparty: 1 });

module.exports = mongoose.model('Negotiation', negotiationSchema);