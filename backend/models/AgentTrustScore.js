const mongoose = require('mongoose');

const agentTrustScoreSchema = new mongoose.Schema({
    agentId: {
        type: String,
        ref: 'AgentIdentity',
        required: true,
        unique: true,
        index: true
    },
    overallScore: {
        type: Number,
        min: 0,
        max: 100,
        default: 50
    },
    trustLevel: {
        type: String,
        enum: ['untrusted', 'low', 'medium', 'high', 'verified'],
        default: 'low',
        index: true
    },
    components: {
        identityVerification: {
            score: { type: Number, default: 0 },
            weight: { type: Number, default: 0.25 }
        },
        transactionHistory: {
            score: { type: Number, default: 0 },
            weight: { type: Number, default: 0.25 }
        },
        successRate: {
            score: { type: Number, default: 0 },
            weight: { type: Number, default: 0.20 }
        },
        merchantRatings: {
            score: { type: Number, default: 0 },
            weight: { type: Number, default: 0.15 }
        },
        fraudDetection: {
            score: { type: Number, default: 0 },
            weight: { type: Number, default: 0.15 }
        }
    },
    metrics: {
        totalTransactions: { type: Number, default: 0 },
        successfulTransactions: { type: Number, default: 0 },
        failedTransactions: { type: Number, default: 0 },
        flaggedTransactions: { type: Number, default: 0 },
        disputedTransactions: { type: Number, default: 0 },
        averageResponseTime: { type: Number, default: 0 },
        uptime: { type: Number, default: 100 },
        lastTransactionDate: Date,
        transactionHistory: [{
            transactionId: String,
            status: {
                type: String,
                enum: ['success', 'failed', 'flagged', 'disputed']
            },
            timestamp: { type: Date, default: Date.now },
            amount: Number
        }]
    },
    history: [{
        score: Number,
        trustLevel: String,
        reason: String,
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        timestamp: { type: Date, default: Date.now }
    }],
    flags: [{
        type: {
            type: String,
            enum: ['warning', 'critical', 'review', 'suspension']
        },
        reason: String,
        severity: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'medium'
        },
        timestamp: { type: Date, default: Date.now },
        resolved: { type: Boolean, default: false },
        resolvedAt: Date,
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        resolutionNotes: String
    }],
    status: {
        type: String,
        enum: ['active', 'suspended', 'under_review', 'terminated'],
        default: 'active',
        index: true
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: new Map()
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtuals
agentTrustScoreSchema.virtual('successRatePercentage').get(function() {
    if (this.metrics.totalTransactions === 0) return 0;
    return (this.metrics.successfulTransactions / this.metrics.totalTransactions) * 100;
});

agentTrustScoreSchema.virtual('isTrusted').get(function() {
    return this.trustLevel === 'verified' || this.trustLevel === 'high';
});

agentTrustScoreSchema.virtual('hasCriticalIssues').get(function() {
    return this.flags.some(flag => flag.type === 'critical' && !flag.resolved);
});

// Calculate Score
agentTrustScoreSchema.methods.calculateScore = function() {
    let totalScore = 0;
    let totalWeight = 0;

    for (const [key, component] of Object.entries(this.components)) {
        totalScore += component.score * component.weight;
        totalWeight += component.weight;
    }

    this.overallScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
    this.lastUpdated = new Date();
    this.updateTrustLevel();
    this.addHistoryEntry('Auto-calculated from weighted components');
    this.updateSuccessRateComponent();

    return this.save();
};

// Update Trust Level
agentTrustScoreSchema.methods.updateTrustLevel = function() {
    if (this.overallScore >= 85) this.trustLevel = 'verified';
    else if (this.overallScore >= 70) this.trustLevel = 'high';
    else if (this.overallScore >= 50) this.trustLevel = 'medium';
    else if (this.overallScore >= 30) this.trustLevel = 'low';
    else this.trustLevel = 'untrusted';
};

// Add History Entry
agentTrustScoreSchema.methods.addHistoryEntry = function(reason, changedBy = null) {
    this.history.push({
        score: this.overallScore,
        trustLevel: this.trustLevel,
        reason: reason || 'Score update',
        changedBy,
        timestamp: new Date()
    });

    if (this.history.length > 100) {
        this.history = this.history.slice(-100);
    }
};

// Add Flag
agentTrustScoreSchema.methods.addFlag = function(type, reason, severity = 'medium') {
    const existingFlag = this.flags.find(f => 
        f.type === type && f.reason === reason && !f.resolved
    );

    if (existingFlag) {
        existingFlag.timestamp = new Date();
        return this.save();
    }

    this.flags.push({ type, reason, severity, timestamp: new Date(), resolved: false });
    this.addHistoryEntry(`Flag added: ${type} - ${reason}`);
    return this.save();
};

// Resolve Flag
agentTrustScoreSchema.methods.resolveFlag = function(flagIndex, resolvedBy, resolutionNotes) {
    if (flagIndex < 0 || flagIndex >= this.flags.length) {
        throw new Error('Invalid flag index');
    }

    const flag = this.flags[flagIndex];
    if (flag.resolved) {
        throw new Error('Flag already resolved');
    }

    flag.resolved = true;
    flag.resolvedAt = new Date();
    flag.resolvedBy = resolvedBy;
    flag.resolutionNotes = resolutionNotes || 'Resolved';

    this.addHistoryEntry(`Flag resolved: ${flag.type} - ${flag.reason}`, resolvedBy);
    return this.save();
};

// Update Metrics
agentTrustScoreSchema.methods.updateMetrics = function(transaction) {
    if (!transaction || !transaction.status) {
        throw new Error('Invalid transaction data');
    }

    this.metrics.totalTransactions++;
    this.metrics.lastTransactionDate = new Date();

    this.metrics.transactionHistory.push({
        transactionId: transaction.id || `txn_${Date.now()}`,
        status: transaction.status,
        timestamp: new Date(),
        amount: transaction.amount || 0
    });

    if (this.metrics.transactionHistory.length > 500) {
        this.metrics.transactionHistory = this.metrics.transactionHistory.slice(-500);
    }

    switch(transaction.status) {
        case 'success': this.metrics.successfulTransactions++; break;
        case 'failed': this.metrics.failedTransactions++; break;
        case 'flagged': this.metrics.flaggedTransactions++; break;
        case 'disputed': this.metrics.disputedTransactions++; break;
    }

    this.updateSuccessRateComponent();
    return this.calculateScore();
};

// Update Success Rate Component
agentTrustScoreSchema.methods.updateSuccessRateComponent = function() {
    const successRate = this.successRatePercentage;
    this.components.successRate.score = Math.round(successRate);
};

// Update Identity Verification Score
agentTrustScoreSchema.methods.updateIdentityScore = function(score) {
    this.components.identityVerification.score = Math.min(Math.max(score, 0), 100);
    return this.calculateScore();
};

// Get Trust Report
agentTrustScoreSchema.methods.getTrustReport = function() {
    return {
        agentId: this.agentId,
        overallScore: this.overallScore,
        trustLevel: this.trustLevel,
        status: this.status,
        components: {
            identityVerification: this.components.identityVerification.score,
            transactionHistory: this.components.transactionHistory.score,
            successRate: this.components.successRate.score,
            merchantRatings: this.components.merchantRatings.score,
            fraudDetection: this.components.fraudDetection.score
        },
        metrics: {
            totalTransactions: this.metrics.totalTransactions,
            successRate: this.successRatePercentage,
            uptime: this.metrics.uptime
        },
        activeFlags: this.flags.filter(f => !f.resolved),
        generatedAt: new Date().toISOString()
    };
};

// Check if Reliable
agentTrustScoreSchema.methods.isReliable = function(threshold = 60) {
    return this.overallScore >= threshold && 
           this.status === 'active' &&
           !this.hasCriticalIssues &&
           this.metrics.uptime >= 95;
};

// Get Recommended Action
agentTrustScoreSchema.methods.getRecommendedAction = function() {
    const actions = {
        'verified': { action: 'Approve', message: 'Fully trusted agent', priority: 'low' },
        'high': { action: 'Approve with monitoring', message: 'Highly trusted, monitor regularly', priority: 'low' },
        'medium': { action: 'Review and monitor', message: 'Moderate trust, additional verification recommended', priority: 'medium' },
        'low': { action: 'Investigate', message: 'Low trust, investigate before high-value transactions', priority: 'high' },
        'untrusted': { action: 'Restrict', message: 'Untrusted agent, restrict operations', priority: 'critical' }
    };
    return actions[this.trustLevel] || actions['medium'];
};

// Static Methods
agentTrustScoreSchema.statics.findByTrustLevel = function(level) {
    return this.find({ trustLevel: level, status: 'active' });
};

agentTrustScoreSchema.statics.getTopTrusted = function(limit = 10) {
    return this.find({ status: 'active' }).sort({ overallScore: -1 }).limit(limit);
};

agentTrustScoreSchema.statics.getAgentsNeedingReview = function() {
    return this.find({
        $or: [
            { trustLevel: { $in: ['low', 'untrusted'] } },
            { 'flags.type': 'critical', 'flags.resolved': false }
        ],
        status: 'active'
    }).sort({ overallScore: 1 });
};

// Pre-save middleware
agentTrustScoreSchema.pre('save', function(next) {
    if (this.history.length > 100) {
        this.history = this.history.slice(-100);
    }
    this.lastUpdated = new Date();
    next();
});

// Post-save middleware
agentTrustScoreSchema.post('save', function(doc) {
    console.log(`✅ Trust score updated for agent ${doc.agentId}: ${doc.overallScore} (${doc.trustLevel})`);
});

module.exports = mongoose.model('AgentTrustScore', agentTrustScoreSchema);