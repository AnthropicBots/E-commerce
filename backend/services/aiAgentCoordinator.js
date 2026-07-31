// backend/services/aiAgentCoordinator.js
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// CONFIGURATION
// ============================================

const AGENT_CONFIG = {
    maxConcurrentActions: 3,
    actionTimeout: 30000, // 30 seconds
    conflictResolution: 'priority', // 'priority', 'vote', 'manual'
    requireApproval: true,
    maxRetries: 2,
    auditLogging: true
};

const AGENT_PRIORITIES = {
    admin: 100,
    supervisor: 80,
    merchant: 60,
    customer: 40,
    guest: 20,
    system: 200
};

const CONFLICT_DETECTION_RULES = {
    duplicateAction: true,
    conflictingDiscounts: true,
    conflictingInventory: true,
    conflictingOrders: true,
    conflictingPricing: true
};

// ============================================
// AI AGENT COORDINATOR CLASS
// ============================================

class AIAgentCoordinator extends EventEmitter {
    constructor() {
        super();
        this.activeActions = new Map();
        this.actionHistory = [];
        this.agentSessions = new Map();
        this.pendingApprovals = new Map();
        this.conflictCache = new Map();
        this.isInitialized = false;
        
        // Initialize
        this.initialize();
    }

    async initialize() {
        try {
            // Load pending actions from database
            await this.loadPendingActions();
            this.isInitialized = true;
            console.log('✅ AI Agent Coordinator initialized');
        } catch (error) {
            console.error('❌ Coordinator initialization error:', error);
        }
    }

    // ============================================
    // ACTION MANAGEMENT
    // ============================================

    async submitAction(agentId, action, data, context = {}) {
        const actionId = this.generateActionId();
        const timestamp = new Date().toISOString();

        // Create action object
        const actionObj = {
            id: actionId,
            agentId,
            action,
            data,
            context,
            timestamp,
            status: 'pending',
            priority: this.getAgentPriority(agentId),
            retries: context.retryCount || 0,
            conflicts: [],
            approvals: []
        };

        // Check for conflicts
        const conflicts = await this.detectConflicts(actionObj);
        if (conflicts.length > 0) {
            actionObj.conflicts = conflicts;
            actionObj.status = 'conflict_detected';
            this.emit('conflict_detected', { actionId, conflicts });
            
            // Resolve conflicts automatically if possible
            const resolved = await this.resolveConflicts(actionObj);
            if (resolved) {
                actionObj.status = 'pending';
                actionObj.conflicts = [];
            } else {
                return this.handleConflict(actionObj);
            }
        }

        // Check rate limiting
        if (!this.checkRateLimit(agentId)) {
            actionObj.status = 'rate_limited';
            this.emit('action_rate_limited', { actionId, agentId });
            return {
                success: false,
                status: 'rate_limited',
                message: 'Too many actions. Please wait.',
                actionId
            };
        }

        // Check if approval required
        if (AGENT_CONFIG.requireApproval || this.requiresApproval(actionObj)) {
            const approval = await this.requestApproval(actionObj);
            actionObj.approvals.push(approval);
            actionObj.status = 'pending_approval';
            this.emit('approval_requested', { actionId, approval });
            
            return {
                success: true,
                status: 'pending_approval',
                actionId,
                approvalId: approval.id,
                message: 'Action requires approval'
            };
        }

        // Execute action
        try {
            const result = await this.executeAction(actionObj);
            actionObj.status = 'completed';
            actionObj.result = result;
            this.emit('action_completed', { actionId, result });
            
            return {
                success: true,
                status: 'completed',
                actionId,
                result
            };
        } catch (error) {
            actionObj.status = 'failed';
            actionObj.error = error.message;
            this.emit('action_failed', { actionId, error: error.message });
            
            // Retry if configured
            if (actionObj.retries < AGENT_CONFIG.maxRetries) {
                return this.submitAction(agentId, action, data, { ...context, retry: true, retryCount: actionObj.retries + 1 });
            }
            
            return {
                success: false,
                status: 'failed',
                actionId,
                error: error.message
            };
        } finally {
            // Log action
            await this.logAction(actionObj);
            this.actionHistory.push(actionObj);
        }
    }

    // ============================================
    // CONFLICT DETECTION
    // ============================================

