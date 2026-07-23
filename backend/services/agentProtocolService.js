// backend/services/agentProtocolService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// PROTOCOL CONFIGURATION
// ============================================

const PROTOCOL_TYPES = {
    NEGOTIATE: 'negotiate',
    PURCHASE: 'purchase',
    QUERY: 'query',
    RESPOND: 'respond',
    CONFIRM: 'confirm',
    REJECT: 'reject',
    CANCEL: 'cancel',
    REFUND: 'refund'
};

const PROTOCOL_VERSION = '1.0.0';

const MESSAGE_TYPES = {
    REQUEST: 'request',
    RESPONSE: 'response',
    NOTIFICATION: 'notification',
    ACKNOWLEDGMENT: 'acknowledgment',
    ERROR: 'error'
};

// ============================================
// AGENT PROTOCOL SERVICE
// ============================================

class AgentProtocolService extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map();
        this.messages = new Map();
        this.agentIdentities = new Map();
        this.agreements = new Map();
        this.messageQueue = [];
        this.isProcessing = false;
    }

    /**
     * Initialize protocol service
     */
    async initialize() {
        await this.loadIdentities();
        await this.loadSessions();
        console.log('✅ Agent Protocol Service initialized');
        return this;
    }

    /**
     * Register an agent identity
     */
    async registerIdentity(agentData) {
        const identity = {
            id: this.generateAgentId(),
            name: agentData.name,
            type: agentData.type || 'shopping',
            publicKey: agentData.publicKey,
            capabilities: agentData.capabilities || [],
            permissions: agentData.permissions || ['negotiate', 'purchase'],
            createdAt: new Date().toISOString(),
            expiresAt: agentData.expiresAt || new Date(Date.now() + 30*24*60*60*1000).toISOString(),
            status: 'active',
            signature: this.generateSignature(agentData)
        };

        this.agentIdentities.set(identity.id, identity);
        await this.storeIdentity(identity);

        console.log(`🔑 Agent identity registered: ${identity.id}`);
        this.emit('identity.registered', identity);

        return identity;
    }

    /**
     * Verify agent identity
     */
    async verifyIdentity(agentId, signature) {
        const identity = this.agentIdentities.get(agentId);
        if (!identity) {
            return { verified: false, reason: 'Agent not found' };
        }

        if (identity.status !== 'active') {
            return { verified: false, reason: `Agent status: ${identity.status}` };
        }

        if (new Date(identity.expiresAt) < new Date()) {
            return { verified: false, reason: 'Identity expired' };
        }

        const isValid = this.verifySignature(identity, signature);
        
        return {
            verified: isValid,
            identity: isValid ? identity : null,
            reason: isValid ? 'Verified' : 'Invalid signature'
        };
    }

    /**
     * Create a new session between agents
     */
    async createSession(agentAId, agentBId, context = {}) {
        // Verify both agents
        const agentA = this.agentIdentities.get(agentAId);
        const agentB = this.agentIdentities.get(agentBId);

        if (!agentA || !agentB) {
            throw new Error('Both agents must be registered');
        }

        const sessionId = this.generateSessionId();
        const session = {
            id: sessionId,
            agentA: agentAId,
            agentB: agentBId,
            status: 'active',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24*60*60*1000).toISOString(),
            context,
            messages: [],
            agreements: [],
            state: 'negotiating'
        };

        this.sessions.set(sessionId, session);
        await this.storeSession(session);

        console.log(`📡 Session created: ${sessionId}`);
        this.emit('session.created', session);

        return session;
    }

    /**
     * Send a message between agents
     */
    async sendMessage(sessionId, fromId, toId, type, payload) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        // Verify sender and receiver are in session
        if (session.agentA !== fromId && session.agentB !== fromId) {
            throw new Error('Sender not in session');
        }

        if (session.agentA !== toId && session.agentB !== toId) {
            throw new Error('Receiver not in session');
        }

        const message = {
            id: this.generateMessageId(),
            sessionId,
            from: fromId,
            to: toId,
            type,
            payload,
            timestamp: new Date().toISOString(),
            signature: this.generateMessageSignature({ fromId, toId, type, payload }),
            status: 'sent'
        };

        // Verify sender
        const senderIdentity = this.agentIdentities.get(fromId);
        if (!senderIdentity) {
            throw new Error('Sender identity not found');
        }

        // Add to session
        session.messages.push(message);
        this.messages.set(message.id, message);

        // Queue for delivery
        this.messageQueue.push(message);

        // Process queue
        this.processQueue();

        console.log(`📨 Message sent: ${message.id} (${type})`);
        this.emit('message.sent', message);

        return message;
    }

    /**
     * Process message queue
     */
    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            await this.deliverMessage(message);
        }

        this.isProcessing = false;
    }

    /**
     * Deliver a message to the receiver
     */
    async deliverMessage(message) {
        try {
            // Verify message signature
            const isValid = this.verifyMessageSignature(message);
            if (!isValid) {
                message.status = 'failed';
                this.emit('message.failed', { messageId: message.id, reason: 'Invalid signature' });
                return;
            }

            // Get receiver
            const receiver = this.agentIdentities.get(message.to);
            if (!receiver) {
                message.status = 'failed';
                this.emit('message.failed', { messageId: message.id, reason: 'Receiver not found' });
                return;
            }

            message.status = 'delivered';
            message.deliveredAt = new Date().toISOString();

            this.emit('message.delivered', message);

            // Update session
            const session = this.sessions.get(message.sessionId);
            if (session) {
                const msgIndex = session.messages.findIndex(m => m.id === message.id);
                if (msgIndex > -1) {
                    session.messages[msgIndex] = message;
                }
            }

            await this.storeMessage(message);

        } catch (error) {
            console.error('Message delivery error:', error);
            message.status = 'failed';
            this.emit('message.failed', { messageId: message.id, error: error.message });
        }
    }

    /**
     * Create an agreement between agents
     */
    async createAgreement(sessionId, terms) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        const agreement = {
            id: this.generateAgreementId(),
            sessionId,
            agentA: session.agentA,
            agentB: session.agentB,
            terms,
            status: 'pending',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
            confirmedBy: []
        };

        session.agreements.push(agreement);
        this.agreements.set(agreement.id, agreement);

        await this.storeAgreement(agreement);

        console.log(`📄 Agreement created: ${agreement.id}`);
        this.emit('agreement.created', agreement);

        return agreement;
    }

    /**
     * Confirm an agreement
     */
    async confirmAgreement(agreementId, agentId, signature) {
        const agreement = this.agreements.get(agreementId);
        if (!agreement) {
            throw new Error('Agreement not found');
        }

        // Verify agent is part of agreement
        if (agreement.agentA !== agentId && agreement.agentB !== agentId) {
            throw new Error('Agent not part of agreement');
        }

        // Verify signature
        const isValid = this.verifyAgreementSignature(agreement, agentId, signature);
        if (!isValid) {
            throw new Error('Invalid signature');
        }

        if (!agreement.confirmedBy.includes(agentId)) {
            agreement.confirmedBy.push(agentId);
        }

        // Check if both confirmed
        if (agreement.confirmedBy.length === 2) {
            agreement.status = 'confirmed';
            this.emit('agreement.confirmed', agreement);
        }

        await this.storeAgreement(agreement);

        return agreement;
    }

    /**
     * Get agent identity
     */
    getIdentity(agentId) {
        return this.agentIdentities.get(agentId) || null;
    }

    /**
     * Get session
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    /**
     * Get messages for session
     */
    getSessionMessages(sessionId, limit = 50) {
        const session = this.sessions.get(sessionId);
        if (!session) return [];

        return session.messages.slice(-limit);
    }

    /**
     * Get agreements for session
     */
    getSessionAgreements(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return [];

        return session.agreements;
    }

    /**
     * Close a session
     */
    async closeSession(sessionId, reason) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        session.status = 'closed';
        session.closedAt = new Date().toISOString();
        session.closeReason = reason;

        await this.storeSession(session);

        console.log(`🔒 Session closed: ${sessionId}`);
        this.emit('session.closed', session);

        return session;
    }

    // ============================================
    // CRYPTOGRAPHIC FUNCTIONS
    // ============================================

    generateAgentId() {
        return `AGT_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    generateSessionId() {
        return `SESS_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    generateMessageId() {
        return `MSG_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    generateAgreementId() {
        return `AGR_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    generateSignature(data) {
        const secret = process.env.AGENT_SECRET || 'default_secret';
        return crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(data))
            .digest('hex');
    }

    generateMessageSignature(data) {
        const secret = process.env.AGENT_SECRET || 'default_secret';
        return crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(data))
            .digest('hex');
    }

    verifySignature(identity, signature) {
        const expected = this.generateSignature({
            id: identity.id,
            name: identity.name,
            publicKey: identity.publicKey
        });
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    }

    verifyMessageSignature(message) {
        const expected = this.generateMessageSignature({
            fromId: message.from,
            toId: message.to,
            type: message.type,
            payload: message.payload
        });
        return crypto.timingSafeEqual(Buffer.from(message.signature), Buffer.from(expected));
    }

    verifyAgreementSignature(agreement, agentId, signature) {
        const data = {
            agreementId: agreement.id,
            agentId,
            terms: agreement.terms,
            timestamp: agreement.createdAt
        };
        const expected = this.generateSignature(data);
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadIdentities() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM agent_identities WHERE status = "active" AND expires_at > NOW()'
            );

            for (const row of rows) {
                this.agentIdentities.set(row.agent_id, {
                    id: row.agent_id,
                    name: row.name,
                    type: row.type,
                    publicKey: row.public_key,
                    capabilities: JSON.parse(row.capabilities || '[]'),
                    permissions: JSON.parse(row.permissions || '[]'),
                    createdAt: row.created_at,
                    expiresAt: row.expires_at,
                    status: row.status,
                    signature: row.signature
                });
            }

            console.log(`🔑 Loaded ${this.agentIdentities.size} agent identities`);
        } catch (error) {
            console.error('Load identities error:', error);
        }
    }

    async loadSessions() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM agent_sessions WHERE status = "active"'
            );

            for (const row of rows) {
                this.sessions.set(row.session_id, {
                    id: row.session_id,
                    agentA: row.agent_a,
                    agentB: row.agent_b,
                    status: row.status,
                    createdAt: row.created_at,
                    expiresAt: row.expires_at,
                    context: JSON.parse(row.context || '{}'),
                    messages: [],
                    agreements: [],
                    state: row.state || 'negotiating'
                });
            }

            console.log(`📡 Loaded ${this.sessions.size} active sessions`);
        } catch (error) {
            console.error('Load sessions error:', error);
        }
    }

    async storeIdentity(identity) {
        await db.query(
            `INSERT INTO agent_identities 
             (agent_id, name, type, public_key, capabilities, permissions, 
              created_at, expires_at, status, signature)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                identity.id,
                identity.name,
                identity.type,
                identity.publicKey,
                JSON.stringify(identity.capabilities),
                JSON.stringify(identity.permissions),
                identity.createdAt,
                identity.expiresAt,
                identity.status,
                identity.signature
            ]
        );
    }

    async storeSession(session) {
        await db.query(
            `INSERT INTO agent_sessions 
             (session_id, agent_a, agent_b, status, created_at, expires_at, context, state)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
             status = VALUES(status), context = VALUES(context), state = VALUES(state)`,
            [
                session.id,
                session.agentA,
                session.agentB,
                session.status,
                session.createdAt,
                session.expiresAt,
                JSON.stringify(session.context),
                session.state || 'negotiating'
            ]
        );
    }

    async storeMessage(message) {
        await db.query(
            `INSERT INTO agent_messages 
             (message_id, session_id, from_agent, to_agent, type, payload, signature, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                message.id,
                message.sessionId,
                message.from,
                message.to,
                message.type,
                JSON.stringify(message.payload),
                message.signature,
                message.status,
                message.timestamp
            ]
        );
    }

    async storeAgreement(agreement) {
        await db.query(
            `INSERT INTO agent_agreements 
             (agreement_id, session_id, agent_a, agent_b, terms, status, created_at, expires_at, confirmed_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
             status = VALUES(status), confirmed_by = VALUES(confirmed_by)`,
            [
                agreement.id,
                agreement.sessionId,
                agreement.agentA,
                agreement.agentB,
                JSON.stringify(agreement.terms),
                agreement.status,
                agreement.createdAt,
                agreement.expiresAt,
                JSON.stringify(agreement.confirmedBy)
            ]
        );
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            identities: this.agentIdentities.size,
            sessions: this.sessions.size,
            messages: this.messages.size,
            agreements: this.agreements.size,
            queueLength: this.messageQueue.length,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            identities: this.agentIdentities.size,
            sessions: this.sessions.size,
            messages: this.messages.size,
            agreements: this.agreements.size,
            queueLength: this.messageQueue.length,
            isProcessing: this.isProcessing
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    AgentProtocolService,
    PROTOCOL_TYPES,
    MESSAGE_TYPES,
    agentProtocolService: new AgentProtocolService()
};