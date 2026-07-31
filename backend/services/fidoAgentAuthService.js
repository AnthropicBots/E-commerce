// backend/services/fidoAgentAuthService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const jwt = require('jsonwebtoken');

// ============================================
// CONFIGURATION
// ============================================

const FIDO_CONFIG = {
    // Authentication parameters
    authType: 'FIDO2',
    algorithm: 'ES256',
    challengeTimeout: 300, // seconds
    
    // Agent authentication
    agentAuthMethods: ['passkey', 'webauthn', 'fido2'],
    
    // Delegation
    delegationLimit: 30, // days
    maxDelegations: 5,
    
    // Verifiable User Instructions
    instructionFormat: 'v1.0',
    requireUserVerification: true,
    
    // Trusted Delegation
    delegationScopes: ['purchase', 'view', 'modify', 'delete']
};

// ============================================
// FIDO AGENT AUTHENTICATION CLASS
// ============================================

class FIDOAgentAuthService {
    constructor() {
        this.agentCredentials = new Map();
        this.userInstructions = new Map();
        this.delegations = new Map();
        this.authSessions = new Map();
        this.challengeCache = new Map();
        this.verifiedAgents = new Map();
    }

    /**
     * Generate authentication challenge for agent
     */
    async generateChallenge(agentId, userId) {
        const challenge = crypto.randomBytes(32).toString('base64url');
        const challengeId = `CHAL_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
        
        const session = {
            id: challengeId,
            agentId,
            userId,
            challenge,
            expiresAt: Date.now() + FIDO_CONFIG.challengeTimeout * 1000,
            createdAt: new Date().toISOString(),
            status: 'pending'
        };

        this.challengeCache.set(challengeId, session);
        this.authSessions.set(agentId, session);

        await this.storeChallenge(challengeId, session);

        console.log(`✅ Challenge generated for agent: ${agentId}`);
        return {
            challengeId,
            challenge,
            expiresAt: session.expiresAt
        };
    }

    /**
     * Verify agent authentication
     */
    async verifyAgent(agentId, challengeId, signature, userInstruction) {
        // 1. Validate challenge
        const session = this.challengeCache.get(challengeId);
        if (!session) {
            throw new Error('Invalid or expired challenge');
        }

        if (session.agentId !== agentId) {
            throw new Error('Agent ID mismatch');
        }

        if (Date.now() > session.expiresAt) {
            throw new Error('Challenge expired');
        }

        // 2. Verify signature
        const isValid = await this.verifySignature(agentId, signature, session.challenge);
        if (!isValid) {
            throw new Error('Invalid signature');
        }

        // 3. Validate user instruction
        const instructionValid = await this.validateUserInstruction(userInstruction);
        if (!instructionValid) {
            throw new Error('Invalid user instruction');
        }

        // 4. Create agent credential
        const credential = await this.createAgentCredential(agentId, {
            userId: session.userId,
            signature,
            userInstruction,
            verifiedAt: new Date().toISOString()
        });

        // 5. Create authentication token
        const token = this.generateAgentToken(agentId, credential);

        // 6. Store verified agent
        this.verifiedAgents.set(agentId, {
            agentId,
            credential,
            token,
            verifiedAt: new Date().toISOString(),
            status: 'active'
        });

        // 7. Update session
        session.status = 'verified';
        this.challengeCache.set(challengeId, session);

        await this.storeVerification(agentId, credential);

        console.log(`✅ Agent verified: ${agentId}`);
        return {
            success: true,
            credential,
            token,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        };
    }

    /**
     * Create trusted delegation
     */
    async createTrustedDelegation(agentId, delegationData) {
        // 1. Verify agent is authenticated
        const agent = this.verifiedAgents.get(agentId);
        if (!agent) {
            throw new Error('Agent not verified');
        }

        // 2. Validate delegation scope
        if (!delegationData.scope) {
            throw new Error('Delegation scope is required');
        }

        if (!FIDO_CONFIG.delegationScopes.includes(delegationData.scope)) {
            throw new Error(`Invalid delegation scope: ${delegationData.scope}`);
        }

        // 3. Check delegation limits
        const delegations = this.delegations.get(agentId) || [];
        if (delegations.length >= FIDO_CONFIG.maxDelegations) {
            throw new Error('Maximum delegations reached');
        }

        // 4. Create delegation
        const delegation = {
            id: this.generateDelegationId(),
            agentId,
            userId: agent.credential.userId,
            scope: delegationData.scope,
            parameters: delegationData.parameters || {},
            expiresAt: new Date(Date.now() + FIDO_CONFIG.delegationLimit * 24 * 60 * 60 * 1000),
            createdAt: new Date().toISOString(),
            status: 'active',
            verifiableInstruction: this.createVerifiableInstruction(agentId, delegationData)
        };

        // 5. Store delegation
        delegations.push(delegation);
        this.delegations.set(agentId, delegations);

        await this.storeDelegation(delegation);

        console.log(`✅ Trusted delegation created for agent: ${agentId}`);
        return delegation;
    }

    /**
     * Execute agent action with delegation
     */
    async executeWithDelegation(agentId, action, data) {
        // 1. Verify agent is authenticated
        const agent = this.verifiedAgents.get(agentId);
        if (!agent) {
            throw new Error('Agent not verified');
        }

        // 2. Check delegations
        const delegations = this.delegations.get(agentId) || [];
        const activeDelegations = delegations.filter(d => 
            d.status === 'active' && new Date(d.expiresAt) > new Date()
        );

        // 3. Find matching delegation
        const delegation = activeDelegations.find(d => d.scope === action);
        if (!delegation) {
            throw new Error(`No active delegation for action: ${action}`);
        }

        // 4. Verify action parameters
        if (delegation.parameters && data) {
            for (const [key, value] of Object.entries(delegation.parameters)) {
                if (data[key] && data[key] > value) {
                    throw new Error(`Parameter ${key} exceeds delegation limit`);
                }
            }
        }

        // 5. Log action
        await this.logAgentAction(agentId, action, data, delegation);

        // 6. Return authorized action
        return {
            authorized: true,
            delegation,
            agent,
            action,
            data,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Create agent credential
     */
    async createAgentCredential(agentId, data) {
        const credential = {
            id: this.generateCredentialId(),
            agentId,
            userId: data.userId,
            publicKey: data.signature || await this.generatePublicKey(),
            userInstruction: data.userInstruction,
            verifiedAt: data.verifiedAt,
            createdAt: new Date().toISOString(),
            status: 'active'
        };

        this.agentCredentials.set(agentId, credential);
        return credential;
    }

    /**
     * Generate agent token
     */
    generateAgentToken(agentId, credential) {
        const payload = {
            agentId,
            userId: credential.userId,
            credentialId: credential.id,
            type: 'fido_agent'
        };

        return jwt.sign(payload, process.env.JWT_SECRET || 'fido_agent_secret', {
            expiresIn: '7d'
        });
    }

    /**
     * Generate delegation ID
     */
    generateDelegationId() {
        return `DEL_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Generate credential ID
     */
    generateCredentialId() {
        return `CRED_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Generate public key
     */
    async generatePublicKey() {
        // In production, use actual key generation
        return crypto.randomBytes(32).toString('base64url');
    }

    /**
     * Verify signature
     */
    async verifySignature(agentId, signature, challenge) {
        // In production, use actual signature verification
        return true;
    }

    /**
     * Validate user instruction
     */
    async validateUserInstruction(instruction) {
        if (!instruction) return false;
        
        const requiredFields = ['userId', 'agentId', 'action', 'timestamp', 'signature'];
        for (const field of requiredFields) {
            if (!instruction[field]) return false;
        }

        // Validate timestamp (within 5 minutes)
        const timestamp = new Date(instruction.timestamp).getTime();
        if (Math.abs(Date.now() - timestamp) > 300000) {
            return false;
        }

        // Validate signature (simplified)
        if (!instruction.signature || instruction.signature.length < 10) {
            return false;
        }

        return true;
    }

    /**
     * Create verifiable instruction
     */
    createVerifiableInstruction(agentId, delegationData) {
        const instruction = {
            version: FIDO_CONFIG.instructionFormat,
            agentId,
            scope: delegationData.scope,
            parameters: delegationData.parameters || {},
            timestamp: new Date().toISOString(),
            nonce: crypto.randomBytes(16).toString('hex'),
            signature: crypto.randomBytes(32).toString('base64url')
        };

        this.userInstructions.set(agentId, instruction);
        return instruction;
    }

    /**
     * Store challenge
     */
    async storeChallenge(challengeId, session) {
        try {
            await db.query(
                `INSERT INTO fido_challenges 
                 (challenge_id, agent_id, user_id, challenge, expires_at, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    challengeId,
                    session.agentId,
                    session.userId,
                    session.challenge,
                    new Date(session.expiresAt).toISOString(),
                    session.status,
                    session.createdAt
                ]
            );
        } catch (error) {
            console.error('Store challenge error:', error);
        }
    }

    /**
     * Store verification
     */
    async storeVerification(agentId, credential) {
        try {
            await db.query(
                `INSERT INTO fido_agent_credentials 
                 (credential_id, agent_id, user_id, public_key, user_instruction, 
                  verified_at, created_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 status = VALUES(status),
                 verified_at = VALUES(verified_at)`,
                [
                    credential.id,
                    agentId,
                    credential.userId,
                    credential.publicKey,
                    JSON.stringify(credential.userInstruction),
                    credential.verifiedAt,
                    credential.createdAt,
                    credential.status
                ]
            );
        } catch (error) {
            console.error('Store verification error:', error);
        }
    }

    /**
     * Store delegation
     */
    async storeDelegation(delegation) {
        try {
            await db.query(
                `INSERT INTO fido_delegations 
                 (delegation_id, agent_id, user_id, scope, parameters, 
                  expires_at, created_at, status, verifiable_instruction)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    delegation.id,
                    delegation.agentId,
                    delegation.userId,
                    delegation.scope,
                    JSON.stringify(delegation.parameters),
                    delegation.expiresAt,
                    delegation.createdAt,
                    delegation.status,
                    JSON.stringify(delegation.verifiableInstruction)
                ]
            );
        } catch (error) {
            console.error('Store delegation error:', error);
        }
    }

    /**
     * Log agent action
     */
    async logAgentAction(agentId, action, data, delegation) {
        try {
            await db.query(
                `INSERT INTO fido_agent_actions 
                 (agent_id, action, data, delegation_id, timestamp)
                 VALUES (?, ?, ?, ?, NOW())`,
                [
                    agentId,
                    action,
                    JSON.stringify(data),
                    delegation.id
                ]
            );
        } catch (error) {
            console.error('Log action error:', error);
        }
    }

    /**
     * Revoke delegation
     */
    async revokeDelegation(agentId, delegationId, reason) {
        const delegations = this.delegations.get(agentId) || [];
        const delegation = delegations.find(d => d.id === delegationId);
        
        if (!delegation) {
            throw new Error('Delegation not found');
        }

        delegation.status = 'revoked';
        delegation.revokedAt = new Date().toISOString();
        delegation.revokeReason = reason;

        await db.query(
            `UPDATE fido_delegations 
             SET status = 'revoked', revoked_at = ?, revoke_reason = ?
             WHERE delegation_id = ?`,
            [delegation.revokedAt, reason, delegationId]
        );

        return delegation;
    }

    /**
     * Get agent status
     */
    async getAgentStatus(agentId) {
        const agent = this.verifiedAgents.get(agentId);
        if (!agent) {
            return { status: 'unverified' };
        }

        const delegations = this.delegations.get(agentId) || [];
        const activeDelegations = delegations.filter(d => 
            d.status === 'active' && new Date(d.expiresAt) > new Date()
        );

        return {
            status: agent.status,
            verifiedAt: agent.verifiedAt,
            credentialId: agent.credential.id,
            delegationCount: activeDelegations.length,
            delegations: activeDelegations
        };
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_agents,
                    COUNT(DISTINCT user_id) as unique_users,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_agents,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as verified_agents
                 FROM fido_agent_credentials`
            );

            const [delegationStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_delegations,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_delegations,
                    COUNT(DISTINCT agent_id) as agents_with_delegations
                 FROM fido_delegations
                 WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            return {
                credentials: stats[0],
                delegations: delegationStats[0],
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            agentCredentials: this.agentCredentials.size,
            userInstructions: this.userInstructions.size,
            delegations: this.delegations.size,
            authSessions: this.authSessions.size,
            verifiedAgents: this.verifiedAgents.size,
            challengeCache: this.challengeCache.size,
            config: FIDO_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new FIDOAgentAuthService();