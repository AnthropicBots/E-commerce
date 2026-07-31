const mongoose = require('mongoose');

const agentScoreSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User ID is required for AgentScore'],
        unique: true
    },
    overallScore: {
        type: Number,
        min: [0, 'Overall score cannot be less than 0'],
        max: [100, 'Overall score cannot exceed 100'],
        default: 0
    },
    riskLevel: {
        type: String,
        enum: {
            values: ['low', 'medium', 'high', 'critical'],
            message: '{VALUE} is not a valid risk level'
        },
        default: 'low'
    },
    factors: {
        cardAdditionVelocity: {
            score: {
                type: Number,
                default: 0,
                min: [0, 'Card addition velocity score cannot be less than 0'],
                max: [100, 'Card addition velocity score cannot exceed 100']
            },
            weight: { type: Number, default: 0.25 }
        },
        paymentFailureRate: {
            score: {
                type: Number,
                default: 0,
                min: [0, 'Payment failure rate score cannot be less than 0'],
                max: [100, 'Payment failure rate score cannot exceed 100']
            },
            weight: { type: Number, default: 0.25 }
        },
        uniqueCardsCount: {
            score: {
                type: Number,
                default: 0,
                min: [0, 'Unique cards count score cannot be less than 0'],
                max: [100, 'Unique cards count score cannot exceed 100']
            },
            weight: { type: Number, default: 0.20 }
        },
        testTransactionPattern: {
            score: {
                type: Number,
                default: 0,
                min: [0, 'Test transaction pattern score cannot be less than 0'],
                max: [100, 'Test transaction pattern score cannot exceed 100']
            },
            weight: { type: Number, default: 0.15 }
        },
        behavioralAnomaly: {
            score: {
                type: Number,
                default: 0,
                min: [0, 'Behavioral anomaly score cannot be less than 0'],
                max: [100, 'Behavioral anomaly score cannot exceed 100']
            },
            weight: { type: Number, default: 0.15 }
        }
    },
    alerts: [{
        type: {
            type: String,
            enum: {
                values: ['warning', 'critical'],
                message: '{VALUE} is not a valid alert type'
            }
        },
        message: {
            type: String,
            trim: true
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        resolved: {
            type: Boolean,
            default: false
        }
    }],
    actionHistory: [{
        action: {
            type: String,
            trim: true
        },
        timestamp: Date,
        reason: {
            type: String,
            trim: true
        }
    }],
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Methods (Bilkul waisa hi rakha gaya hai)
agentScoreSchema.methods.updateScore = function () {
    let totalScore = 0;
    let totalWeight = 0;

    for (const [key, factor] of Object.entries(this.factors)) {
        totalScore += factor.score * factor.weight;
        totalWeight += factor.weight;
    }

    this.overallScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    this.lastUpdated = new Date();

    // Determine risk level
    if (this.overallScore > 80) this.riskLevel = 'critical';
    else if (this.overallScore > 60) this.riskLevel = 'high';
    else if (this.overallScore > 30) this.riskLevel = 'medium';
    else this.riskLevel = 'low';

    return this.save();
};

agentScoreSchema.methods.addAlert = function (type, message) {
    this.alerts.push({ type, message });
    return this.save();
};

module.exports = mongoose.model('AgentScore', agentScoreSchema);