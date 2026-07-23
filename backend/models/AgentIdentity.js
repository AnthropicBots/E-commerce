const mongoose = require('mongoose');
const crypto = require('crypto');

// --- CUSTOM HELPER FUNCTION FOR CONSISTENT ENUM VALIDATION MESSAGES ---
const createEnumValidator = (allowedValues, fieldName) => {
    return {
        values: allowedValues,
        message: `\`{VALUE}\` is not a valid ${fieldName}. Allowed ${fieldName}s are: ${allowedValues.join(', ')}.`
    };
};

const agentIdentitySchema = new mongoose.Schema({
    agentId: {
        type: String,
        unique: true,
        required: true,
        index: true
    },
    agentName: {
        type: String,
        required: true,
        trim: true
    },
    agentType: {
        type: String,
        // UPDATED
        enum: createEnumValidator(
            ['shopping', 'research', 'payment', 'customer_service', 'fraud_detection', 'shipping', 'inventory', 'marketing'],
            'agentType'
        ),
        required: true,
        index: true
    },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    ownerType: {
        type: String,
        // UPDATED
        enum: createEnumValidator(['individual', 'business', 'organization'], 'ownerType'),
        default: 'individual'
    },
    ownerEmail: {
        type: String,
        required: true,
        lowercase: true
    },
    publicKey: {
        type: String,
        required: true
    },
    privateKey: {
        type: String,
        select: false
    },
    keyAlgorithm: {
        type: String,
        // UPDATED
        enum: createEnumValidator(['RSA-2048', 'RSA-4096', 'EC-256', 'EC-512'], 'keyAlgorithm'),
        default: 'RSA-2048'
    },
    keyFingerprint: {
        type: String,
        unique: true,
        sparse: true
    },
    verified: {
        type: Boolean,
        default: false,
        index: true
    },
    verificationMethod: {
        type: String,
        // UPDATED
        enum: createEnumValidator(['manual', 'automated', 'third_party', 'document_verification'], 'verificationMethod'),
        default: 'manual'
    },
    verifiedAt: Date,
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    verificationHistory: [{
        status: {
            type: String,
            // UPDATED
            enum: createEnumValidator(['pending', 'verified', 'rejected', 'expired'], 'verificationHistory status')
        },
        method: {
            type: String,
            // UPDATED
            enum: createEnumValidator(['manual', 'automated', 'third_party', 'document_verification'], 'verificationHistory method')
        },
        notes: String,
        performedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    documents: [{
        type: {
            type: String,
            // UPDATED
            enum: createEnumValidator(['government_id', 'passport', 'driving_license', 'business_license'], 'document type')
        },
        number: {
            type: String,
            select: false
        },
        issuer: String,
        expiryDate: Date,
        fileUrl: {
            type: String,
            select: false
        },
        verified: {
            type: Boolean,
            default: false
        },
        verifiedAt: Date,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    status: {
        type: String,
        // UPDATED
        enum: createEnumValidator(
            ['active', 'suspended', 'revoked', 'pending_verification', 'pending_approval', 'under_review'],
            'status'
        ),
        default: 'pending_verification',
        index: true
    },
    statusReason: String,
    statusUpdatedAt: {
        type: Date,
        default: Date.now
    },
    statusUpdatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    securitySettings: {
        requireTwoFactor: {
            type: Boolean,
            default: false
        },
        allowedIPs: [String],
        maxSessions: {
            type: Number,
            default: 5
        },
        sessionTimeout: {
            type: Number,
            default: 3600
        },
        rateLimit: {
            requestsPerMinute: {
                type: Number,
                default: 60
            }
        }
    },
    sessions: [{
        sessionId: {
            type: String,
            required: true,
            unique: true
        },
        token: {
            type: String,
            select: false
        },
        ipAddress: String,
        userAgent: String,
        startedAt: {
            type: Date,
            default: Date.now
        },
        lastActiveAt: {
            type: Date,
            default: Date.now
        },
        expiresAt: {
            type: Date,
            required: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    }],
    auditTrail: {
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        deletedAt: Date,
        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        restoreToken: {
            type: String,
            select: false
        }
    },
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: new Map()
    },
    compliance: {
        gdpr: {
            consentGiven: {
                type: Boolean,
                default: false
            },
            consentDate: Date,
            dataRetentionPeriod: {
                type: Number,
                default: 365
            }
        },
        privacyPolicy: {
            accepted: {
                type: Boolean,
                default: false
            },
            acceptedAt: Date,
            acceptedVersion: String
        },
        termsOfService: {
            accepted: {
                type: Boolean,
                default: false
            },
            acceptedAt: Date,
            acceptedVersion: String
        }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtuals
agentIdentitySchema.virtual('isActive').get(function () {
    return this.status === 'active';
});

agentIdentitySchema.virtual('isVerified').get(function () {
    return this.verified === true;
});

agentIdentitySchema.virtual('documentCount').get(function () {
    return this.documents.length;
});

agentIdentitySchema.virtual('activeSessionsCount').get(function () {
    return this.sessions.filter(s => s.isActive).length;
});

// Pre-save middleware
agentIdentitySchema.pre('save', function (next) {
    if (this.isNew && !this.agentId) {
        const prefix = this.agentType.substring(0, 3).toUpperCase();
        const random = crypto.randomBytes(6).toString('hex').toUpperCase();
        this.agentId = `${prefix}-${random}`;

        if (this.publicKey) {
            this.keyFingerprint = this.generateKeyFingerprint();
        }
    }

    if (this.isModified('status')) {
        this.statusUpdatedAt = new Date();
    }

    if (this.sessions) {
        const now = new Date();
        this.sessions = this.sessions.filter(session => {
            return session.isActive && session.expiresAt > now;
        });
    }

    if (this.verificationHistory && this.verificationHistory.length > 50) {
        this.verificationHistory = this.verificationHistory.slice(-50);
    }

    next();
});

// Generate Key Pair
agentIdentitySchema.methods.generateKeyPair = function () {
    const { generateKeyPairSync } = crypto;

    let modulusLength = 2048;
    if (this.keyAlgorithm === 'RSA-4096') {
        modulusLength = 4096;
    } else if (this.keyAlgorithm === 'RSA-2048') {
        modulusLength = 2048;
    } else {
        const { publicKey, privateKey } = generateKeyPairSync('ec', {
            namedCurve: this.keyAlgorithm === 'EC-512' ? 'secp521r1' : 'prime256v1',
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });

        this.publicKey = publicKey;
        this.privateKey = privateKey;
        this.keyFingerprint = this.generateKeyFingerprint();
        return { publicKey, privateKey };
    }

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });

    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.keyFingerprint = this.generateKeyFingerprint();
    return { publicKey, privateKey };
};

// Generate Key Fingerprint
agentIdentitySchema.methods.generateKeyFingerprint = function () {
    if (!this.publicKey) return null;
    return crypto
        .createHash('sha256')
        .update(this.publicKey)
        .digest('hex')
        .substring(0, 16)
        .toUpperCase();
};

// Sign Data
agentIdentitySchema.methods.sign = function (data) {
    if (!this.privateKey) {
        throw new Error('Private key not available');
    }

    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(data));
    sign.end();
    return sign.sign(this.privateKey, 'base64');
};

// Verify Signature
agentIdentitySchema.methods.verify = function (data, signature) {
    if (!this.publicKey) {
        throw new Error('Public key not available');
    }

    const verify = crypto.createVerify('SHA256');
    verify.update(JSON.stringify(data));
    verify.end();
    return verify.verify(this.publicKey, signature, 'base64');
};

// Add Verification History
agentIdentitySchema.methods.addVerificationHistory = function ({ status, method, notes = '', performedBy = null }) {
    this.verificationHistory.push({
        status,
        method,
        notes,
        performedBy,
        timestamp: new Date()
    });

    if (this.verificationHistory.length > 50) {
        this.verificationHistory = this.verificationHistory.slice(-50);
    }

    return this.save();
};

// Add Document
agentIdentitySchema.methods.addDocument = function ({ type, number, issuer, expiryDate, fileUrl }) {
    this.documents.push({
        type,
        number,
        issuer,
        expiryDate,
        fileUrl,
        uploadedAt: new Date()
    });

    return this.save();
};

// Verify Document
agentIdentitySchema.methods.verifyDocument = function (documentIndex) {
    if (documentIndex < 0 || documentIndex >= this.documents.length) {
        throw new Error('Invalid document index');
    }

    this.documents[documentIndex].verified = true;
    this.documents[documentIndex].verifiedAt = new Date();

    const allVerified = this.documents.every(doc => doc.verified);

    if (allVerified && this.documents.length > 0) {
        this.verified = true;
        this.verifiedAt = new Date();
        this.status = 'active';
    }

    return this.save();
};

// Create Session
agentIdentitySchema.methods.createSession = function ({ sessionId, token, ipAddress, userAgent, expiresIn = 3600 }) {
    const session = {
        sessionId: sessionId || crypto.randomBytes(16).toString('hex'),
        token,
        ipAddress,
        userAgent,
        startedAt: new Date(),
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        isActive: true
    };

    this.sessions.push(session);

    const maxSessions = this.securitySettings?.maxSessions || 5;
    if (this.sessions.length > maxSessions) {
        const activeSessions = this.sessions.filter(s => s.isActive);
        if (activeSessions.length > maxSessions) {
            activeSessions.sort((a, b) => a.lastActiveAt - b.lastActiveAt);
            const toRemove = activeSessions.slice(0, activeSessions.length - maxSessions);
            toRemove.forEach(s => s.isActive = false);
        }
    }

    return this.save().then(() => session);
};

// Validate Session
agentIdentitySchema.methods.validateSession = function (sessionId) {
    const session = this.sessions.find(s => s.sessionId === sessionId && s.isActive);

    if (!session) {
        return { valid: false, reason: 'Session not found or inactive' };
    }

    if (session.expiresAt < new Date()) {
        session.isActive = false;
        return { valid: false, reason: 'Session expired' };
    }

    session.lastActiveAt = new Date();
    return { valid: true, session };
};

// Terminate Session
agentIdentitySchema.methods.terminateSession = function (sessionId) {
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (session) {
        session.isActive = false;
        session.lastActiveAt = new Date();
    }
    return this.save();
};

// Terminate All Sessions
agentIdentitySchema.methods.terminateAllSessions = function () {
    this.sessions.forEach(session => {
        session.isActive = false;
        session.lastActiveAt = new Date();
    });
    return this.save();
};

// Update Status
agentIdentitySchema.methods.updateStatus = function (newStatus, reason, updatedBy) {
    const oldStatus = this.status;
    this.status = newStatus;
    this.statusReason = reason || null;
    this.statusUpdatedAt = new Date();
    this.statusUpdatedBy = updatedBy || null;

    if (newStatus === 'active' && oldStatus !== 'active') {
        this.addVerificationHistory({
            status: 'verified',
            method: this.verificationMethod || 'manual',
            notes: `Status updated from ${oldStatus} to ${newStatus}`,
            performedBy: updatedBy
        });
    }

    return this.save();
};

// Get Public Profile
agentIdentitySchema.methods.getPublicProfile = function () {
    return {
        agentId: this.agentId,
        agentName: this.agentName,
        agentType: this.agentType,
        verified: this.verified,
        status: this.status,
        createdAt: this.createdAt,
        publicKey: this.publicKey,
        keyAlgorithm: this.keyAlgorithm,
        keyFingerprint: this.keyFingerprint
    };
};

// Soft Delete
agentIdentitySchema.methods.softDelete = function (deletedBy) {
    this.status = 'revoked';
    this.auditTrail.deletedAt = new Date();
    this.auditTrail.deletedBy = deletedBy;
    this.auditTrail.restoreToken = crypto.randomBytes(32).toString('hex');
    this.terminateAllSessions();
    return this.save();
};

// Restore
agentIdentitySchema.methods.restore = function (restoreToken) {
    if (this.auditTrail.restoreToken !== restoreToken) {
        throw new Error('Invalid restore token');
    }

    this.status = 'pending_verification';
    this.auditTrail.deletedAt = null;
    this.auditTrail.deletedBy = null;
    this.auditTrail.restoreToken = null;
    return this.save();
};

// Static Methods
agentIdentitySchema.statics.findByPublicKey = function (publicKey) {
    return this.findOne({ publicKey, status: 'active' });
};

agentIdentitySchema.statics.findByOwner = function (ownerId) {
    return this.find({ ownerId, status: { $ne: 'revoked' } }).sort({ createdAt: -1 });
};

agentIdentitySchema.statics.findByType = function (agentType, limit = 10) {
    return this.find({ agentType, status: 'active', verified: true }).limit(limit);
};

agentIdentitySchema.statics.getVerifiedCount = function () {
    return this.countDocuments({ verified: true, status: 'active' });
};

agentIdentitySchema.statics.getNeedingVerification = function (limit = 20) {
    return this.find({
        status: 'pending_verification',
        verified: false
    }).sort({ createdAt: 1 }).limit(limit);
};

// Post-save middleware
agentIdentitySchema.post('save', function (doc) {
    console.log(`✅ Agent saved: ${doc.agentId} - ${doc.agentName}`);
});

module.exports = mongoose.model('AgentIdentity', agentIdentitySchema);