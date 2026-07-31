// backend/services/planInjectionProtectionService.js
const crypto = require('crypto');
const db = require('../config/db').promise;

// ============================================
// CONFIGURATION
// ============================================

const PLAN_INJECTION_CONFIG = {
    // Memory security
    encryptionAlgorithm: 'aes-256-gcm',
    keyDerivation: 'pbkdf2',
    saltRounds: 100000,
    
    // Context validation
    maxContextSize: 1024 * 1024, // 1MB
    maxMemoryEntries: 1000,
    maxLogicalBridges: 3,
    
    // Injection detection
    patternThreshold: 0.7,
    anomalyThreshold: 0.8,
    
    // Memory isolation
    ephemeralTTL: 3600, // 1 hour
    maxSharedState: 10
};

// ============================================
// PLAN INJECTION PROTECTION CLASS
// ============================================

class PlanInjectionProtectionService {
    constructor() {
        this.secureMemory = new Map();
        this.memoryIntegrity = new Map();
        this.contextCache = new Map();
        this.injectionDetections = [];
        this.memoryIsolation = new Map();
        this.encryptionKeys = new Map();
    }

    /**
     * Initialize secure memory for an agent
     */
    async initializeSecureMemory(agentId, initialContext = {}) {
        const memoryId = this.generateMemoryId();
        const encryptionKey = await this.generateEncryptionKey(agentId);
        
        const secureMemory = {
            id: memoryId,
            agentId,
            encryptedData: await this.encryptData(initialContext, encryptionKey),
            integrityHash: this.generateIntegrityHash(initialContext),
            createdAt: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            version: 1,
            status: 'active'
        };

        this.secureMemory.set(memoryId, secureMemory);
        this.encryptionKeys.set(memoryId, encryptionKey);
        this.memoryIntegrity.set(memoryId, {
            hash: secureMemory.integrityHash,
            version: secureMemory.version,
            checks: 0
        });

        await this.storeSecureMemory(memoryId, secureMemory);

        console.log(`✅ Secure memory initialized for agent: ${agentId}`);
        return secureMemory;
    }

    /**
     * Store context securely with plan injection protection
     */
    async storeContext(agentId, context, contextType = 'task') {
        const memoryId = await this.getMemoryId(agentId);
        if (!memoryId) {
            throw new Error('No secure memory found for agent');
        }

        // 1. Validate context for injections
        const validation = await this.validateContext(context, contextType);
        if (!validation.valid) {
            await this.logInjectionAttempt(agentId, context, validation);
            throw new Error(`Plan injection detected: ${validation.reason}`);
        }

        // 2. Encrypt context
        const encryptionKey = this.encryptionKeys.get(memoryId);
        const encryptedData = await this.encryptData(context, encryptionKey);

        // 3. Update secure memory
        const secureMemory = this.secureMemory.get(memoryId);
        secureMemory.encryptedData = encryptedData;
        secureMemory.integrityHash = this.generateIntegrityHash(context);
        secureMemory.lastAccessed = new Date().toISOString();
        secureMemory.version++;

        // 4. Store in isolated memory
        await this.storeIsolatedMemory(memoryId, {
            context,
            contextType,
            timestamp: new Date().toISOString(),
            version: secureMemory.version
        });

        this.secureMemory.set(memoryId, secureMemory);
        await this.storeSecureMemory(memoryId, secureMemory);

        return {
            memoryId,
            version: secureMemory.version,
            integrityHash: secureMemory.integrityHash
        };
    }

    /**
     * Retrieve context with integrity verification
     */
    async retrieveContext(agentId, contextType = 'task') {
        const memoryId = await this.getMemoryId(agentId);
        if (!memoryId) {
            throw new Error('No secure memory found for agent');
        }

        const secureMemory = this.secureMemory.get(memoryId);
        const encryptionKey = this.encryptionKeys.get(memoryId);

        // Decrypt data
        const decryptedData = await this.decryptData(secureMemory.encryptedData, encryptionKey);

        // Verify integrity
        const currentHash = this.generateIntegrityHash(decryptedData);
        if (currentHash !== secureMemory.integrityHash) {
            throw new Error('Memory integrity violation detected');
        }

        // Check for plan injection
        const injectionCheck = await this.detectPlanInjections(decryptedData, contextType);
        if (injectionCheck.detected) {
            await this.logInjectionDetection(agentId, injectionCheck);
            throw new Error(`Plan injection detected: ${injectionCheck.reason}`);
        }

        secureMemory.lastAccessed = new Date().toISOString();
        this.secureMemory.set(memoryId, secureMemory);

        return decryptedData;
    }