    async detectConflicts(action) {
        const conflicts = [];
        const activeActions = Array.from(this.activeActions.values());

        for (const existing of activeActions) {
            // Same agent actions (ignore)
            if (existing.agentId === action.agentId) continue;

            // Check for duplicate actions
            if (CONFLICT_DETECTION_RULES.duplicateAction) {
                if (existing.action === action.action && 
                    JSON.stringify(existing.data) === JSON.stringify(action.data)) {
                    conflicts.push({
                        type: 'duplicate_action',
                        actionId: existing.id,
                        agentId: existing.agentId,
                        timestamp: existing.timestamp
                    });
                }
            }

            // Check for conflicting discounts
            if (CONFLICT_DETECTION_RULES.conflictingDiscounts) {
                if (action.action === 'apply_discount' && 
                    existing.action === 'apply_discount') {
                    const conflict = this.detectDiscountConflict(existing, action);
                    if (conflict) conflicts.push(conflict);
                }
            }

            // Check for conflicting inventory
            if (CONFLICT_DETECTION_RULES.conflictingInventory) {
                if (action.action === 'update_inventory' && 
                    existing.action === 'update_inventory') {
                    const conflict = this.detectInventoryConflict(existing, action);
                    if (conflict) conflicts.push(conflict);
                }
            }

            // Check for conflicting orders
            if (CONFLICT_DETECTION_RULES.conflictingOrders) {
                if (action.action === 'process_order' && 
                    existing.action === 'process_order') {
                    const conflict = this.detectOrderConflict(existing, action);
                    if (conflict) conflicts.push(conflict);
                }
            }
        }

        return conflicts;
    }

    detectDiscountConflict(existing, current) {
        // Check if discounts are applied to same product
        if (existing.data.productId === current.data.productId) {
            // Check if total discount exceeds limit
            const totalDiscount = (existing.data.discount || 0) + (current.data.discount || 0);
            if (totalDiscount > 70) {
                return {
                    type: 'conflicting_discounts',
                    actionId: existing.id,
                    agentId: existing.agentId,
                    totalDiscount,
                    limit: 70,
                    timestamp: existing.timestamp
                };
            }
        }
        return null;
    }

    detectInventoryConflict(existing, current) {
        // Check if same product inventory is being modified
        if (existing.data.productId === current.data.productId) {
            const totalChange = (existing.data.quantity || 0) + (current.data.quantity || 0);
            if (totalChange > 100) {
                return {
                    type: 'conflicting_inventory',
                    actionId: existing.id,
                    agentId: existing.agentId,
                    totalChange,
                    limit: 100,
                    timestamp: existing.timestamp
                };
            }
        }
        return null;
    }

    detectOrderConflict(existing, current) {
        // Check if same user has multiple orders
        if (existing.data.userId === current.data.userId) {
            return {
                type: 'conflicting_orders',
                actionId: existing.id,
                agentId: existing.agentId,
                userId: existing.data.userId,
                timestamp: existing.timestamp
            };
        }
        return null;
    }

    // ============================================
    // CONFLICT RESOLUTION
    // ============================================

    async resolveConflicts(action) {
        if (action.conflicts.length === 0) return true;

        const resolution = AGENT_CONFIG.conflictResolution;

        switch (resolution) {
            case 'priority':
                return this.resolveByPriority(action);
            case 'vote':
                return this.resolveByVote(action);
            case 'manual':
                return false; // Manual resolution needed
            default:
                return false;
        }
    }

    async resolveByPriority(action) {
        // Higher priority agent wins
        const actionPriority = this.getAgentPriority(action.agentId);
        let hasConflict = false;

        for (const conflict of action.conflicts) {
            const existingAction = this.activeActions.get(conflict.actionId);
            if (existingAction) {
                const existingPriority = this.getAgentPriority(existingAction.agentId);
                if (existingPriority > actionPriority) {
                    hasConflict = true;
                    // Block current action
                    action.status = 'blocked';
                    this.emit('action_blocked', { 
                        actionId: action.id, 
                        blockedBy: conflict.actionId 
                    });
                    return false;
                }
            }
        }

        return true;
    }

    async resolveByVote(action) {
        // Not implemented - would require multiple agents to vote
        return false;
    }

