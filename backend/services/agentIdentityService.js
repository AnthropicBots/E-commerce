const AgentIdentity = require('../models/AgentIdentity');
const AgentTrustScore = require('../models/AgentTrustScore');
const AgentTransaction = require('../models/AgentTransaction');
const crypto = require('crypto');

class AgentIdentityService {
    constructor() {
        this.verificationMethods = {
            manual: this.verifyManually,
            automated: this.verifyAutomated,
            third_party: this.verifyThirdParty
        };
    }

    /**
     * Register a new AI agent
     */
    async registerAgent(agentData) {
        const {
            agentName,
            agentType,
            ownerId,
            ownerType,
            registrationProof,
            metadata
        } = agentData;

        // Check if agent already exists
        const existingAgent = await AgentIdentity.findOne({
            agentName,
            ownerId
        });

        if (existingAgent) {
            throw new Error('Agent already registered');
        }

        // Create agent identity
        const agent = new AgentIdentity({
            agentName,
            agentType,
            ownerId,
            ownerType,
            registrationProof,
            metadata,
            status: 'pending_verification'
        });

        // Generate cryptographic keys
        await agent.generateKeyPair();

        // Save agent
        await agent.save();

        // Create trust score
        const trustScore = new AgentTrustScore({
            agentId: agent.agentId
        });
        await trustScore.save();

        return {
            agentId: agent.agentId,
            publicKey: agent.publicKey,
            status: agent.status
        };
    }

    /**
     * Verify an agent
     */
    async verifyAgent(agentId, method = 'manual', verifiedBy = null) {
        const agent = await AgentIdentity.findOne({ agentId });
        if (!agent) {
            throw new Error('Agent not found');
        }

        if (agent.verified) {
            throw new Error('Agent already verified');
        }

        // Perform verification
        const verificationMethod = this.verificationMethods[method];
        if (!verificationMethod) {
            throw new Error('Invalid verification method');
        }

        const result = await verificationMethod(agent);

        if (result.success) {
            agent.verified = true;
            agent.verificationMethod = method;
            agent.verifiedAt = new Date();
            agent.verifiedBy = verifiedBy;
            agent.status = 'active';
            await agent.save();

            // Update trust score
            const trustScore = await AgentTrustScore.findOne({ agentId });
            if (trustScore) {
                trustScore.components.identityVerification.score = 100;
                await trustScore.calculateScore();
            }
        }

        return {
            success: result.success,
            agentId: agent.agentId,
            method,
            timestamp: new Date()
        };
    }

    /**
     * Manual verification
     */
    async verifyManually(agent) {
        // In production, this would involve document verification
        // For now, just check if proof exists
        return {
            success: !!agent.registrationProof,
            details: 'Manual verification successful'
        };
    }

    /**
     * Automated verification
     */
    async verifyAutomated(agent) {
        // Automated checks:
        // 1. Check agent name against known patterns
        // 2. Validate registration proof
        // 3. Check for duplicate agents
        // 4. Verify key strength

        const checks = [];

        // Check key strength
        if (agent.publicKey && agent.publicKey.includes('2048')) {
            checks.push({ check: 'key_strength', passed: true });
        } else {
            checks.push({ check: 'key_strength', passed: false });
        }

        // Check for duplicates
        const duplicates = await AgentIdentity.find({
            agentName: agent.agentName,
            _id: { $ne: agent._id }
        });
        checks.push({
            check: 'no_duplicates',
            passed: duplicates.length === 0
        });

        const allPassed = checks.every(c => c.passed);

        return {
            success: allPassed,
            details: checks,
            timestamp: new Date()
        };
    }

    /**
     * Third-party verification
     */
    async verifyThirdParty(agent) {
        // Simulate third-party verification
        // In production, this would call external verification service
        return {
            success: true,
            details: 'Third-party verification successful',
            reference: `REF-${crypto.randomBytes(4).toString('hex')}`
        };
    }

    /**
     * Get agent identity
     */
    async getAgentIdentity(agentId) {
        const agent = await AgentIdentity.findOne({ agentId })
            .select('-privateKey -registrationProof');

        if (!agent) {
            throw new Error('Agent not found');
        }

        // Get trust score
        const trustScore = await AgentTrustScore.findOne({ agentId });

        return {
            agent,
            trustScore
        };
    }

    /**
     * Sign data with agent's private key
     */
    async signData(agentId, data) {
        const agent = await AgentIdentity.findOne({ agentId });
        if (!agent) {
            throw new Error('Agent not found');
        }

        return agent.sign(data);
    }

    /**
     * Verify signature
     */
    async verifySignature(agentId, data, signature) {
        const agent = await AgentIdentity.findOne({ agentId });
        if (!agent) {
            throw new Error('Agent not found');
        }

        return agent.verify(data, signature);
    }

