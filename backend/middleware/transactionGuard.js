const Transaction = require('../models/Transaction');

/**
 * Guard against bad faith actors
 */
const guardAgainstBadActors = async (req, res, next) => {
    try {
        const { transactionId } = req.params;
        const user = req.user;

        const transaction = await Transaction.findById(transactionId);
        if (!transaction) {
            return res.status(404).json({
                error: 'Transaction not found'
            });
        }

        // Check for suspicious patterns
        const suspiciousPatterns = [];

        // Check amount anomaly
        if (transaction.amount > 10000) {
            suspiciousPatterns.push('High transaction amount');
        }

        // Check for rapid transactions
        const recentTransactions = await Transaction.find({
            initiatedBy: user._id,
            createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
        });

        if (recentTransactions.length > 5) {
            suspiciousPatterns.push('Rapid transaction activity');
        }

        // Check for unusual time
        const hour = new Date().getHours();
        if (hour < 6 || hour > 23) {
            suspiciousPatterns.push('Unusual transaction time');
        }

        if (suspiciousPatterns.length > 0) {
            return res.status(403).json({
                error: 'Transaction blocked due to suspicious activity',
                suspiciousPatterns,
                requiresVerification: true
            });
        }

        next();
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Guard against contextual ambiguity
 */
const guardAgainstAmbiguity = async (req, res, next) => {
    try {
        const { transactionId } = req.params;

        const transaction = await Transaction.findById(transactionId);
        if (!transaction) {
            return res.status(404).json({
                error: 'Transaction not found'
            });
        }

        // Check for ambiguous conditions
        const ambiguousConditions = [];

        // Check if AI confidence is low
        if (transaction.agentDecision?.confidence < 0.5) {
            ambiguousConditions.push('Low AI confidence');
        }

        // Check for missing context
        if (!transaction.metadata?.context) {
            ambiguousConditions.push('Missing transaction context');
        }

        // Check for conflicting data
        if (transaction.metadata?.conflicting) {
            ambiguousConditions.push('Conflicting transaction data');
        }

        if (ambiguousConditions.length > 0) {
            return res.status(409).json({
                error: 'Transaction has ambiguous conditions',
                ambiguousConditions,
                requiresHumanReview: true
            });
        }

        next();
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Guard against autonomous AI failures
 */
const guardAIFailure = async (req, res, next) => {
    try {
        const { transactionId } = req.params;

        const transaction = await Transaction.findById(transactionId);
        if (!transaction) {
            return res.status(404).json({
                error: 'Transaction not found'
            });
        }

        // Check for AI failure patterns
        const failurePatterns = [];

        // Check if AI decision was overridden
        if (transaction.metadata?.overridden) {
            failurePatterns.push('AI decision overridden');
        }

        // Check for AI errors
        if (transaction.execution?.error) {
            failurePatterns.push('AI execution error: ' + transaction.execution.error);
        }

        // Check for AI uncertainty
        if (transaction.agentDecision?.uncertainty > 0.5) {
            failurePatterns.push('High AI uncertainty');
        }

        if (failurePatterns.length > 0) {
            // Log AI failure for monitoring
            console.warn('⚠️ AI failure detected:', failurePatterns);

            // Require human intervention
            return res.status(409).json({
                error: 'AI failure detected - human intervention required',
                failurePatterns,
                requiresHumanIntervention: true
            });
        }

        next();
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

module.exports = {
    guardAgainstBadActors,
    guardAgainstAmbiguity,
    guardAIFailure
};