    async handleConflict(action) {
        this.emit('conflict_unresolved', { actionId: action.id });
        return {
            success: false,
            status: 'conflict_unresolved',
            actionId: action.id,
            message: 'Action conflicts with existing operations',
            conflicts: action.conflicts
        };
    }

    // ============================================
    // APPROVAL WORKFLOW
    // ============================================

    async requestApproval(action) {
        const approvalId = this.generateApprovalId();
        const approval = {
            id: approvalId,
            actionId: action.id,
            status: 'pending',
            requestedAt: new Date().toISOString(),
            requestedBy: action.agentId,
            approvers: this.getApprovers(action)
        };

        this.pendingApprovals.set(approvalId, approval);
        this.emit('approval_created', { approvalId, actionId: action.id });

        // Store in database
        await this.storeApprovalRequest(approval);

        return approval;
    }

    async approveAction(approvalId, approverId, notes) {
        const approval = this.pendingApprovals.get(approvalId);
        if (!approval) {
            throw new Error('Approval not found');
        }

        approval.status = 'approved';
        approval.approvedBy = approverId;
        approval.approvedAt = new Date().toISOString();
        approval.notes = notes;

        this.emit('action_approved', { approvalId, approverId });

        // Execute the action
        const action = this.activeActions.get(approval.actionId);
        if (action) {
            const result = await this.executeAction(action);
            action.status = 'completed';
            action.result = result;
            this.emit('action_completed', { actionId: action.id, result });
        }

        // Update database
        await this.updateApprovalStatus(approval);

        return approval;
    }

    async rejectAction(approvalId, approverId, reason) {
        const approval = this.pendingApprovals.get(approvalId);
        if (!approval) {
            throw new Error('Approval not found');
        }

        approval.status = 'rejected';
        approval.rejectedBy = approverId;
        approval.rejectedAt = new Date().toISOString();
        approval.reason = reason;

        this.emit('action_rejected', { approvalId, approverId, reason });

        const action = this.activeActions.get(approval.actionId);
        if (action) {
            action.status = 'rejected';
        }

        await this.updateApprovalStatus(approval);

        return approval;
    }

    getApprovers(action) {
        // Determine who can approve based on action type and agent
        const approvers = [];
        
        // For financial actions, require admin
        if (['apply_discount', 'process_payment'].includes(action.action)) {
            approvers.push('admin');
        }
        
        // For inventory actions, require supervisor or admin
        if (action.action === 'update_inventory') {
            approvers.push('supervisor');
            approvers.push('admin');
        }
        
        // For user actions, require admin or supervisor
        if (action.action === 'user_management') {
            approvers.push('admin');
            approvers.push('supervisor');
        }

        return approvers;
    }

    // ============================================
    // EXECUTION ENGINE
    // ============================================

    async executeAction(action) {
        // Track action
        this.activeActions.set(action.id, action);

        try {
            // Simulate action execution - implement actual logic
            let result = { success: true };

            switch (action.action) {
                case 'apply_discount':
                    result = await this.applyDiscount(action.data);
                    break;
                case 'update_inventory':
                    result = await this.updateInventory(action.data);
                    break;
                case 'process_order':
                    result = await this.processOrder(action.data);
                    break;
                case 'user_management':
                    result = await this.manageUser(action.data);
                    break;
                default:
                    result = { success: true, message: 'Action executed' };
            }

            // Add execution metadata
            result.actionId = action.id;
            result.executedAt = new Date().toISOString();
            result.agentId = action.agentId;

            return result;
        } catch (error) {
            throw error;
        } finally {
            // Cleanup
            setTimeout(() => {
                this.activeActions.delete(action.id);
            }, 60000); // Keep for 1 minute for history
        }
    }

    // ============================================
    // ACTION HANDLERS (Placeholders)
    // ============================================

    async applyDiscount(data) {
        // Implement discount application logic
        return {
            success: true,
            action: 'apply_discount',
            discount: data.discount,
            orderTotal: data.orderTotal,
            finalTotal: data.orderTotal - data.discount
        };
    }

    async updateInventory(data) {
        // Implement inventory update logic
        return {
            success: true,
            action: 'update_inventory',
            productId: data.productId,
            quantity: data.quantity
        };
    }

