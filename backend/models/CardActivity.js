// models/CardActivity.js
const mongoose = require('mongoose');
const crypto = require('crypto');

// ============================================
// CONSTANTS
// ============================================

const DETECTION_FLAGS = [
    'rapid_card_addition',
    'multiple_failures',
    'test_transaction',
    'unusual_bin',
    'high_velocity',
    'compromised_agent',
    'unusual_time',
    'device_anomaly'
];

const ACTIONS = [
    'card_added',
    'payment_attempt',
    'payment_success',
    'payment_failed',
    'card_removed',
    'card_updated'
];

const PAYMENT_STATUSES = ['pending', 'success', 'failed', 'declined'];

// ============================================
// ENCRYPTION HELPERS
// ============================================

// Get encryption key from environment
const ENCRYPTION_KEY = process.env.CARD_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
    if (!encryptedText) return encryptedText;
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

function validateLastFour(value) {
    if (!value) return true;
    return /^\d{4}$/.test(value);
}

function validateBin(value) {
    if (!value) return true;
    return /^\d{6}$/.test(value);
}

function validateIpAddress(value) {
    // IPv4 and IPv6 validation
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    return ipv4Regex.test(value) || ipv6Regex.test(value);
}

function validateSessionId(value) {
    if (!value) return false;
    return /^[a-zA-Z0-9-_]{10,}$/.test(value);
}

function validateCardId(value) {
    if (!value) return false;
    // Accepts masked card IDs, UUIDs, or custom format
    return /^[a-zA-Z0-9-_]{4,}$/.test(value);
}

// ============================================
// SCHEMA DEFINITION
// ============================================

const cardActivitySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'userId is required']
    },
    cardId: {
        type: String,
        required: [true, 'cardId is required'],
        validate: {
            validator: validateCardId,
            message: 'Invalid cardId format'
        }
    },
    action: {
        type: String,
        enum: {
            values: ACTIONS,
            message: 'Invalid action. Must be one of: {VALUE}'
        },
        required: [true, 'action is required']
    },
    cardDetails: {
        lastFour: {
            type: String,
            validate: {
                validator: validateLastFour,
                message: 'lastFour must be exactly 4 digits'
            },
            set: function(value) {
                if (value) {
                    // Store encrypted
                    this._lastFourEncrypted = encrypt(value);
                    return value;
                }
                return value;
            },
            get: function(value) {
                if (this._lastFourEncrypted && !value) {
                    return decrypt(this._lastFourEncrypted);
                }
                return value;
            }
        },
        issuer: {
            type: String,
            maxlength: [100, 'issuer cannot exceed 100 characters'],
            trim: true
        },
        country: {
            type: String,
            maxlength: [2, 'country must be a 2-letter code'],
            uppercase: true,
            trim: true
        },
        bin: {
            type: String,
            validate: {
                validator: validateBin,
                message: 'BIN must be exactly 6 digits'
            },
            set: function(value) {
                if (value) {
                    this._binEncrypted = encrypt(value);
                    return value;
                }
                return value;
            },
            get: function(value) {
                if (this._binEncrypted && !value) {
                    return decrypt(this._binEncrypted);
                }
                return value;
            }
        },
        cardType: {
            type: String,
            enum: {
                values: ['credit', 'debit', 'prepaid'],
                message: 'cardType must be credit, debit, or prepaid'
            },
            default: 'credit'
        },
        cardBrand: {
            type: String,
            enum: {
                values: ['visa', 'mastercard', 'amex', 'discover', 'rupay', 'other'],
                message: 'Invalid card brand'
            }
        },
        expiryMonth: {
            type: Number,
            min: [1, 'expiryMonth must be between 1 and 12'],
            max: [12, 'expiryMonth must be between 1 and 12']
        },
        expiryYear: {
            type: Number,
            min: [2000, 'expiryYear must be between 2000 and 2099'],
            max: [2099, 'expiryYear must be between 2000 and 2099']
        }
    },
    paymentAmount: {
        type: Number,
        default: 0,
        min: [0, 'paymentAmount must be a positive number'],
        validate: {
            validator: function(value) {
                return value >= 0;
            },
            message: 'paymentAmount must be a positive number'
        }
    },
    paymentStatus: {
        type: String,
        enum: {
            values: PAYMENT_STATUSES,
            message: 'Invalid payment status. Must be one of: {VALUE}'
        },
        default: 'pending'
    },
    ipAddress: {
        type: String,
        required: [true, 'ipAddress is required'],
        validate: {
            validator: validateIpAddress,
            message: 'Invalid IP address format'
        }
    },
    userAgent: {
        type: String,
        required: [true, 'userAgent is required'],
        maxlength: [500, 'userAgent cannot exceed 500 characters']
    },
    sessionId: {
        type: String,
        required: [true, 'sessionId is required'],
        validate: {
            validator: validateSessionId,
            message: 'Invalid sessionId format'
        }
    },
    riskScore: {
        type: Number,
        min: [0, 'riskScore must be between 0 and 100'],
        max: [100, 'riskScore must be between 0 and 100'],
        default: 0
    },
    isSuspicious: {
        type: Boolean,
        default: false
    },
    detectionFlags: [{
        type: String,
        enum: {
            values: DETECTION_FLAGS,
            message: 'Invalid detection flag. Must be one of: {VALUE}'
        }
    }],
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    // Audit trail
    auditTrail: [{
        action: {
            type: String,
            enum: ACTIONS
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        ipAddress: String,
        userAgent: String,
        changes: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    }],
    // Soft delete
    deletedAt: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'suspended', 'deleted'],
        default: 'active'
    },
    // Geo-location
    geoLocation: {
        city: String,
        state: String,
        country: String,
        countryCode: String,
        zipCode: String,
        coordinates: {
            lat: Number,
            lng: Number
        }
    },
    // Device fingerprint
    deviceFingerprint: {
        type: String,
        index: true
    }
}, {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true }
});

