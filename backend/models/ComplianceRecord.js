const mongoose = require('mongoose');

const complianceRecordSchema = new mongoose.Schema({
    recordId: {
        type: String,
        unique: true,
        required: [true, 'Record ID is required'],
        trim: true,
        minlength: [8, 'Record ID must be at least 8 characters long'],
        maxlength: [50, 'Record ID must be at most 50 characters long']
    },
    negotiationId: {
        type: String,
        ref: 'Negotiation',
        required: [true, 'Negotiation ID is required'],
        trim: true,
        minlength: [3, 'Negotiation ID must be at least 3 characters long'],
        maxlength: [50, 'Negotiation ID must be at most 50 characters long']
    },
    // Regulatory framework
    framework: {
        type: String,
        required: [true, 'Regulatory framework is required'],
        enum: {
            values: ['gdpr', 'ccpa', 'hipaa', 'pci_dss', 'soc2', 'iso27001'],
            message: '{VALUE} is not a valid regulatory framework'
        }
    },
    // Compliance checks
    checks: [{
        name: {
            type: String,
            required: [true, 'Check name is required'],
            trim: true,
            minlength: [2, 'Check name must be at least 2 characters long'],
            maxlength: [100, 'Check name cannot exceed 100 characters']
        },
        description: {
            type: String,
            trim: true,
            maxlength: [500, 'Description cannot exceed 500 characters']
        },
        passed: {
            type: Boolean,
            default: false
        },
        details: {
            type: String,
            trim: true,
            maxlength: [1000, 'Details cannot exceed 1000 characters']
        },
        evidence: {
            type: String,
            trim: true,
            maxlength: [500, 'Evidence field cannot exceed 500 characters']
        },
        checkedAt: {
            type: Date,
            default: Date.now
        },
        checkedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    }],
    // Status
    status: {
        type: String,
        enum: {
            values: ['pending', 'in_progress', 'compliant', 'non_compliant', 'exempt'],
            message: '{VALUE} is not a valid compliance status'
        },
        default: 'pending'
    },
    // Risk assessment
    riskLevel: {
        type: String,
        enum: {
            values: ['low', 'medium', 'high', 'critical'],
            message: '{VALUE} is not a valid risk level'
        },
        default: 'low'
    },
    riskFactors: [{
        type: String,
        trim: true,
        maxlength: [100, 'Risk factor cannot exceed 100 characters']
    }],
    // Audit readiness
    auditReady: {
        type: Boolean,
        default: false
    },
    auditNotes: {
        type: String,
        trim: true,
        maxlength: [2000, 'Audit notes cannot exceed 2000 characters']
    },
    // Reporting
    reports: [{
        type: {
            type: String,
            enum: {
                values: ['internal', 'regulatory', 'customer'],
                message: '{VALUE} is not a valid report type'
            }
        },
        format: {
            type: String,
            trim: true,
            maxlength: [50, 'Format cannot exceed 50 characters']
        },
        generatedAt: Date,
        fileUrl: {
            type: String,
            trim: true
        },
        metadata: mongoose.Schema.Types.Mixed
    }],
    // Escalation
    escalated: {
        type: Boolean,
        default: false
    },
    escalatedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    escalationReason: {
        type: String,
        trim: true,
        maxlength: [500, 'Escalation reason cannot exceed 500 characters']
    },
    // Metadata
    metadata: mongoose.Schema.Types.Mixed
}, {
    timestamps: true
});

// Generate record ID before validation so required validation does not fail
complianceRecordSchema.pre('validate', function (next) {
    if (this.isNew && !this.recordId) {
        const crypto = require('crypto');
        this.recordId = `COMPLY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }
    next();
});

// Methods (Bilkul waisa hi)
complianceRecordSchema.methods.addCheck = function (checkData) {
    this.checks.push({
        ...checkData,
        checkedAt: new Date()
    });
    return this.save();
};

complianceRecordSchema.methods.updateStatus = function () {
    const allPassed = this.checks.every(c => c.passed);
    this.status = allPassed ? 'compliant' : 'non_compliant';
    return this.save();
};

// Indexes (Bilkul waisa hi)
complianceRecordSchema.index({ negotiationId: 1 });
complianceRecordSchema.index({ framework: 1, status: 1 });
complianceRecordSchema.index({ auditReady: 1 });
complianceRecordSchema.index({ riskLevel: 1 });

module.exports = mongoose.model('ComplianceRecord', complianceRecordSchema);