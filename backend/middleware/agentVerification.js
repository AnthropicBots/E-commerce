const AgentIdentityService = require('../services/agentIdentityService');
const TrustScoringService = require('../services/trustScoringService');
const ReputationService = require('../services/reputationService');

/**
 * Verify agent identity using cryptographic signatures
 */
const verifyAgentIdentity = async (req, res, next) => {
    try {
        const { agentId, signature, data } = req.body;

        if (!agentId || !signature) {
            return res.status(400).json({
                error: 'Agent ID and signature required'
            });
        }

        // Verify signature
        const isValid = await AgentIdentityService.verifySignature(
            agentId,
            data || req.body,
            signature
        );

        if (!isValid) {
            return res.status(401).json({
                error: 'Invalid agent signature - potential impersonation'
            });
        }

        // Get agent identity
        const agent = await AgentIdentityService.getAgentIdentity(agentId);
        if (!agent) {
            return res.status(404).json({
                error: 'Agent not found'
            });
        }

        // Check if agent is active
        if (agent.agent.status !== 'active') {
            return res.status(403).json({
                error: `Agent is ${agent.agent.status}`
            });
        }

        // Check trust score
        if (agent.trustScore && agent.trustScore.overallScore < 20) {
            return res.status(403).json({
                error: 'Agent trust score too low',
                trustScore: agent.trustScore.overallScore,
                required: 20
            });
        }

        req.verifiedAgent = agent;
        next();
    } catch (error) {
        console.error("AGENT VERIFICATION ERROR:", error);

        res.status(500).json({
            error: "Agent verification failed"
        });
    }
};

/**
 * Check agent reputation
 */
const checkAgentReputation = async (req, res, next) => {
    try {
        const { agentId } = req.params;

        const reputation = await ReputationService.getAgentReputation(agentId);
        if (!reputation) {
            return res.status(404).json({
                error: 'Agent reputation not found'
            });
        }

        // Check if reputation is acceptable
        if (reputation.trustScore < 40) {
            return res.status(403).json({
                error: 'Agent reputation too low',
                reputation: reputation,
                required: 40
            });
        }

        // Check for active flags
        if (reputation.flags && reputation.flags.length > 0) {
            const criticalFlags = reputation.flags.filter(f => f.type === 'critical');
            if (criticalFlags.length > 0) {
                return res.status(403).json({
                    error: 'Agent has critical flags',
                    flags: criticalFlags
                });
            }
        }

        req.agentReputation = reputation;
        next();
    } catch (error) {
        console.error("AGENT REPUTATION CHECK ERROR:", error);

        return res.status(500).json({
            success: false,
            error: "Agent reputation check failed"
        });
    }
};

/**
 * Log agent action for trust scoring
 */
const logAgentAction = async (req, res, next) => {
    try {
        const { agentId, action, data } = req.body;
        const merchantId = req.user?.id;

        // Create transaction record
        const AgentTransaction = require('../models/AgentTransaction');
        const transaction = new AgentTransaction({
            agentId,
            merchantId,
            type: 'action',
            status: 'pending',
            action,
            data: data || {},
            signature: req.body.signature || 'verified',
            timestamp: new Date()
        });

        await transaction.save();

        req.agentTransaction = transaction;
        next();
    } catch (error) {
        console.error('Error logging agent action:', error);
        next(); // Don't block on logging errors
    }
};

/**
 * Update trust score after action
 */
const updateTrustScore = async (req, res, next) => {
    try {
        if (req.agentTransaction) {
            const transaction = req.agentTransaction;
            const responseStatus = res.statusCode < 400 ? 'success' : 'failed';

            transaction.status = responseStatus;
            await transaction.save();

            // Update trust score
            const TrustScoringService = require('../services/trustScoringService');
            await TrustScoringService.evaluateTransaction(transaction);
        }
        next();
    } catch (error) {
        console.error('Error updating trust score:', error);
        next();
    }
};

module.exports = {
    verifyAgentIdentity,
    checkAgentReputation,
    logAgentAction,
    updateTrustScore
};