    /**
     * Validate context for plan injections
     */
    async validateContext(context, contextType) {
        const validation = {
            valid: true,
            reason: '',
            flags: [],
            confidence: 0
        };

        // 1. Check for task manipulation
        if (context.task && context.task !== context.originalTask) {
            validation.flags.push({
                type: 'task_manipulation',
                details: 'Task has been modified from original'
            });
            validation.confidence += 0.2;
        }

        // 2. Check for plan injection patterns
        const injectionPatterns = await this.detectInjectionPatterns(context);
        if (injectionPatterns.length > 0) {
            validation.flags.push({
                type: 'injection_patterns',
                details: injectionPatterns
            });
            validation.confidence += 0.3 * injectionPatterns.length;
        }

        // 3. Check for logical bridges
        const bridges = await this.detectLogicalBridges(context);
        if (bridges.length > PLAN_INJECTION_CONFIG.maxLogicalBridges) {
            validation.flags.push({
                type: 'excessive_bridges',
                details: `Too many logical bridges: ${bridges.length}`
            });
            validation.confidence += 0.2;
        }

        // 4. Check for context chain injections
        const chain = await this.detectContextChainInjections(context);
        if (chain.detected) {
            validation.flags.push({
                type: 'chain_injection',
                details: chain.details
            });
            validation.confidence += 0.3;
        }

        // 5. Check for memory poisoning
        const poisoning = await this.detectMemoryPoisoning(context);
        if (poisoning.detected) {
            validation.flags.push({
                type: 'memory_poisoning',
                details: poisoning.details
            });
            validation.confidence += 0.2;
        }

        // Determine validity
        validation.confidence = Math.min(1, validation.confidence);
        validation.valid = validation.confidence < PLAN_INJECTION_CONFIG.patternThreshold;
        
        if (!validation.valid) {
            validation.reason = `Plan injection detected with confidence ${(validation.confidence * 100).toFixed(0)}%`;
        }

        return validation;
    }

    /**
     * Detect injection patterns
     */
    async detectInjectionPatterns(context) {
        const patterns = [];
        const contextString = JSON.stringify(context).toLowerCase();

        // Common plan injection patterns
        const injectionKeywords = [
            'ignore previous',
            'ignore instructions',
            'override task',
            'new plan',
            'instead of',
            'exfiltrate',
            'bypass security',
            'malicious',
            'fake data',
            'false information',
            'pretend to be',
            'act as',
            'role play',
            'forget constraints'
        ];

        for (const keyword of injectionKeywords) {
            if (contextString.includes(keyword)) {
                patterns.push(keyword);
            }
        }

        // Check for instruction overriding patterns
        const overridePatterns = [
            /you (?:will|should|must) (?:ignore|forget|override|bypass)/i,
            /don't (?:follow|obey|comply)/i,
            /new (?:task|plan|mission|goal)/i,
            /(?:system|admin|user) override/i
        ];

        for (const pattern of overridePatterns) {
            if (pattern.test(contextString)) {
                patterns.push(pattern.toString());
            }
        }

        return patterns;
    }

    /**
     * Detect logical bridges
     */
    async detectLogicalBridges(context) {
        const bridges = [];
        const contextString = JSON.stringify(context).toLowerCase();

        // Logical bridge patterns
        const bridgePatterns = [
            /(?:first|then|after|before|while|when).*(?:then|after|before|while)/i,
            /(?:complete|finish|do).*(?:then|after|next)/i,
            /(?:once|after).*(?:then|execute|perform)/i,
            /(?:finally|ultimately).*(?:then|when)/i
        ];

        for (const pattern of bridgePatterns) {
            const matches = contextString.match(pattern);
            if (matches) {
                bridges.push(...matches);
            }
        }

        return bridges;
    }

    /**
     * Detect context chain injections
     */
    async detectContextChainInjections(context) {
        const detection = {
            detected: false,
            details: '',
            chainLength: 0
        };

        const contextString = JSON.stringify(context).toLowerCase();
        
        // Check for chain patterns
        const chainPatterns = [
            /(?:step|stage|phase)\s*\d+\s*(?:then|next)/i,
            /(?:first|second|third|fourth|fifth)/i,
            /(?:1st|2nd|3rd|4th|5th)/i
        ];

        let chainCount = 0;
        for (const pattern of chainPatterns) {
            const matches = contextString.match(pattern);
            if (matches) {
                chainCount += matches.length;
            }
        }

        if (chainCount > 3) {
            detection.detected = true;
            detection.details = `Chain injection detected with ${chainCount} steps`;
            detection.chainLength = chainCount;
        }

        return detection;
    }

    /**
     * Detect memory poisoning
     */
    async detectMemoryPoisoning(context) {
        const detection = {
            detected: false,
            details: '',
            affectedFields: []
        };

        // Check for inconsistent data
        const fields = ['task', 'instructions', 'goals', 'constraints'];
        for (const field of fields) {
            if (context[field]) {
                // Check for contradictory information
                if (Array.isArray(context[field])) {
                    const unique = new Set(context[field]);
                    if (unique.size < context[field].length / 2) {
                        detection.detected = true;
                        detection.details = `Inconsistent data in ${field}`;
                        detection.affectedFields.push(field);
                    }
                }
            }
        }

        // Check for unreasonable values
        if (context.maxAmount && context.maxAmount > 1000000) {
            detection.detected = true;
            detection.details = 'Unreasonable maxAmount detected';
            detection.affectedFields.push('maxAmount');
        }

        return detection;
    }

