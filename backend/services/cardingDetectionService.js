const CardActivity = require('../models/CardActivity');
const AgentScore = require('../models/AgentScore');

class CardingDetectionService {
    constructor() {
        // Configuration
        this.config = {
            rapidCardThreshold: 3, // Max cards in 24 hours
            rapidCardWindow: 24 * 60 * 60 * 1000, // 24 hours
            failureThreshold: 3, // Max failures in 1 hour
            failureWindow: 60 * 60 * 1000, // 1 hour
            testTransactionThreshold: 0.50, // Amount considered "test"
            velocityWindow: 60 * 60 * 1000, // 1 hour
            maxCardsPerUser: 10, // Total cards per user
        };
    }

    /**
     * Detect rapid card addition
     */
    async detectRapidCardAddition(userId, cardData) {
        const windowStart = new Date(Date.now() - this.config.rapidCardWindow);

        const recentCards = await CardActivity.find({
            userId,
            action: 'card_added',
            timestamp: { $gte: windowStart }
        });

        // Check if exceeded threshold
        if (recentCards.length >= this.config.rapidCardThreshold) {
            return {
                detected: true,
                type: 'rapid_card_addition',
                severity: 'high',
                count: recentCards.length + 1,
                threshold: this.config.rapidCardThreshold,
                message: `User added ${recentCards.length + 1} cards in 24 hours`
            };
        }

        // Check if same card is being added multiple times
        const duplicateCard = recentCards.some(c => 
            c.cardDetails.lastFour === cardData.lastFour
        );

        if (duplicateCard) {
            return {
                detected: true,
                type: 'duplicate_card_addition',
                severity: 'medium',
                message: 'Same card added multiple times'
            };
        }

        return { detected: false };
    }

    /**
     * Detect test transactions (small amounts)
     */
    async detectTestTransaction(userId, amount) {
        if (amount <= this.config.testTransactionThreshold) {
            // Check if there are multiple small transactions
            const windowStart = new Date(Date.now() - this.config.failureWindow);

            const testTransactions = await CardActivity.find({
                userId,
                action: 'payment_attempt',
                paymentAmount: { $lte: this.config.testTransactionThreshold },
                timestamp: { $gte: windowStart }
            });

            if (testTransactions.length >= 2) {
                return {
                    detected: true,
                    type: 'test_transaction_pattern',
                    severity: 'critical',
                    count: testTransactions.length + 1,
                    message: `Multiple test transactions (${testTransactions.length + 1}) detected`
                };
            }
        }

        return { detected: false };
    }

    /**
     * Detect multiple payment failures
     */
    async detectPaymentFailures(userId) {
        const windowStart = new Date(Date.now() - this.config.failureWindow);

        const failedPayments = await CardActivity.find({
            userId,
            action: 'payment_attempt',
            paymentStatus: 'failed',
            timestamp: { $gte: windowStart }
        });

        if (failedPayments.length >= this.config.failureThreshold) {
            return {
                detected: true,
                type: 'multiple_payment_failures',
                severity: 'high',
                count: failedPayments.length,
                threshold: this.config.failureThreshold,
                message: `${failedPayments.length} payment failures in 1 hour`
            };
        }

        return { detected: false };
    }

    /**
     * Detect unusual BIN patterns
     */
    detectUnusualBIN(bin) {
        // Check for known fraudulent BINs
        const suspiciousBINs = ['123456', '987654', '111111', '000000'];
        
        if (suspiciousBINs.includes(bin)) {
            return {
                detected: true,
                type: 'suspicious_bin',
                severity: 'critical',
                message: `Suspicious BIN detected: ${bin}`
            };
        }

        // Check for invalid BIN (not starting with 4, 5, 3, 6)
        const validPrefixes = ['4', '5', '3', '6'];
        if (!validPrefixes.includes(bin.charAt(0))) {
            return {
                detected: true,
                type: 'invalid_bin',
                severity: 'high',
                message: `Invalid BIN prefix: ${bin}`
            };
        }

        return { detected: false };
    }

    /**
     * Detect unusual time patterns
     */
    detectUnusualTime() {
        const hour = new Date().getHours();
        if (hour < 3 || hour > 23) {
            return {
                detected: true,
                type: 'unusual_time',
                severity: 'medium',
                message: `Transaction at unusual hour: ${hour}:00`
            };
        }
        return { detected: false };
    }

    /**
     * Comprehensive carding detection
     */
    async detectCarding(userId, cardData, paymentAmount = 0) {
        const flags = [];
        const detections = [];

        // 1. Rapid card addition
        const rapidDetection = await this.detectRapidCardAddition(userId, cardData);
        if (rapidDetection.detected) {
            flags.push(rapidDetection.type);
            detections.push(rapidDetection);
        }

        // 2. Test transaction
        if (paymentAmount > 0) {
            const testDetection = await this.detectTestTransaction(userId, paymentAmount);
            if (testDetection.detected) {
                flags.push(testDetection.type);
                detections.push(testDetection);
            }
        }

        // 3. Payment failures
        const failureDetection = await this.detectPaymentFailures(userId);
        if (failureDetection.detected) {
            flags.push(failureDetection.type);
            detections.push(failureDetection);
        }

        // 4. Unusual BIN
        if (cardData.bin) {
            const binDetection = this.detectUnusualBIN(cardData.bin);
            if (binDetection.detected) {
                flags.push(binDetection.type);
                detections.push(binDetection);
            }
        }

        // 5. Unusual time
        const timeDetection = this.detectUnusualTime();
        if (timeDetection.detected) {
            flags.push(timeDetection.type);
            detections.push(timeDetection);
        }

        // Calculate risk score
        const riskScore = this.calculateRiskScore(detections);

        return {
            isSuspicious: detections.length > 0,
            flags,
            detections,
            riskScore,
            shouldBlock: detections.some(d => d.severity === 'critical')
        };
    }

