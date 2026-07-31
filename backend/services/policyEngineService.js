// backend/services/policyEngineService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// POLICY CONFIGURATION
// ============================================

const POLICY_TYPES = {
    ALLOW: 'allow',
    DENY: 'deny',
    REQUIRE: 'require',
    CONDITIONAL: 'conditional'
};

const POLICY_EFFECTS = {
    ALLOW: 'allow',
    DENY: 'deny',
    DEFER: 'defer'
};

// ============================================
// POLICY ENGINE
// ============================================

class PolicyEngine {
    constructor() {
        this.policies = new Map();
        this.policyCache = new Map();
        this.evaluationHistory = [];
        this.cacheTTL = 300; // 5 seconds
        this.policiesPath = path.join(__dirname, '../policies');
    }

    /**
     * Initialize policy engine
     */
    async initialize() {
        // Load policies from database
        await this.loadPolicies();

        // Load policies from filesystem
        await this.loadPolicyFiles();

        console.log('✅ Policy Engine initialized');
        return this;
    }

    /**
     * Load policies from database
     */
    async loadPolicies() {
        try {
            const [policies] = await db.query(
                'SELECT * FROM policies WHERE enabled = 1'
            );

            for (const row of policies) {
                const policy = {
                    id: row.policy_id,
                    name: row.name,
                    description: row.description,
                    version: row.version,
                    type: row.type,
                    effect: row.effect,
                    resources: JSON.parse(row.resources || '[]'),
                    actions: JSON.parse(row.actions || '[]'),
                    conditions: JSON.parse(row.conditions || '{}'),
                    priority: row.priority,
                    environment: JSON.parse(row.environment || '[]'),
                    enabled: row.enabled === 1,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };

                this.policies.set(policy.id, policy);
            }

            console.log(`📦 Loaded ${this.policies.size} policies from database`);
        } catch (error) {
            console.error('Load policies error:', error);
        }
    }