// ============================================
// INDEXES
// ============================================

// Primary indexes
cardActivitySchema.index({ userId: 1, timestamp: -1 });
cardActivitySchema.index({ cardId: 1, timestamp: -1 });
cardActivitySchema.index({ isSuspicious: 1, timestamp: -1 });
cardActivitySchema.index({ action: 1, timestamp: -1 });
cardActivitySchema.index({ 'cardDetails.lastFour': 1 });
cardActivitySchema.index({ status: 1, timestamp: -1 });
cardActivitySchema.index({ deviceFingerprint: 1 });

// TTL index for old activities (90 days)
cardActivitySchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });

// Compound indexes for common queries
cardActivitySchema.index({ userId: 1, action: 1, timestamp: -1 });
cardActivitySchema.index({ userId: 1, isSuspicious: 1, timestamp: -1 });

// ============================================
// VIRTUALS
// ============================================

cardActivitySchema.virtual('isDeleted').get(function() {
    return this.deletedAt !== null || this.status === 'deleted';
});

cardActivitySchema.virtual('isActive').get(function() {
    return this.status === 'active' && this.deletedAt === null;
});

cardActivitySchema.virtual('cardCount').get(function() {
    return this._cardCount || 0;
});

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Soft delete card activity
 */
cardActivitySchema.methods.softDelete = async function() {
    this.deletedAt = new Date();
    this.status = 'deleted';
    return this.save();
};

/**
 * Restore soft deleted card activity
 */
cardActivitySchema.methods.restore = async function() {
    this.deletedAt = null;
    this.status = 'active';
    return this.save();
};

/**
 * Add audit trail entry
 */
cardActivitySchema.methods.addAuditEntry = function(action, changes, ipAddress, userAgent) {
    this.auditTrail.push({
        action,
        timestamp: new Date(),
        ipAddress: ipAddress || this.ipAddress,
        userAgent: userAgent || this.userAgent,
        changes: changes || {}
    });
    return this.save();
};

/**
 * Update risk score
 */
cardActivitySchema.methods.updateRiskScore = function(score) {
    if (score < 0 || score > 100) {
        throw new Error('Risk score must be between 0 and 100');
    }
    this.riskScore = score;
    return this.save();
};

/**
 * Mark as suspicious with reason
 */
cardActivitySchema.methods.markSuspicious = function(flag) {
    this.isSuspicious = true;
    if (flag && !this.detectionFlags.includes(flag)) {
        this.detectionFlags.push(flag);
    }
    return this.save();
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get suspicious activities
 */
cardActivitySchema.statics.getSuspicious = function(limit = 100) {
    return this.find({ isSuspicious: true })
        .sort({ timestamp: -1 })
        .limit(limit);
};

/**
 * Get activities by user
 */
cardActivitySchema.statics.getByUser = function(userId, limit = 50, offset = 0) {
    return this.find({ userId, status: 'active' })
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit);
};

/**
 * Get activities by card
 */
cardActivitySchema.statics.getByCard = function(cardId, limit = 50, offset = 0) {
    return this.find({ cardId, status: 'active' })
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit);
};

/**
 * Get stats for user
 */
cardActivitySchema.statics.getUserStats = async function(userId) {
    const total = await this.countDocuments({ userId, status: 'active' });
    const suspicious = await this.countDocuments({ userId, isSuspicious: true });
    const successful = await this.countDocuments({ 
        userId, 
        action: 'payment_success',
        status: 'active' 
    });
    const failed = await this.countDocuments({ 
        userId, 
        action: 'payment_failed',
        status: 'active' 
    });

    const lastActivity = await this.findOne({ userId, status: 'active' })
        .sort({ timestamp: -1 });

    return {
        total,
        suspicious,
        successful,
        failed,
        lastActivity: lastActivity ? lastActivity.timestamp : null,
        successRate: total > 0 ? (successful / total) * 100 : 0
    };
};

// ============================================
// PRE / POST HOOKS
// ============================================

// Update timestamp on save
cardActivitySchema.pre('save', function(next) {
    if (this.isModified('cardDetails.lastFour') && this.cardDetails.lastFour) {
        this._lastFourEncrypted = encrypt(this.cardDetails.lastFour);
    }
    if (this.isModified('cardDetails.bin') && this.cardDetails.bin) {
        this._binEncrypted = encrypt(this.cardDetails.bin);
    }
    next();
});

// ============================================
// EXPORTS
// ============================================

module.exports = mongoose.model('CardActivity', cardActivitySchema);