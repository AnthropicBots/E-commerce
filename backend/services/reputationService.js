const AgentTrustScore = require('../models/AgentTrustScore');
const AgentTransaction = require('../models/AgentTransaction');

class ReputationService {
    constructor() {
        this.reputationCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Get agent reputation
     */
    async getAgentReputation(agentId) {
        // Check cache
        if (this.reputationCache.has(agentId)) {
            const cached = this.reputationCache.get(agentId);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }

        const trustScore = await AgentTrustScore.findOne({ agentId });
        if (!trustScore) {
            return null;
        }

        // Calculate reputation
        const reputation = {
            agentId,
            trustScore: trustScore.overallScore,
            trustLevel: trustScore.trustLevel,
            transactionCount: trustScore.metrics.totalTransactions,
            successRate: trustScore.metrics.totalTransactions > 0 ?
                (trustScore.metrics.successfulTransactions / trustScore.metrics.totalTransactions * 100).toFixed(1) :
                'N/A',
            flags: trustScore.flags.filter(f => !f.resolved),
            lastActive: trustScore.lastUpdated
        };

        // Cache
        this.reputationCache.set(agentId, {
            data: reputation,
            timestamp: Date.now()
        });

        return reputation;
    }

    /**
     * Share reputation data across merchants
     */
    async shareReputation(agentId, merchantId) {
        const reputation = await this.getAgentReputation(agentId);
        if (!reputation) {
            throw new Error('Agent not found');
        }

        // Log sharing for audit
        console.log(`📊 Reputation shared for agent ${agentId} with merchant ${merchantId}`);

        return {
            agentId,
            merchantId,
            reputation,
            sharedAt: new Date()
        };
    }

    /**
     * Get cross-merchant reputation
     */
    async getCrossMerchantReputation(agentId) {
        const transactions = await AgentTransaction.find({
            agentId,
            status: 'success'
        });

        const merchantStats = new Map();
        for (const tx of transactions) {
            const merchantId = tx.merchantId.toString();
            if (!merchantStats.has(merchantId)) {
                merchantStats.set(merchantId, {
                    transactions: 0,
                    totalAmount: 0,
                    flags: []
                });
            }
            const stats = merchantStats.get(merchantId);
            stats.transactions++;
            stats.totalAmount += tx.amount || 0;
            if (tx.flags) {
                stats.flags.push(...tx.flags);
            }
        }

        return {
            agentId,
            merchantCount: merchantStats.size,
            totalTransactions: transactions.length,
            merchants: Array.from(merchantStats.entries()).map(([id, stats]) => ({
                merchantId: id,
                ...stats,
                flagCount: stats.flags.length
            }))
        };
    }

    /**
     * Flag suspicious agent
     */
    async flagSuspiciousAgent(agentId, reason, merchantId) {
        const trustScore = await AgentTrustScore.findOne({ agentId });
        if (!trustScore) {
            throw new Error('Agent not found');
        }

        await trustScore.addFlag('critical', `Suspicious activity reported by ${merchantId}: ${reason}`);

        // Update trust score
        trustScore.components.fraudDetection.score = Math.max(0, 
            trustScore.components.fraudDetection.score - 30
        );
        await trustScore.calculateScore();

        // Log for cross-merchant alert
        console.log(`⚠️ Agent ${agentId} flagged by merchant ${merchantId}`);

        return {
            agentId,
            flagReason: reason,
            merchantId,
            newScore: trustScore.overallScore,
            timestamp: new Date()
        };
    }

    /**
     * Clear reputation cache
     */
    clearCache() {
        this.reputationCache.clear();
    }
}

module.exports = new ReputationService();