const AgentTrustScore = require('../models/AgentTrustScore');
const AgentTransaction = require('../models/AgentTransaction');

class TrustScoringService {
    constructor() {
        this.weightConfig = {
            identityVerification: 0.25,
            transactionHistory: 0.25,
            successRate: 0.20,
            merchantRatings: 0.15,
            fraudDetection: 0.15
        };
    }

    /**
     * Evaluate a transaction and update trust scores
     */
    async evaluateTransaction(transaction) {
        const trustScore = await AgentTrustScore.findOne({
            agentId: transaction.agentId
        });

        if (!trustScore) {
            throw new Error('Trust score not found for agent');
        }

        // Update transaction history component
        await this.updateTransactionHistory(trustScore, transaction);

        // Update success rate component
        await this.updateSuccessRate(trustScore, transaction);

        // Detect fraud patterns
        await this.detectFraud(trustScore, transaction);

        // Recalculate overall score
        await trustScore.calculateScore();

        // Check if score dropped significantly
        const history = trustScore.history;
        if (history.length > 1) {
            const previousScore = history[history.length - 2].score;
            const drop = previousScore - trustScore.overallScore;
            if (drop > 20) {
                await trustScore.addFlag('warning', 
                    `Significant trust score drop: ${drop} points`
                );
            }
        }

        return trustScore;
    }

    /**
     * Update transaction history component
     */
    async updateTransactionHistory(trustScore, transaction) {
        const daysToConsider = 30;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToConsider);

        // Count transactions in last 30 days
        const recentTransactions = await AgentTransaction.countDocuments({
            agentId: trustScore.agentId,
            timestamp: { $gte: cutoffDate }
        });

        // Score: 0 transactions = 0, 50+ transactions = 100
        const score = Math.min(100, (recentTransactions / 50) * 100);
        trustScore.components.transactionHistory.score = score;
    }

    /**
     * Update success rate component
     */
    async updateSuccessRate(trustScore, transaction) {
        if (trustScore.metrics.totalTransactions > 0) {
            const rate = trustScore.metrics.successfulTransactions / 
                        trustScore.metrics.totalTransactions;
            trustScore.components.successRate.score = rate * 100;
        }
    }

    /**
     * Detect fraud patterns
     */
    async detectFraud(trustScore, transaction) {
        let fraudScore = 100;

        // Check for rapid transactions
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentTransactions = await AgentTransaction.countDocuments({
            agentId: trustScore.agentId,
            timestamp: { $gte: oneHourAgo }
        });

        if (recentTransactions > 20) {
            fraudScore -= 20;
            await trustScore.addFlag('warning', 'Rapid transactions detected');
        }

        // Check for high failure rate
        if (trustScore.metrics.totalTransactions > 0) {
            const failureRate = trustScore.metrics.failedTransactions / 
                               trustScore.metrics.totalTransactions;
            if (failureRate > 0.3) {
                fraudScore -= 20;
                await trustScore.addFlag('warning', 'High failure rate');
            }
        }

        // Check for suspicious patterns
        if (transaction.flags && transaction.flags.length > 0) {
            fraudScore -= 30;
            await trustScore.addFlag('critical', 'Suspicious transaction flagged');
        }

        trustScore.components.fraudDetection.score = Math.max(0, fraudScore);
    }

    /**
     * Get trust score details
     */
    async getTrustScoreDetails(agentId) {
        const trustScore = await AgentTrustScore.findOne({ agentId });
        if (!trustScore) {
            throw new Error('Trust score not found');
        }

        return {
            overallScore: trustScore.overallScore,
            trustLevel: trustScore.trustLevel,
            components: trustScore.components,
            metrics: trustScore.metrics,
            flags: trustScore.flags.filter(f => !f.resolved),
            history: trustScore.history.slice(-10)
        };
    }

    /**
     * Get agent reputation across merchants
     */
    async getAgentReputation(agentId) {
        // Get all transactions
        const transactions = await AgentTransaction.find({
            agentId,
            status: 'success'
        });

        // Group by merchant
        const merchantMap = new Map();
        for (const tx of transactions) {
            const merchantId = tx.merchantId.toString();
            if (!merchantMap.has(merchantId)) {
                merchantMap.set(merchantId, {
                    transactions: 0,
                    successful: 0,
                    totalAmount: 0
                });
            }
            const data = merchantMap.get(merchantId);
            data.transactions++;
            if (tx.status === 'success') data.successful++;
            data.totalAmount += tx.amount || 0;
        }

        return {
            agentId,
            totalMerchants: merchantMap.size,
            totalTransactions: transactions.length,
            merchants: Array.from(merchantMap.entries()).map(([merchantId, data]) => ({
                merchantId,
                ...data,
                successRate: data.transactions > 0 ? 
                    (data.successful / data.transactions * 100).toFixed(1) : 0
            }))
        };
    }
}

module.exports = new TrustScoringService();