    /**
     * Load policies from filesystem
     */
    async loadPolicyFiles() {
        try {
            if (!fs.existsSync(this.policiesPath)) {
                fs.mkdirSync(this.policiesPath, { recursive: true });
                // Create default policies
                await this.createDefaultPolicies();
                return;
            }

            const files = fs.readdirSync(this.policiesPath);
            
            for (const file of files) {
                if (file.endsWith('.json') || file.endsWith('.yaml')) {
                    const filePath = path.join(this.policiesPath, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    const policyData = JSON.parse(content);
                    
                    // Store or update policy
                    const existing = this.policies.get(policyData.id);
                    if (!existing || existing.version !== policyData.version) {
                        await this.createPolicy(policyData, true);
                    }
                }
            }
        } catch (error) {
            console.error('Load policy files error:', error);
        }
    }

    /**
     * Create default policies
     */
    async createDefaultPolicies() {
        const defaultPolicies = [
            {
                id: 'policy_admin_full_access',
                name: 'Admin Full Access',
                description: 'Administrators have full access to all resources',
                version: '1.0.0',
                type: POLICY_TYPES.ALLOW,
                effect: POLICY_EFFECTS.ALLOW,
                resources: ['*'],
                actions: ['*'],
                conditions: {
                    role: ['admin', 'super_admin']
                },
                priority: 100,
                environment: ['*'],
                enabled: true
            },
            {
                id: 'policy_user_read_access',
                name: 'User Read Access',
                description: 'Users can read their own data',
                version: '1.0.0',
                type: POLICY_TYPES.ALLOW,
                effect: POLICY_EFFECTS.ALLOW,
                resources: ['users/:userId', 'orders/:userId/*'],
                actions: ['read', 'list'],
                conditions: {
                    resourceOwner: true
                },
                priority: 80,
                environment: ['*'],
                enabled: true
            },
            {
                id: 'policy_user_write_access',
                name: 'User Write Access',
                description: 'Users can update their own data',
                version: '1.0.0',
                type: POLICY_TYPES.ALLOW,
                effect: POLICY_EFFECTS.ALLOW,
                resources: ['users/:userId'],
                actions: ['update', 'create'],
                conditions: {
                    resourceOwner: true
                },
                priority: 70,
                environment: ['*'],
                enabled: true
            },
            {
                id: 'policy_public_read',
                name: 'Public Read Access',
                description: 'Public can read product catalog',
                version: '1.0.0',
                type: POLICY_TYPES.ALLOW,
                effect: POLICY_EFFECTS.ALLOW,
                resources: ['products', 'categories'],
                actions: ['list', 'read'],
                conditions: {},
                priority: 10,
                environment: ['*'],
                enabled: true
            },
            {
                id: 'policy_admin_write',
                name: 'Admin Write Access',
                description: 'Administrators can write to all resources',
                version: '1.0.0',
                type: POLICY_TYPES.ALLOW,
                effect: POLICY_EFFECTS.ALLOW,
                resources: ['*'],
                actions: ['create', 'update', 'delete', 'write'],
                conditions: {
                    role: ['admin', 'super_admin']
                },
                priority: 90,
                environment: ['*'],
                enabled: true
            }
        ];

        for (const policy of defaultPolicies) {
            await this.createPolicy(policy, true);
        }
    }

    /**
     * Create a policy
     */
    async createPolicy(policyData, skipValidation = false) {
        const policy = {
            id: policyData.id || this.generatePolicyId(),
            name: policyData.name,
            description: policyData.description || '',
            version: policyData.version || '1.0.0',
            type: policyData.type || POLICY_TYPES.ALLOW,
            effect: policyData.effect || POLICY_EFFECTS.ALLOW,
            resources: policyData.resources || [],
            actions: policyData.actions || [],
            conditions: policyData.conditions || {},
            priority: policyData.priority || 0,
            environment: policyData.environment || ['*'],
            enabled: policyData.enabled !== undefined ? policyData.enabled : true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (!skipValidation) {
            this.validatePolicy(policy);
        }

        this.policies.set(policy.id, policy);
        await this.storePolicy(policy);

        // Clear cache
        this.clearCache();

        console.log(`✅ Policy created: ${policy.name} (${policy.id})`);
        return policy;
    }

    /**
     * Update a policy
     */
    async updatePolicy(policyId, updates) {
        const policy = this.policies.get(policyId);
        if (!policy) {
            throw new Error(`Policy not found: ${policyId}`);
        }

        Object.assign(policy, updates);
        policy.updatedAt = new Date().toISOString();

        this.validatePolicy(policy);
        this.policies.set(policyId, policy);
        await this.storePolicy(policy);

        // Clear cache
        this.clearCache();

        console.log(`✅ Policy updated: ${policy.name} (${policyId})`);
        return policy;
    }

    /**
     * Delete a policy
     */
    async deletePolicy(policyId) {
        const policy = this.policies.get(policyId);
        if (!policy) {
            throw new Error(`Policy not found: ${policyId}`);
        }

        this.policies.delete(policyId);
        await this.deleteStoredPolicy(policyId);

        // Clear cache
        this.clearCache();

        console.log(`✅ Policy deleted: ${policy.name} (${policyId})`);
        return { success: true };
    }

    /**
     * Evaluate authorization
     */
    async evaluate(user, resource, action, context = {}) {
        const cacheKey = this.generateCacheKey(user, resource, action, context);
        
        // Check cache
        const cached = this.policyCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.result;
        }

        // Get applicable policies
        const applicablePolicies = this.getApplicablePolicies(user, resource, action, context);

        // Sort by priority (higher first)
        applicablePolicies.sort((a, b) => b.priority - a.priority);

        // Evaluate policies
        let result = {
            allowed: false,
            reason: 'No applicable policies',
            policies: [],
            evaluatedAt: new Date().toISOString()
        };

        for (const policy of applicablePolicies) {
            const evaluation = await this.evaluatePolicy(policy, user, resource, action, context);
            
            if (evaluation.matched) {
                result.policies.push({
                    id: policy.id,
                    name: policy.name,
                    effect: policy.effect,
                    matched: evaluation.matched,
                    conditions: evaluation.conditions
                });

                if (policy.effect === POLICY_EFFECTS.ALLOW) {
                    result.allowed = true;
                    result.reason = `Allowed by policy: ${policy.name}`;
                    break;
                } else if (policy.effect === POLICY_EFFECTS.DENY) {
                    result.allowed = false;
                    result.reason = `Denied by policy: ${policy.name}`;
                    break;
                }
            }
        }

        // Cache result
        this.policyCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + this.cacheTTL * 1000
        });

