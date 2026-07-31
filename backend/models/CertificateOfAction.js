const mongoose = require('mongoose');
const crypto = require('crypto');

const certificateSchema = new mongoose.Schema({
    certificateId: {
        type: String,
        unique: true,
        required: true
    },
    negotiationId: {
        type: String,
        ref: 'Negotiation',
        required: true
    },
    agentId: {
        type: String,
        ref: 'AgentIdentity',
        required: true
    },
    // Certificate content
    action: {
        type: String,
        required: true
    },
    summary: {
        type: String,
        required: true
    },
    details: mongoose.Schema.Types.Mixed,
    // Cryptographic signature
    signature: {
        type: String,
        required: true,
        select: false
    },
    publicKey: {
        type: String,
        required: true
    },
    hash: {
        type: String,
        required: true
    },
    // Verification
    verified: {
        type: Boolean,
        default: false
    },
    verifiedAt: Date,
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // Timestamps
    issuedAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
    },
    // Blockchain reference (for immutable storage)
    blockchainHash: String,
    blockNumber: Number,
    // Metadata
    metadata: mongoose.Schema.Types.Mixed
}, {
    timestamps: true
});

// Generate certificate ID before validation so required validation does not fail
certificateSchema.pre('validate', function(next) {
    if (this.isNew && !this.certificateId) {
        this.certificateId = `CERT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    }
    next();
});

// Generate hash of certificate
certificateSchema.methods.generateHash = function() {
    const content = {
        negotiationId: this.negotiationId,
        agentId: this.agentId,
        action: this.action,
        summary: this.summary,
        details: this.details,
        issuedAt: this.issuedAt
    };
    this.hash = crypto
        .createHash('SHA256')
        .update(JSON.stringify(content))
        .digest('hex');
    return this.hash;
};

// Verify certificate
certificateSchema.methods.verify = function(publicKey) {
    const verify = crypto.createVerify('SHA256');
    verify.update(this.hash);
    verify.end();
    return verify.verify(publicKey, this.signature, 'base64');
};

// Indexes
certificateSchema.index({ certificateId: 1 });
certificateSchema.index({ negotiationId: 1 });
certificateSchema.index({ agentId: 1 });
certificateSchema.index({ issuedAt: -1 });
certificateSchema.index({ verified: 1 });

module.exports = mongoose.model('CertificateOfAction', certificateSchema);