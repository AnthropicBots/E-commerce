// backend/services/featureFlagService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// FEATURE FLAG CONFIGURATION
// ============================================

const FLAG_TYPES = {
    BOOLEAN: 'boolean',
    PERCENTAGE: 'percentage',
    USER_GROUP: 'user_group',
    ENVIRONMENT: 'environment',
    ROLLOUT: 'rollout'
};

const FLAG_STATUS = {
    DRAFT: 'draft',
    ACTIVE: 'active',
    PAUSED: 'paused',
    ARCHIVED: 'archived'
};

const ROLLOUT_STRATEGIES = {
    GRADUAL: 'gradual',
    BETA: 'beta',
    CANARY: 'canary',
    A_B_TEST: 'a_b_test'
};

// ============================================
// FEATURE FLAG CLASS
// ============================================

class FeatureFlagService {
    constructor() {
        this.flags = new Map();
        this.flagCache = new Map();
        this.evaluations = [];
        this.initialized = false;
        this.cacheTTL = 60; // seconds
    }

    /**
     * Initialize feature flag service
     */
    async initialize() {
        if (this.initialized) return;
        
        await this.loadFlags();
        this.initialized = true;
        
        // Start cache cleaner
        setInterval(() => this.cleanCache(), 60000);
        
        console.log('✅ Feature Flag Service initialized');
        return this;
    }

    /**
     * Load flags from database
     */
    async loadFlags() {
        try {
            const [flags] = await db.query(
                'SELECT * FROM feature_flags WHERE status != "archived"'
            );

            for (const row of flags) {
                const flag = {
                    id: row.flag_id,
                    name: row.name,
                    key: row.key,
                    description: row.description,
                    type: row.type,
                    status: row.status,
                    value: JSON.parse(row.value || '{}'),
                    conditions: JSON.parse(row.conditions || '{}'),
                    rolloutStrategy: row.rollout_strategy,
                    rolloutPercentage: row.rollout_percentage || 0,
                    environments: JSON.parse(row.environments || '[]'),
                    userGroups: JSON.parse(row.user_groups || '[]'),
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };

                this.flags.set(flag.key, flag);
            }

            console.log(`📦 Loaded ${this.flags.size} feature flags`);
        } catch (error) {
            console.error('Load flags error:', error);
        }
    }

    /**
     * Create a new feature flag
     */
    async createFlag(flagData) {
        const flag = {
            id: this.generateFlagId(),
            name: flagData.name,
            key: this.generateKey(flagData.name),
            description: flagData.description || '',
            type: flagData.type || FLAG_TYPES.BOOLEAN,
            status: FLAG_STATUS.DRAFT,
            value: flagData.value || { enabled: false },
            conditions: flagData.conditions || {},
            rolloutStrategy: flagData.rolloutStrategy || ROLLOUT_STRATEGIES.GRADUAL,
            rolloutPercentage: flagData.rolloutPercentage || 0,
            environments: flagData.environments || ['development', 'staging'],
            userGroups: flagData.userGroups || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Validate flag
        this.validateFlag(flag);

        this.flags.set(flag.key, flag);
        await this.storeFlag(flag);

        console.log(`✅ Feature flag created: ${flag.name} (${flag.key})`);
        return flag;
    }

    /**
     * Evaluate a feature flag
     */
    async evaluateFlag(flagKey, context = {}) {
        // Check cache first
        const cacheKey = this.generateCacheKey(flagKey, context);
        const cached = this.flagCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.result;
        }

        const flag = this.flags.get(flagKey);
        if (!flag) {
            return { enabled: false, reason: 'Flag not found' };
        }

        // Check status
        if (flag.status !== FLAG_STATUS.ACTIVE) {
            const result = { 
                enabled: false, 
                reason: `Flag status: ${flag.status}`,
                flag: flag.name
            };
            this.cacheResult(cacheKey, result);
            return result;
        }

        // Evaluate based on type
        let enabled = false;
        let reason = '';

        switch (flag.type) {
            case FLAG_TYPES.BOOLEAN:
                enabled = flag.value.enabled || false;
                reason = enabled ? 'Boolean enabled' : 'Boolean disabled';
                break;

            case FLAG_TYPES.PERCENTAGE:
                enabled = this.evaluatePercentage(flag.rolloutPercentage, context);
                reason = enabled ? `Percentage (${flag.rolloutPercentage}%)` : 'Percentage not met';
                break;

            case FLAG_TYPES.USER_GROUP:
                enabled = this.evaluateUserGroup(flag, context);
                reason = enabled ? 'User in allowed group' : 'User not in allowed group';
                break;

            case FLAG_TYPES.ENVIRONMENT:
                enabled = this.evaluateEnvironment(flag, context);
                reason = enabled ? 'Environment matches' : 'Environment mismatch';
                break;

            case FLAG_TYPES.ROLLOUT:
                enabled = this.evaluateRollout(flag, context);
                reason = enabled ? 'Rollout conditions met' : 'Rollout conditions not met';
                break;

            default:
                enabled = false;
                reason = 'Unknown flag type';
        }

        const result = {
            enabled,
            reason,
            flag: flag.name,
            type: flag.type,
            timestamp: new Date().toISOString()
        };

        // Cache result
        this.cacheResult(cacheKey, result);

        // Log evaluation
        await this.logEvaluation(flagKey, context, result);

        return result;
    }

