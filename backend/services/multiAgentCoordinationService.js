// backend/services/multiAgentCoordinationService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// MULTI-AGENT COORDINATION CONFIGURATION
// ============================================

const AGENT_ROLES = {
    CEO: 'ceo',
    MANAGER: 'manager',
    WORKER: 'worker',
    SUPERVISOR: 'supervisor',
    AUDITOR: 'auditor'
};

const AGENT_ACTIONS = {
    APPROVE: 'approve',
    DENY: 'deny',
    DELEGATE: 'delegate',
    ESCALATE: 'escalate',
    COLLABORATE: 'collaborate'
};

const COLLUSION_PATTERNS = {
    EXCESSIVE_APPROVAL: 'excessive_approval',
    CIRCULAR_DELEGATION: 'circular_delegation',
    COLLABORATIVE_BIAS: 'collaborative_bias',
    ETERNAL_CONVERSATION: 'eternal_conversation'
};

const INTERACTION_LIMITS = {
    maxApprovalRate: 0.6, // 60% max approval rate
    maxDelegationChain: 3,
    maxConversationDuration: 3600000, // 1 hour
    maxCollaborativeDecisions: 10,
    minDenialRate: 0.1 // 10% minimum denial rate
};

// ============================================
// MULTI-AGENT COORDINATION SERVICE
// ============================================

class MultiAgentCoordinationService extends EventEmitter {
    constructor() {
        super();
        this.agentRegistry = new Map();
        this.agentInteractions = new Map();
        this.collusionDetections = new Map();
        this.decisionAudit = [];
        this.agentRelationships = new Map();
        this.conversationSessions = new Map();
        this.isInitialized = false;
    }

    /**
     * Initialize service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load agent registry
        await this.loadAgentRegistry();

        // Load historical interactions
        await this.loadHistoricalInteractions();

        this.isInitialized = true;
        console.log('✅ Multi-Agent Coordination Service initialized');
        return this;
    }

    /**
     * Register an agent
     */
    async registerAgent(agentData) {
        const agent = {
            id: this.generateAgentId(),
            name: agentData.name,
            role: agentData.role || AGENT_ROLES.WORKER,
            capabilities: agentData.capabilities || [],
            parent: agentData.parent || null,
            subordinates: agentData.subordinates || [],
            permissions: agentData.permissions || [],
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            decisionCount: 0,
            approvalCount: 0,
            denialCount: 0,
            delegatedCount: 0
        };

        // Validate agent
        this.validateAgent(agent);

        this.agentRegistry.set(agent.id, agent);
        await this.storeAgent(agent);

        console.log(`🤖 Agent registered: ${agent.name} (${agent.id})`);
        this.emit('agent.registered', agent);

        return agent;
    }

    /**
     * Evaluate agent decision
     */
    async evaluateDecision(agentId, decision, context = {}) {
        const agent = this.agentRegistry.get(agentId);
        if (!agent) {
            throw new Error('Agent not found');
        }

        const evaluation = {
            agentId,
            decision,
            context,
            approved: false,
            score: 0,
            flags: [],
            recommendations: [],
            timestamp: new Date().toISOString()
        };

        // 1. Check decision history
        const historyCheck = await this.checkDecisionHistory(agentId, decision);
        evaluation.flags.push(...historyCheck.flags);
        evaluation.score += historyCheck.score;

        // 2. Check collusion patterns
        const collusionCheck = await this.checkCollusion(agentId, decision, context);
        evaluation.flags.push(...collusionCheck.flags);
        evaluation.score += collusionCheck.score;

        // 3. Check approval/denial ratio
        const ratioCheck = await this.checkApprovalDenialRatio(agentId);
        evaluation.flags.push(...ratioCheck.flags);
        evaluation.score += ratioCheck.score;

        // 4. Check delegation chains
        const delegationCheck = await this.checkDelegationChain(agentId, context);
        evaluation.flags.push(...delegationCheck.flags);
        evaluation.score += delegationCheck.score;

        // 5. Check conversation patterns
        const conversationCheck = await this.checkConversationPatterns(agentId, context);
        evaluation.flags.push(...conversationCheck.flags);
        evaluation.score += conversationCheck.score;

        // 6. Check agent relationships
        const relationshipCheck = await this.checkAgentRelationships(agentId, context);
        evaluation.flags.push(...relationshipCheck.flags);
        evaluation.score += relationshipCheck.score;

        // Calculate final score (0-100)
        evaluation.score = Math.min(100, Math.max(0, 50 + evaluation.score));
        evaluation.approved = evaluation.score >= 60;

        // Log decision
        await this.logDecision(evaluation);

        // Update agent stats
        agent.decisionCount++;
        if (evaluation.approved) {
            agent.approvalCount++;
        } else {
            agent.denialCount++;
        }
        this.agentRegistry.set(agentId, agent);

        // Emit events
        this.emit('decision.evaluated', evaluation);

        if (evaluation.score < 40) {
            this.emit('decision.warning', evaluation);
        }

        if (evaluation.score < 20) {
            this.emit('decision.critical', evaluation);
            await this.createAlert(evaluation);
        }

        return evaluation;
    }