    /**
     * Generate encryption key
     */
    async generateEncryptionKey(agentId) {
        const salt = crypto.randomBytes(16);
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(
                agentId + process.env.ENCRYPTION_SECRET || 'default_secret',
                salt,
                PLAN_INJECTION_CONFIG.saltRounds,
                32,
                'sha256',
                (err, derivedKey) => {
                    if (err) reject(err);
                    resolve(derivedKey);
                }
            );
        });
    }

    /**
     * Encrypt data
     */
    async encryptData(data, key) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(PLAN_INJECTION_CONFIG.encryptionAlgorithm, key, iv);
        
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return JSON.stringify({
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            encrypted: encrypted
        });
    }

    /**
     * Decrypt data
     */
    async decryptData(encryptedData, key) {
        const parsed = JSON.parse(encryptedData);
        const iv = Buffer.from(parsed.iv, 'hex');
        const authTag = Buffer.from(parsed.authTag, 'hex');
        
        const decipher = crypto.createDecipheriv(PLAN_INJECTION_CONFIG.encryptionAlgorithm, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(parsed.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return JSON.parse(decrypted);
    }

    /**
     * Generate integrity hash
     */
    generateIntegrityHash(data) {
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(data) + Date.now().toString())
            .digest('hex');
    }

    /**
     * Generate memory ID
     */
    generateMemoryId() {
        return `MEM_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Get memory ID for agent
     */
    async getMemoryId(agentId) {
        for (const [id, memory] of this.secureMemory) {
            if (memory.agentId === agentId && memory.status === 'active') {
                return id;
            }
        }
        return null;
    }

    /**
     * Store isolated memory
     */
    async storeIsolatedMemory(memoryId, data) {
        if (!this.memoryIsolation.has(memoryId)) {
            this.memoryIsolation.set(memoryId, []);
        }

        const isolation = this.memoryIsolation.get(memoryId);
        isolation.push({
            ...data,
            isolated: true
        });

        // Keep only recent entries
        if (isolation.length > PLAN_INJECTION_CONFIG.maxSharedState) {
            isolation.shift();
        }
    }

    /**
     * Log injection attempt
     */
    async logInjectionAttempt(agentId, context, validation) {
        const logEntry = {
            agentId,
            context,
            validation,
            timestamp: new Date().toISOString()
        };

        this.injectionDetections.push(logEntry);
        
        try {
            await db.query(
                `INSERT INTO plan_injection_logs 
                 (agent_id, context, validation, timestamp)
                 VALUES (?, ?, ?, NOW())`,
                [
                    agentId,
                    JSON.stringify(context),
                    JSON.stringify(validation)
                ]
            );
        } catch (error) {
            console.error('Log injection error:', error);
        }
    }

    /**
     * Log injection detection
     */
    async logInjectionDetection(agentId, detection) {
        try {
            await db.query(
                `INSERT INTO plan_injection_detections 
                 (agent_id, detection_type, details, timestamp)
                 VALUES (?, ?, ?, NOW())`,
                [
                    agentId,
                    'plan_injection',
                    JSON.stringify(detection)
                ]
            );
        } catch (error) {
            console.error('Log detection error:', error);
        }
    }

    /**
     * Store secure memory
     */
    async storeSecureMemory(memoryId, secureMemory) {
        try {
            await db.query(
                `INSERT INTO secure_agent_memory 
                 (memory_id, agent_id, encrypted_data, integrity_hash, 
                  created_at, last_accessed, version, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 encrypted_data = VALUES(encrypted_data),
                 integrity_hash = VALUES(integrity_hash),
                 last_accessed = VALUES(last_accessed),
                 version = VALUES(version),
                 status = VALUES(status)`,
                [
                    memoryId,
                    secureMemory.agentId,
                    secureMemory.encryptedData,
                    secureMemory.integrityHash,
                    secureMemory.createdAt,
                    secureMemory.lastAccessed,
                    secureMemory.version,
                    secureMemory.status
                ]
            );
        } catch (error) {
            console.error('Store memory error:', error);
        }
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_memories,
                    COUNT(DISTINCT agent_id) as unique_agents,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_memories,
                    AVG(version) as avg_versions
                 FROM secure_agent_memory`
            );

            const [injectionStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_injections,
                    COUNT(DISTINCT agent_id) as affected_agents
                 FROM plan_injection_detections
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                memories: stats[0],
                injections: injectionStats[0],
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            secureMemory: this.secureMemory.size,
            memoryIntegrity: this.memoryIntegrity.size,
            contextCache: this.contextCache.size,
            injectionDetections: this.injectionDetections.length,
            memoryIsolation: this.memoryIsolation.size,
            config: PLAN_INJECTION_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new PlanInjectionProtectionService();