    /**
     * Suspend agent
     */
    async suspendAgent(agentId, reason) {
        const agent = await AgentIdentity.findOne({ agentId });
        if (!agent) {
            throw new Error('Agent not found');
        }

        agent.status = 'suspended';
        await agent.save();

        // Update trust score
        const trustScore = await AgentTrustScore.findOne({ agentId });
        if (trustScore) {
            await trustScore.addFlag('critical', `Agent suspended: ${reason}`);
        }

        return agent;
    }

    /**
     * Revoke agent
     */
    async revokeAgent(agentId, reason) {
        const agent = await AgentIdentity.findOne({ agentId });
        if (!agent) {
            throw new Error('Agent not found');
        }

        agent.status = 'revoked';
        await agent.save();

        // Update trust score
        const trustScore = await AgentTrustScore.findOne({ agentId });
        if (trustScore) {
            trustScore.trustLevel = 'untrusted';
            trustScore.overallScore = 0;
            await trustScore.addFlag('critical', `Agent revoked: ${reason}`);
            await trustScore.save();
        }

        return agent;
    }

    /**
     * List agents for a user
     */
    async listUserAgents(ownerId) {
        const agents = await AgentIdentity.find({ ownerId })
            .select('-privateKey -registrationProof')
            .sort({ createdAt: -1 });

        // Get trust scores for each agent
        const agentIds = agents.map(a => a.agentId);
        const trustScores = await AgentTrustScore.find({
            agentId: { $in: agentIds }
        });

        return agents.map(agent => ({
            ...agent.toObject(),
            trustScore: trustScores.find(t => t.agentId === agent.agentId)
        }));
    }

    // ============================================
    // Issue #1261 — Agent session / refresh-token family binding
    // ============================================

    /**
     * Bind an agent identity to a human user's refresh-token family.
     * Enables cascade logout of agent credentials when token reuse is detected.
     */
    async bindAgentToTokenFamily(agentId, familyId, metadata = {}) {
        const agent = await AgentIdentity.findOne({ agentId });
        if (!agent) {
            throw new Error('Agent not found');
        }

        agent.metadata = {
            ...(agent.metadata || {}),
            refreshTokenFamilyId: familyId,
            sessionBoundAt: new Date().toISOString(),
            deviceFingerprint: metadata.deviceFingerprint || null,
            lastSessionIp: metadata.ipAddress || null
        };
        await agent.save();

        return {
            agentId: agent.agentId,
            familyId,
            bound: true
        };
    }

    /**
     * Verify the agent is still bound to a non-revoked token family.
     * `isFamilyRevokedFn` should resolve Redis/MySQL revocation state.
     */
    async verifyAgentSessionFamily(agentId, isFamilyRevokedFn) {
        const agent = await AgentIdentity.findOne({ agentId })
            .select('-privateKey -registrationProof');

        if (!agent) {
            throw new Error('Agent not found');
        }

        const familyId = agent.metadata?.refreshTokenFamilyId;
        if (!familyId) {
            return {
                valid: false,
                reason: 'no_family_bound',
                agentId
            };
        }

        const revoked = typeof isFamilyRevokedFn === 'function'
            ? await isFamilyRevokedFn(familyId)
            : false;

        if (revoked || agent.status === 'revoked' || agent.status === 'suspended') {
            return {
                valid: false,
                reason: revoked ? 'family_revoked' : `agent_${agent.status}`,
                agentId,
                familyId
            };
        }

        return {
            valid: true,
            agentId,
            familyId,
            status: agent.status
        };
    }

    /**
     * Cascade: clear family bindings for all agents owned by a user
     * after refresh-token reuse / force re-auth.
     */
    async revokeAgentSessionsForUser(ownerId, reason = 'refresh_token_reuse_cascade') {
        const agents = await AgentIdentity.find({ ownerId });
        let cleared = 0;

        for (const agent of agents) {
            if (agent.metadata?.refreshTokenFamilyId) {
                agent.metadata = {
                    ...(agent.metadata || {}),
                    refreshTokenFamilyId: null,
                    sessionRevokedAt: new Date().toISOString(),
                    sessionRevokeReason: reason
                };
                await agent.save();
                cleared++;
            }
        }

        return { ownerId, cleared, reason };
    }

    /**
     * Device fingerprint helper for agent-initiated refresh flows
     * (User-Agent + Client IP hash) — mirrors human session checks.
     */
    buildDeviceFingerprint(userAgent, ipAddress) {
        return crypto
            .createHash('sha256')
            .update(`${userAgent || 'unknown'}|${ipAddress || '0.0.0.0'}`)
            .digest('hex');
    }
}

module.exports = new AgentIdentityService();