    /**
     * Evaluate percentage-based flag
     */
    evaluatePercentage(percentage, context) {
        if (percentage >= 100) return true;
        if (percentage <= 0) return false;

        // Use consistent hashing for user-based percentage
        const userId = context.userId || context.user?.id || 'anonymous';
        const hash = this.hashString(userId);
        const value = (hash % 100) + 1;
        return value <= percentage;
    }

    /**
     * Evaluate user group flag
     */
    evaluateUserGroup(flag, context) {
        const userGroups = flag.userGroups || [];
        if (userGroups.length === 0) return true;

        const userGroup = context.userGroup || context.user?.group || 'default';
        return userGroups.includes(userGroup);
    }

    /**
     * Evaluate environment flag
     */
    evaluateEnvironment(flag, context) {
        const environments = flag.environments || [];
        if (environments.length === 0) return true;

        const currentEnv = process.env.NODE_ENV || context.environment || 'development';
        return environments.includes(currentEnv);
    }

    /**
     * Evaluate rollout flag
     */
    evaluateRollout(flag, context) {
        // Check if rollout is complete
        if (flag.rolloutPercentage >= 100) return true;

        // Check user groups
        if (flag.userGroups && flag.userGroups.length > 0) {
            const userGroup = context.userGroup || context.user?.group || 'default';
            if (!flag.userGroups.includes(userGroup)) {
                return false;
            }
        }

        // Check environment
        const currentEnv = process.env.NODE_ENV || context.environment || 'development';
        if (flag.environments && !flag.environments.includes(currentEnv)) {
            return false;
        }

        // Percentage-based rollout
        return this.evaluatePercentage(flag.rolloutPercentage, context);
    }

    /**
     * Update feature flag
     */
    async updateFlag(flagKey, updates) {
        const flag = this.flags.get(flagKey);
        if (!flag) {
            throw new Error(`Flag not found: ${flagKey}`);
        }

        Object.assign(flag, updates);
        flag.updatedAt = new Date().toISOString();

        this.flags.set(flagKey, flag);
        await this.storeFlag(flag);

        // Clear cache for this flag
        this.clearFlagCache(flagKey);

        console.log(`✅ Feature flag updated: ${flag.name}`);
        return flag;
    }

    /**
     * Delete feature flag
     */
    async deleteFlag(flagKey) {
        const flag = this.flags.get(flagKey);
        if (!flag) {
            throw new Error(`Flag not found: ${flagKey}`);
        }

        flag.status = FLAG_STATUS.ARCHIVED;
        flag.updatedAt = new Date().toISOString();

        this.flags.set(flagKey, flag);
        await this.storeFlag(flag);
        this.clearFlagCache(flagKey);

        console.log(`✅ Feature flag archived: ${flag.name}`);
        return flag;
    }

    /**
     * Get all flags
     */
    getAllFlags(filters = {}) {
        let flags = Array.from(this.flags.values());

        if (filters.status) {
            flags = flags.filter(f => f.status === filters.status);
        }

        if (filters.type) {
            flags = flags.filter(f => f.type === filters.type);
        }

        return flags;
    }

    /**
     * Get flag by key
     */
    getFlag(flagKey) {
        return this.flags.get(flagKey) || null;
    }

    /**
     * Check if flag is enabled
     */
    async isEnabled(flagKey, context = {}) {
        const result = await this.evaluateFlag(flagKey, context);
        return result.enabled;
    }