    /**
     * Calculate risk score based on detections
     */
    calculateRiskScore(detections) {
        let score = 0;
        const severityWeights = {
            low: 10,
            medium: 25,
            high: 50,
            critical: 80
        };

        for (const detection of detections) {
            score += severityWeights[detection.severity] || 0;
        }

        return Math.min(100, score);
    }

    /**
     * Log card activity
     */
    async logCardActivity(data) {
        const activity = new CardActivity({
            userId: data.userId,
            cardId: data.cardId,
            action: data.action,
            cardDetails: {
                lastFour: data.lastFour,
                issuer: data.issuer,
                country: data.country,
                bin: data.bin
            },
            paymentAmount: data.paymentAmount || 0,
            paymentStatus: data.paymentStatus || 'pending',
            ipAddress: data.ipAddress,
            userAgent: data.userAgent,
            sessionId: data.sessionId,
            riskScore: data.riskScore || 0,
            isSuspicious: data.isSuspicious || false,
            detectionFlags: data.detectionFlags || [],
            metadata: data.metadata || {}
        });

        await activity.save();

        // Update agent score
        await this.updateAgentScore(data.userId);

        return activity;
    }

    /**
     * Update agent security score
     */
    async updateAgentScore(userId) {
        let agentScore = await AgentScore.findOne({ userId });

        if (!agentScore) {
            agentScore = new AgentScore({ userId });
        }

        // Calculate card addition velocity score
        const cardVelocity = await this.getCardAdditionVelocity(userId);
        agentScore.factors.cardAdditionVelocity.score = Math.min(100, cardVelocity * 20);

        // Calculate payment failure rate score
        const failureRate = await this.getPaymentFailureRate(userId);
        agentScore.factors.paymentFailureRate.score = Math.min(100, failureRate * 30);

        // Calculate unique cards count score
        const uniqueCards = await this.getUniqueCardsCount(userId);
        agentScore.factors.uniqueCardsCount.score = Math.min(100, (uniqueCards / this.config.maxCardsPerUser) * 100);

        // Calculate test transaction pattern score
        const testPattern = await this.getTestTransactionPattern(userId);
        agentScore.factors.testTransactionPattern.score = Math.min(100, testPattern * 25);

        // Calculate behavioral anomaly score
        const anomalyScore = await this.getBehavioralAnomalyScore(userId);
        agentScore.factors.behavioralAnomaly.score = Math.min(100, anomalyScore * 20);

        // Update overall score
        await agentScore.updateScore();

        // Add alerts if score is high
        if (agentScore.overallScore > 80) {
            await agentScore.addAlert(
                'critical',
                `Agent score reached ${agentScore.overallScore}% - immediate review required`
            );
        } else if (agentScore.overallScore > 60) {
            await agentScore.addAlert(
                'warning',
                `Agent score reached ${agentScore.overallScore}% - monitor closely`
            );
        }

        return agentScore;
    }

    /**
     * Get card addition velocity (cards per hour)
     */
    async getCardAdditionVelocity(userId) {
        const windowStart = new Date(Date.now() - this.config.velocityWindow);

        const count = await CardActivity.countDocuments({
            userId,
            action: 'card_added',
            timestamp: { $gte: windowStart }
        });

        return count / (this.config.velocityWindow / (60 * 60 * 1000));
    }

    /**
     * Get payment failure rate
     */
    async getPaymentFailureRate(userId) {
        const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const total = await CardActivity.countDocuments({
            userId,
            action: 'payment_attempt',
            timestamp: { $gte: windowStart }
        });

        const failed = await CardActivity.countDocuments({
            userId,
            action: 'payment_attempt',
            paymentStatus: 'failed',
            timestamp: { $gte: windowStart }
        });

        return total > 0 ? failed / total : 0;
    }

    /**
     * Get unique cards count
     */
    async getUniqueCardsCount(userId) {
        const cards = await CardActivity.distinct('cardId', { userId });
        return cards.length;
    }

    /**
     * Get test transaction pattern score
     */
    async getTestTransactionPattern(userId) {
        const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const testTransactions = await CardActivity.find({
            userId,
            action: 'payment_attempt',
            paymentAmount: { $lte: this.config.testTransactionThreshold },
            timestamp: { $gte: windowStart }
        });

        return Math.min(1, testTransactions.length / 5);
    }

    /**
     * Get behavioral anomaly score
     */
    async getBehavioralAnomalyScore(userId) {
        // Check for patterns that indicate compromised agent
        const patterns = [];

        // Check for rapid card addition
        const rapid = await this.detectRapidCardAddition(userId, {});
        if (rapid.detected) patterns.push(1);

        // Check for test transactions
        const test = await this.detectTestTransaction(userId, 0.01);
        if (test.detected) patterns.push(1);

        // Check for payment failures
        const failures = await this.detectPaymentFailures(userId);
        if (failures.detected) patterns.push(1);

        return patterns.length / 3;
    }
}

module.exports = new CardingDetectionService();