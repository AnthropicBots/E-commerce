const Transaction = require('../models/Transaction');
const Approval = require('../models/Approval');

class RollbackService {
    constructor() {
        this.rollbackStrategies = {
            payment: this.rollbackPayment,
            refund: this.rollbackRefund,
            order: this.rollbackOrder,
            cancellation: this.rollbackCancellation,
            inventory_update: this.rollbackInventory
        };
    }

    /**
     * Initiate rollback for a transaction
     */
    async initiateRollback(transactionId, reason, userId) {
        const transaction = await Transaction.findById(transactionId);
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        // Check if already rolled back
        if (transaction.status === 'rolled_back') {
            throw new Error('Transaction already rolled back');
        }

        // Check if rollback is allowed
        if (!['executed', 'failed'].includes(transaction.status)) {
            throw new Error(`Cannot rollback transaction in ${transaction.status} state`);
        }

        // Create rollback approval
        const approval = new Approval({
            transactionId: transaction._id,
            type: 'rollback_approval',
            requiredApprovals: 2, // Require 2 approvals for rollback
            riskScore: 70,
            context: {
                reason: reason || 'Manual rollback requested',
                priority: 'high'
            }
        });

        await approval.save();

        // Update transaction
        transaction.rollbackRequestId = approval._id;
        await transaction.initiateRollback(reason);

        // Notify approvers
        console.log(`🔄 Rollback initiated for transaction ${transaction.transactionId}`);
        console.log(`   Approval required: ${approval._id}`);

        return { transaction, approval };
    }

    /**
     * Execute rollback after approval
     */
    async executeRollback(transactionId, userId) {
        const transaction = await Transaction.findById(transactionId);
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        if (transaction.rollback.status !== 'pending') {
            throw new Error(`Rollback already ${transaction.rollback.status}`);
        }

        try {
            // Execute rollback based on transaction type
            const strategy = this.rollbackStrategies[transaction.type];
            if (strategy) {
                await strategy.call(this, transaction);
            } else {
                // Generic rollback
                await this.genericRollback(transaction);
            }

            // Mark rollback as completed
            await transaction.completeRollback();

            console.log(`✅ Rollback completed for transaction ${transaction.transactionId}`);

            return transaction;
        } catch (error) {
            await transaction.failRollback(error.message);
            console.error(`❌ Rollback failed for transaction ${transaction.transactionId}:`, error);
            throw error;
        }
    }

    /**
     * Rollback payment transaction
     */
    async rollbackPayment(transaction) {
        // Simulate payment reversal
        transaction.rollback.steps.push({
            action: 'reverse_payment',
            status: 'completed',
            timestamp: new Date()
        });

        transaction.rollback.compensationAmount = transaction.amount;
        
        // In production: Call payment gateway to reverse payment
        console.log(`💳 Payment of ${transaction.amount} reversed`);
    }

    /**
     * Rollback refund transaction
     */
    async rollbackRefund(transaction) {
        // Simulate refund reversal
        transaction.rollback.steps.push({
            action: 'reverse_refund',
            status: 'completed',
            timestamp: new Date()
        });

        console.log(`💰 Refund of ${transaction.amount} reversed`);
    }

    /**
     * Rollback order transaction
     */
    async rollbackOrder(transaction) {
        // Simulate order cancellation
        transaction.rollback.steps.push({
            action: 'cancel_order',
            status: 'completed',
            timestamp: new Date()
        });

        // Restore inventory
        if (transaction.metadata?.items) {
            transaction.rollback.steps.push({
                action: 'restore_inventory',
                status: 'completed',
                timestamp: new Date()
            });
            console.log(`📦 Inventory restored for ${transaction.metadata.items.length} items`);
        }

        console.log(`📦 Order ${transaction.transactionId} cancelled`);
    }

    /**
     * Rollback cancellation transaction
     */
    async rollbackCancellation(transaction) {
        // Simulate cancellation reversal
        transaction.rollback.steps.push({
            action: 'reinstate_order',
            status: 'completed',
            timestamp: new Date()
        });

        console.log(`📦 Cancellation for ${transaction.transactionId} reversed`);
    }

    /**
     * Rollback inventory update
     */
    async rollbackInventory(transaction) {
        // Simulate inventory reversal
        transaction.rollback.steps.push({
            action: 'restore_inventory_levels',
            status: 'completed',
            timestamp: new Date()
        });

        console.log(`📦 Inventory levels restored for ${transaction.transactionId}`);
    }

    /**
     * Generic rollback
     */
    async genericRollback(transaction) {
        transaction.rollback.steps.push({
            action: 'generic_rollback',
            status: 'completed',
            timestamp: new Date()
        });

        console.log(`🔄 Generic rollback performed for ${transaction.transactionId}`);
    }

    /**
     * Check if rollback is possible
     */
    canRollback(transaction) {
        // Can rollback if transaction is executed or failed
        if (!['executed', 'failed'].includes(transaction.status)) {
            return false;
        }

        // Can rollback if not already rolled back
        if (transaction.status === 'rolled_back') {
            return false;
        }

        // Can rollback if rollback not already in progress
        if (transaction.rollback?.status === 'in_progress') {
            return false;
        }

        return true;
    }

    /**
     * Get rollback status
     */
    async getRollbackStatus(transactionId) {
        const transaction = await Transaction.findById(transactionId);
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        return {
            transactionId: transaction.transactionId,
            status: transaction.status,
            rollbackStatus: transaction.rollback?.status || 'not_started',
            initiatedAt: transaction.rollback?.initiatedAt,
            completedAt: transaction.rollback?.completedAt,
            steps: transaction.rollback?.steps || [],
            compensationAmount: transaction.rollback?.compensationAmount
        };
    }
}

module.exports = new RollbackService();