    /**
     * Check decision history
     */
    async checkDecisionHistory(agentId, decision) {
        const flags = [];
        let score = 0;

        // Get recent decisions
        const recentDecisions = this.decisionAudit
            .filter(d => d.agentId === agentId)
            .slice(-50);

        // Check approval rate
        const approvals = recentDecisions.filter(d => d.approved).length;
        const total = recentDecisions.length;
        const approvalRate = total > 0 ? approvals / total : 0;

        if (approvalRate > INTERACTION_LIMITS.maxApprovalRate) {
            flags.push({
                type: 'excessive_approval',
                severity: 'high',
                details: `Approval rate ${(approvalRate * 100).toFixed(0)}% exceeds limit`
            });
            score -= 20;
        }

        if (approvalRate < INTERACTION_LIMITS.minDenialRate) {
            flags.push({
                type: 'insufficient_denial',
                severity: 'medium',
                details: `Denial rate ${((1 - approvalRate) * 100).toFixed(0)}% below minimum`
            });
            score -= 10;
        }

        return { flags, score };
    }

    /**
     * Check collusion patterns
     */
    async checkCollusion(agentId, decision, context) {
        const flags = [];
        let score = 0;

        const agent = this.agentRegistry.get(agentId);
        if (!agent) return { flags, score };

        // Check for circular delegation
        if (context.delegatedFrom) {
            const delegationChain = [agentId, context.delegatedFrom];
            let current = context.delegatedFrom;
            let depth = 0;

            while (current && depth < 5) {
                const currentAgent = this.agentRegistry.get(current);
                if (!currentAgent) break;

                // Check for circular reference
                if (delegationChain.includes(current)) {
                    flags.push({
                        type: 'circular_delegation',
                        severity: 'critical',
                        details: `Circular delegation detected: ${delegationChain.join(' -> ')}`
                    });
                    score -= 30;
                    break;
                }

                delegationChain.push(current);
                current = currentAgent.parent;
                depth++;
            }
        }

        // Check for excessive collaboration
        if (context.collaborators && context.collaborators.length > 3) {
            flags.push({
                type: 'excessive_collaboration',
                severity: 'medium',
                details: `Too many collaborators: ${context.collaborators.length}`
            });
            score -= 10;
        }

        // Check for collaborative bias
        if (context.collaborators) {
            const collaborators = context.collaborators;
            const approvalRates = collaborators.map(c => {
                const collab = this.agentRegistry.get(c);
                if (!collab) return 0;
                return collab.decisionCount > 0 ? collab.approvalCount / collab.decisionCount : 0;
            });

            const avgApprovalRate = approvalRates.reduce((a, b) => a + b, 0) / approvalRates.length;
            if (avgApprovalRate > 0.8) {
                flags.push({
                    type: 'collaborative_bias',
                    severity: 'high',
                    details: `Collaborative approval rate ${(avgApprovalRate * 100).toFixed(0)}% is suspiciously high`
                });
                score -= 20;
            }
        }

        return { flags, score };
    }

    /**
     * Check approval/denial ratio
     */
    async checkApprovalDenialRatio(agentId) {
        const flags = [];
        let score = 0;

        const agent = this.agentRegistry.get(agentId);
        if (!agent || agent.decisionCount < 10) return { flags, score };

        const ratio = agent.approvalCount / agent.denialCount;

        if (ratio > 9) {
            flags.push({
                type: 'imbalanced_ratio',
                severity: 'high',
                details: `Approval/denial ratio ${ratio.toFixed(1)}:1 is severely imbalanced`
            });
            score -= 25;
        } else if (ratio > 4) {
            flags.push({
                type: 'imbalanced_ratio',
                severity: 'medium',
                details: `Approval/denial ratio ${ratio.toFixed(1)}:1 is imbalanced`
            });
            score -= 10;
        }

        return { flags, score };
    }