    async processOrder(data) {
        // Implement order processing logic
        return {
            success: true,
            action: 'process_order',
            orderId: data.orderId,
            status: 'processed'
        };
    }

    async manageUser(data) {
        // Implement user management logic
        return {
            success: true,
            action: 'user_management',
            userId: data.userId,
            action: data.action
        };
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    generateActionId() {
        return `ACT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    generateApprovalId() {
        return `APR_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    getAgentPriority(agentId) {
        const session = this.agentSessions.get(agentId);
        return session?.priority || AGENT_PRIORITIES.guest;
    }

    checkRateLimit(agentId) {
        const session = this.agentSessions.get(agentId);
        if (!session) {
            this.agentSessions.set(agentId, { count: 1, lastReset: Date.now() });
            return true;
        }

        const now = Date.now();
        if (now - session.lastReset > 60000) {
            session.count = 1;
            session.lastReset = now;
            return true;
        }

        session.count++;
        return session.count <= AGENT_CONFIG.maxConcurrentActions;
    }

    requiresApproval(action) {
        // Check if action requires approval based on type
        const requireApprovalActions = [
            'apply_discount',
            'process_payment',
            'update_inventory',
            'user_management',
            'delete_product'
        ];
        return requireApprovalActions.includes(action.action);
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadPendingActions() {
        // Load pending actions from database
        const [rows] = await db.query(
            `SELECT * FROM ai_agent_actions 
             WHERE status IN ('pending', 'pending_approval', 'conflict_detected')
             ORDER BY priority DESC, timestamp ASC`
        );
        // Process pending actions
        for (const row of rows) {
            this.activeActions.set(row.id, row);
        }
    }

    async logAction(action) {
        await db.query(
            `INSERT INTO ai_agent_actions 
             (id, agent_id, action, data, status, priority, conflicts, error, result, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                action.id,
                action.agentId,
                action.action,
                JSON.stringify(action.data),
                action.status,
                action.priority,
                JSON.stringify(action.conflicts),
                action.error || null,
                JSON.stringify(action.result || {}),
                action.timestamp
            ]
        );
    }

    async storeApprovalRequest(approval) {
        await db.query(
            `INSERT INTO ai_action_approvals 
             (id, action_id, status, requested_by, approvers, requested_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                approval.id,
                approval.actionId,
                approval.status,
                approval.requestedBy,
                JSON.stringify(approval.approvers),
                approval.requestedAt
            ]
        );
    }

    async updateApprovalStatus(approval) {
        await db.query(
            `UPDATE ai_action_approvals 
             SET status = ?, 
                 approved_by = ?, 
                 approved_at = ?,
                 notes = ?
             WHERE id = ?`,
            [
                approval.status,
                approval.approvedBy || approval.rejectedBy || null,
                approval.approvedAt || approval.rejectedAt || null,
                approval.notes || approval.reason || null,
                approval.id
            ]
        );
    }

    // ============================================
    // MONITORING & REPORTING
    // ============================================

    getStatus() {
        return {
            activeActions: this.activeActions.size,
            pendingApprovals: this.pendingApprovals.size,
            totalActions: this.actionHistory.length,
            activeAgents: this.agentSessions.size,
            isInitialized: this.isInitialized,
            timestamp: new Date().toISOString()
        };
    }

    getMetrics() {
        const completed = this.actionHistory.filter(a => a.status === 'completed');
        const failed = this.actionHistory.filter(a => a.status === 'failed');
        const blocked = this.actionHistory.filter(a => a.status === 'blocked');
        
        return {
            total: this.actionHistory.length,
            completed: completed.length,
            failed: failed.length,
            blocked: blocked.length,
            successRate: this.actionHistory.length > 0 
                ? (completed.length / this.actionHistory.length * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    async getActiveActions() {
        return Array.from(this.activeActions.values());
    }

    async getPendingApprovals() {
        return Array.from(this.pendingApprovals.values());
    }

    getAgentStatus(agentId) {
        const session = this.agentSessions.get(agentId);
        if (!session) return null;
        
        return {
            agentId,
            priority: session.priority,
            actionCount: session.count,
            lastAction: session.lastAction
        };
    }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    AIAgentCoordinator,
    AGENT_CONFIG,
    AGENT_PRIORITIES,
    CONFLICT_DETECTION_RULES
};