    /**
     * Get flag value
     */
    async getFlagValue(flagKey, context = {}) {
        const result = await this.evaluateFlag(flagKey, context);
        return {
            enabled: result.enabled,
            value: result.flag ? this.flags.get(flagKey)?.value : null,
            reason: result.reason
        };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateFlagId() {
        return `FLAG_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateKey(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_');
    }

    generateCacheKey(flagKey, context) {
        const userId = context.userId || context.user?.id || 'anonymous';
        const env = process.env.NODE_ENV || 'development';
        return `${flagKey}:${userId}:${env}`;
    }

    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    cacheResult(key, result) {
        this.flagCache.set(key, {
            result,
            expiresAt: Date.now() + this.cacheTTL * 1000
        });
    }

    clearFlagCache(flagKey) {
        for (const [key] of this.flagCache) {
            if (key.startsWith(flagKey)) {
                this.flagCache.delete(key);
            }
        }
    }

    cleanCache() {
        const now = Date.now();
        for (const [key, value] of this.flagCache) {
            if (value.expiresAt < now) {
                this.flagCache.delete(key);
            }
        }
    }

    validateFlag(flag) {
        if (!flag.name) {
            throw new Error('Flag name is required');
        }

        if (!flag.key) {
            throw new Error('Flag key is required');
        }

        if (!Object.values(FLAG_TYPES).includes(flag.type)) {
            throw new Error(`Invalid flag type: ${flag.type}`);
        }

        if (flag.rolloutPercentage < 0 || flag.rolloutPercentage > 100) {
            throw new Error('Rollout percentage must be between 0 and 100');
        }
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeFlag(flag) {
        try {
            await db.query(
                `INSERT INTO feature_flags 
                 (flag_id, name, key, description, type, status,
                  value, conditions, rollout_strategy, rollout_percentage,
                  environments, user_groups, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), description = VALUES(description),
                 type = VALUES(type), status = VALUES(status),
                 value = VALUES(value), conditions = VALUES(conditions),
                 rollout_strategy = VALUES(rollout_strategy),
                 rollout_percentage = VALUES(rollout_percentage),
                 environments = VALUES(environments),
                 user_groups = VALUES(user_groups),
                 updated_at = VALUES(updated_at)`,
                [
                    flag.id,
                    flag.name,
                    flag.key,
                    flag.description,
                    flag.type,
                    flag.status,
                    JSON.stringify(flag.value),
                    JSON.stringify(flag.conditions),
                    flag.rolloutStrategy,
                    flag.rolloutPercentage,
                    JSON.stringify(flag.environments),
                    JSON.stringify(flag.userGroups),
                    flag.createdAt,
                    flag.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store flag error:', error);
        }
    }

    async logEvaluation(flagKey, context, result) {
        try {
            await db.query(
                `INSERT INTO feature_flag_evaluations 
                 (flag_key, user_id, context, result, evaluated_at)
                 VALUES (?, ?, ?, ?, NOW())`,
                [
                    flagKey,
                    context.userId || context.user?.id || 'anonymous',
                    JSON.stringify(context),
                    JSON.stringify(result)
                ]
            );
        } catch (error) {
            console.error('Log evaluation error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_flags,
                    COUNT(DISTINCT type) as flag_types,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_flags,
                    SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_flags,
                    SUM(CASE WHEN rollout_percentage > 0 AND rollout_percentage < 100 THEN 1 ELSE 0 END) as gradual_rollouts
                 FROM feature_flags`
            );

            const [evalStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_evaluations,
                    COUNT(DISTINCT flag_key) as unique_flags_evaluated,
                    MAX(evaluated_at) as last_evaluation
                 FROM feature_flag_evaluations
                 WHERE evaluated_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                flags: stats[0],
                evaluations: evalStats[0],
                cacheSize: this.flagCache.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            totalFlags: this.flags.size,
            activeFlags: Array.from(this.flags.values()).filter(f => f.status === 'active').length,
            cacheSize: this.flagCache.size,
            flagTypes: Object.values(FLAG_TYPES),
            statuses: Object.values(FLAG_STATUS),
            initialized: this.initialized
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    FeatureFlagService,
    FLAG_TYPES,
    FLAG_STATUS,
    ROLLOUT_STRATEGIES,
    featureFlagService: new FeatureFlagService()
};