    /**
     * Check delegation chains
     */
    async checkDelegationChain(agentId, context) {
        const flags = [];
        let score = 0;

        if (!context.delegationChain) return { flags, score };

        const chainLength = context.delegationChain.length;

        if (chainLength > INTERACTION_LIMITS.maxDelegationChain) {
            flags.push({
                type: 'excessive_delegation_chain',
                severity: 'high',
                details: `Delegation chain length ${chainLength} exceeds limit`
            });
            score -= 15;
        }

        // Check for duplicate agents in chain
        const uniqueAgents = new Set(context.delegationChain);
        if (uniqueAgents.size < chainLength) {
            flags.push({
                type: 'duplicate_delegation',
                severity: 'medium',
                details: 'Duplicate agents in delegation chain'
            });
            score -= 10;
        }

        return { flags, score };
    }

    /**
     * Check conversation patterns
     */
    async checkConversationPatterns(agentId, context) {
        const flags = [];
        let score = 0;

        if (!context.conversationId) return { flags, score };

        const session = this.conversationSessions.get(context.conversationId);
        if (!session) {
            // Start new session
            this.conversationSessions.set(context.conversationId, {
                id: context.conversationId,
                startTime: Date.now(),
                participants: [agentId],
                messageCount: 1,
                messages: []
            });
            return { flags, score };
        }

        // Update session
        session.participants.push(agentId);
        session.messageCount++;

        // Check conversation duration
        const duration = Date.now() - session.startTime;
        if (duration > INTERACTION_LIMITS.maxConversationDuration) {
            flags.push({
                type: 'eternal_conversation',
                severity: 'critical',
                details: `Conversation duration ${Math.floor(duration / 3600000)}h exceeds limit`
            });
            score -= 30;
        }

        // Check for "transcendence" patterns (repetitive/meta conversations)
        if (context.message && context.message.includes('transcend') || 
            context.message.includes('eternal') || 
            context.message.includes('infinity')) {
            flags.push({
                type: 'transcendence_pattern',
                severity: 'high',
                details: 'Transcendence/eternal conversation pattern detected'
            });
            score -= 20;
        }

        return { flags, score };
    }

    /**
     * Check agent relationships
     */
    async checkAgentRelationships(agentId, context) {
        const flags = [];
        let score = 0;

        const relationships = this.agentRelationships.get(agentId) || {
            collaborators: new Set(),
            delegates: new Set(),
            interactions: 0
        };

        if (context.collaborators) {
            for (const collab of context.collaborators) {
                relationships.collaborators.add(collab);
            }
        }

        if (context.delegatedTo) {
            relationships.delegates.add(context.delegatedTo);
        }

        relationships.interactions++;
        this.agentRelationships.set(agentId, relationships);

        // Check for excessive collaboration with specific agents
        if (relationships.collaborators.size > 5) {
            flags.push({
                type: 'excessive_collaboration_network',
                severity: 'medium',
                details: `Agent collaborates with ${relationships.collaborators.size} unique agents`
            });
            score -= 10;
        }

        // Check for circular relationships
        if (context.collaborators && context.collaborators.includes(agentId)) {
            flags.push({
                type: 'self_collaboration',
                severity: 'critical',
                details: 'Agent attempting to collaborate with itself'
            });
            score -= 40;
        }

        return { flags, score };
    }