        // Log evaluation
        await this.logEvaluation(user, resource, action, context, result);

        return result;
    }

    /**
     * Get applicable policies
     */
    getApplicablePolicies(user, resource, action, context) {
        const policies = [];

        for (const policy of this.policies.values()) {
            if (!policy.enabled) continue;

            // Check environment
            if (!this.matchesEnvironment(policy, context)) continue;

            // Check resource
            if (!this.matchesResource(policy, resource)) continue;

            // Check action
            if (!this.matchesAction(policy, action)) continue;

            // Check conditions (partial)
            if (!this.matchesConditions(policy, user, resource, context)) continue;

            policies.push(policy);
        }

        return policies;
    }

    /**
     * Evaluate a single policy
     */
    async evaluatePolicy(policy, user, resource, action, context) {
        const evaluation = {
            matched: false,
            conditions: {}
        };

        // Check all conditions must be satisfied
        if (policy.conditions && Object.keys(policy.conditions).length > 0) {
            const conditionsMet = await this.evaluateConditions(policy.conditions, user, resource, context);
            evaluation.conditions = conditionsMet;
            if (!conditionsMet.all) {
                return evaluation;
            }
        }

        evaluation.matched = true;
        return evaluation;
    }

    /**
     * Evaluate conditions
     */
    async evaluateConditions(conditions, user, resource, context) {
        const results = {
            all: true,
            details: {}
        };

        for (const [key, value] of Object.entries(conditions)) {
            let met = false;

            switch (key) {
                case 'role':
                    met = this.evaluateRoleCondition(value, user);
                    break;
                case 'resourceOwner':
                    met = this.evaluateResourceOwnerCondition(value, user, resource);
                    break;
                case 'environment':
                    met = this.evaluateEnvironmentCondition(value, context);
                    break;
                case 'age':
                    met = this.evaluateAgeCondition(value, user);
                    break;
                case 'permission':
                    met = this.evaluatePermissionCondition(value, user);
                    break;
                default:
                    // Check if condition is in context
                    met = this.evaluateContextCondition(key, value, context);
            }

            results.details[key] = met;
            if (!met) {
                results.all = false;
            }
        }

        return results;
    }

    // ============================================
    // CONDITION EVALUATORS
    // ============================================

    evaluateRoleCondition(expected, user) {
        const userRole = user?.role || 'guest';
        return Array.isArray(expected) ? expected.includes(userRole) : expected === userRole;
    }

    evaluateResourceOwnerCondition(expected, user, resource) {
        if (!user || !resource) return false;
        return user.id === resource.userId || user.id === resource.ownerId;
    }

    evaluateEnvironmentCondition(expected, context) {
        const env = context.environment || process.env.NODE_ENV || 'development';
        return Array.isArray(expected) ? expected.includes(env) : expected === env;
    }

    evaluateAgeCondition(expected, user) {
        if (!user?.age) return false;
        if (typeof expected === 'number') return user.age >= expected;
        if (Array.isArray(expected)) return user.age >= expected[0] && user.age <= expected[1];
        return false;
    }

    evaluatePermissionCondition(expected, user) {
        if (!user?.permissions) return false;
        return Array.isArray(expected) 
            ? expected.some(p => user.permissions.includes(p))
            : user.permissions.includes(expected);
    }

    evaluateContextCondition(key, expected, context) {
        const value = context[key];
        if (value === undefined) return false;
        return Array.isArray(expected) ? expected.includes(value) : expected === value;
    }

    // ============================================
    // MATCHING FUNCTIONS
    // ============================================

    matchesEnvironment(policy, context) {
        const env = context.environment || process.env.NODE_ENV || 'development';
        return policy.environment.includes('*') || policy.environment.includes(env);
    }

    matchesResource(policy, resource) {
        if (policy.resources.includes('*')) return true;
        
        for (const pattern of policy.resources) {
            if (this.matchPattern(pattern, resource)) {
                return true;
            }
        }
        return false;
    }

    matchesAction(policy, action) {
        if (policy.actions.includes('*')) return true;
        return policy.actions.includes(action);
    }

    matchesConditions(policy, user, resource, context) {
        if (!policy.conditions || Object.keys(policy.conditions).length === 0) {
            return true;
        }

        // Simple condition matching (full evaluation later)
        return true;
    }

    matchPattern(pattern, resource) {
        // Convert pattern to regex
        const regexPattern = pattern
            .replace(/\*/g, '.*')
            .replace(/:([a-zA-Z]+)/g, '([^/]+)');
        
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(resource);
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generatePolicyId() {
        return `POL_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateCacheKey(user, resource, action, context) {
        const userId = user?.id || 'anonymous';
        const env = context.environment || process.env.NODE_ENV || 'development';
        return `${userId}:${resource}:${action}:${env}`;
    }

    clearCache() {
        this.policyCache.clear();
    }

    validatePolicy(policy) {
        if (!policy.name) {
            throw new Error('Policy name is required');
        }
        if (!policy.resources || policy.resources.length === 0) {
            throw new Error('Policy must have at least one resource');
        }
        if (!policy.actions || policy.actions.length === 0) {
            throw new Error('Policy must have at least one action');
        }
        if (!Object.values(POLICY_TYPES).includes(policy.type)) {
            throw new Error(`Invalid policy type: ${policy.type}`);
        }
        if (!Object.values(POLICY_EFFECTS).includes(policy.effect)) {
            throw new Error(`Invalid policy effect: ${policy.effect}`);
        }
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storePolicy(policy) {
        try {
            await db.query(
                `INSERT INTO policies 
                 (policy_id, name, description, version, type, effect,
                  resources, actions, conditions, priority, environment, enabled,
                  created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), description = VALUES(description),
                 version = VALUES(version), type = VALUES(type),
                 effect = VALUES(effect), resources = VALUES(resources),
                 actions = VALUES(actions), conditions = VALUES(conditions),
                 priority = VALUES(priority), environment = VALUES(environment),
                 enabled = VALUES(enabled), updated_at = VALUES(updated_at)`,
                [
                    policy.id,
                    policy.name,
                    policy.description,
                    policy.version,
                    policy.type,
                    policy.effect,
                    JSON.stringify(policy.resources),
                    JSON.stringify(policy.actions),
                    JSON.stringify(policy.conditions),
                    policy.priority,
                    JSON.stringify(policy.environment),
                    policy.enabled ? 1 : 0,
                    policy.createdAt,
                    policy.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store policy error:', error);
        }
    }

    async deleteStoredPolicy(policyId) {
        try {
            await db.query(
                'DELETE FROM policies WHERE policy_id = ?',
                [policyId]
            );
        } catch (error) {
            console.error('Delete policy error:', error);
        }
    }

    async logEvaluation(user, resource, action, context, result) {
        try {
            await db.query(
                `INSERT INTO policy_evaluations 
                 (user_id, resource, action, context, result, evaluated_at)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    user?.id || 'anonymous',
                    resource,
                    action,
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
                    COUNT(*) as total_policies,
                    SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_policies,
                    COUNT(DISTINCT type) as policy_types,
                    COUNT(DISTINCT effect) as effect_types
                 FROM policies`
            );

            const [evalStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_evaluations,
                    SUM(CASE WHEN JSON_EXTRACT(result, '$.allowed') = true THEN 1 ELSE 0 END) as allowed,
                    SUM(CASE WHEN JSON_EXTRACT(result, '$.allowed') = false THEN 1 ELSE 0 END) as denied
                 FROM policy_evaluations
                 WHERE evaluated_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                policies: stats[0],
                evaluations: evalStats[0],
                cacheSize: this.policyCache.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            return null;
        }
    }

    getStatus() {
        return {
            totalPolicies: this.policies.size,
            enabledPolicies: Array.from(this.policies.values()).filter(p => p.enabled).length,
            cacheSize: this.policyCache.size,
            policyTypes: Object.values(POLICY_TYPES),
            effects: Object.values(POLICY_EFFECTS)
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    PolicyEngine,
    POLICY_TYPES,
    POLICY_EFFECTS,
    policyEngine: new PolicyEngine()
};