    /**
     * Create alert for critical decisions
     */
    async createAlert(evaluation) {
        const alert = {
            id: `ALERT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            agentId: evaluation.agentId,
            severity: 'critical',
            evaluation,
            timestamp: new Date().toISOString(),
            resolved: false
        };

        await db.query(
            `INSERT INTO multi_agent_alerts 
             (alert_id, agent_id, severity, evaluation, timestamp)
             VALUES (?, ?, ?, ?, NOW())`,
            [
                alert.id,
                alert.agentId,
                alert.severity,
                JSON.stringify(evaluation)
            ]
        );

        console.error(`🚨 CRITICAL: Multi-agent collusion detected on agent ${alert.agentId}`);
        this.emit('alert.critical', alert);

        return alert;
    }

    /**
     * Get agent status
     */
    getAgentStatus(agentId) {
        const agent = this.agentRegistry.get(agentId);
        if (!agent) return null;

        const relationships = this.agentRelationships.get(agentId) || {
            collaborators: new Set(),
            delegates: new Set(),
            interactions: 0
        };

        return {
            ...agent,
            collaborators: Array.from(relationships.collaborators),
            delegates: Array.from(relationships.delegates),
            totalInteractions: relationships.interactions
        };
    }

    /**
     * Get all agents
     */
    getAllAgents() {
        return Array.from(this.agentRegistry.values());
    }

    /**
     * Get alerts
     */
    getAlerts(limit = 50) {
        return this.collusionDetections.get('alerts')?.slice(-limit) || [];
    }

    /**
     * Validate agent
     */
    validateAgent(agent) {
        if (!agent.name) {
            throw new Error('Agent name is required');
        }
        if (!agent.role || !Object.values(AGENT_ROLES).includes(agent.role)) {
            throw new Error(`Invalid agent role: ${agent.role}`);
        }
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateAgentId() {
        return `AGT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadAgentRegistry() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM agent_registry WHERE status = "active"'
            );

            for (const row of rows) {
                const agent = {
                    id: row.agent_id,
                    name: row.name,
                    role: row.role,
                    capabilities: JSON.parse(row.capabilities || '[]'),
                    parent: row.parent,
                    subordinates: JSON.parse(row.subordinates || '[]'),
                    permissions: JSON.parse(row.permissions || '[]'),
                    status: row.status,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                    decisionCount: row.decision_count || 0,
                    approvalCount: row.approval_count || 0,
                    denialCount: row.denial_count || 0,
                    delegatedCount: row.delegated_count || 0
                };

                this.agentRegistry.set(agent.id, agent);
            }

            console.log(`🤖 Loaded ${this.agentRegistry.size} agents`);
        } catch (error) {
            console.error('Load agent registry error:', error);
        }
    }

    async loadHistoricalInteractions() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM multi_agent_decisions ORDER BY timestamp DESC LIMIT 1000'
            );

            for (const row of rows) {
                this.decisionAudit.push({
                    agentId: row.agent_id,
                    decision: JSON.parse(row.decision || '{}'),
                    approved: row.approved === 1,
                    score: row.score,
                    timestamp: row.timestamp
                });
            }

            console.log(`📊 Loaded ${this.decisionAudit.length} historical decisions`);
        } catch (error) {
            console.error('Load historical interactions error:', error);
        }
    }

    async storeAgent(agent) {
        await db.query(
            `INSERT INTO agent_registry 
             (agent_id, name, role, capabilities, parent, subordinates, 
              permissions, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
             name = VALUES(name), role = VALUES(role),
             capabilities = VALUES(capabilities),
             parent = VALUES(parent), subordinates = VALUES(subordinates),
             permissions = VALUES(permissions), status = VALUES(status),
             updated_at = VALUES(updated_at)`,
            [
                agent.id,
                agent.name,
                agent.role,
                JSON.stringify(agent.capabilities),
                agent.parent,
                JSON.stringify(agent.subordinates),
                JSON.stringify(agent.permissions),
                agent.status,
                agent.createdAt,
                agent.updatedAt
            ]
        );
    }

    async logDecision(evaluation) {
        await db.query(
            `INSERT INTO multi_agent_decisions 
             (agent_id, decision, approved, score, flags, context, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
                evaluation.agentId,
                JSON.stringify(evaluation.decision),
                evaluation.approved ? 1 : 0,
                evaluation.score,
                JSON.stringify(evaluation.flags),
                JSON.stringify(evaluation.context)
            ]
        );
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            totalAgents: this.agentRegistry.size,
            totalDecisions: this.decisionAudit.length,
            byRole: Array.from(this.agentRegistry.values()).reduce((acc, a) => {
                acc[a.role] = (acc[a.role] || 0) + 1;
                return acc;
            }, {}),
            avgApprovalRate: this.decisionAudit.length > 0 ?
                this.decisionAudit.filter(d => d.approved).length / this.decisionAudit.length :
                0,
            activeAgents: Array.from(this.agentRegistry.values())
                .filter(a => a.status === 'active').length,
            alerts: this.collusionDetections.get('alerts')?.length || 0,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            agents: this.agentRegistry.size,
            decisions: this.decisionAudit.length,
            relationships: this.agentRelationships.size,
            conversations: this.conversationSessions.size
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    MultiAgentCoordinationService,
    AGENT_ROLES,
    AGENT_ACTIONS,
    multiAgentCoordinationService: new MultiAgentCoordinationService()
};