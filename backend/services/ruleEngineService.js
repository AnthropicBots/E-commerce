// backend/services/ruleEngineService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// RULE ENGINE CONFIGURATION
// ============================================

const RULE_TYPES = {
    DISCOUNT: 'discount',
    SHIPPING: 'shipping',
    TAX: 'tax',
    PROMOTIONAL: 'promotional',
    RECOMMENDATION: 'recommendation',
    ELIGIBILITY: 'eligibility'
};

const OPERATORS = {
    EQUALS: 'equals',
    NOT_EQUALS: 'not_equals',
    GREATER_THAN: 'greater_than',
    LESS_THAN: 'less_than',
    GREATER_THAN_OR_EQUALS: 'greater_than_or_equals',
    LESS_THAN_OR_EQUALS: 'less_than_or_equals',
    CONTAINS: 'contains',
    NOT_CONTAINS: 'not_contains',
    STARTS_WITH: 'starts_with',
    ENDS_WITH: 'ends_with',
    IN: 'in',
    NOT_IN: 'not_in',
    BETWEEN: 'between',
    AND: 'and',
    OR: 'or',
    NOT: 'not'
};

const LOGICAL_OPERATORS = ['and', 'or', 'not'];

// ============================================
// RULE ENGINE CLASS
// ============================================

class RuleEngine {
    constructor() {
        this.rules = new Map();
        this.ruleCache = new Map();
        this.executionHistory = [];
        this.ruleTemplates = new Map();
    }

    /**
     * Create a new rule
     */
    async createRule(ruleData) {
        const rule = {
            id: this.generateRuleId(),
            name: ruleData.name,
            description: ruleData.description || '',
            type: ruleData.type,
            category: ruleData.category || 'general',
            priority: ruleData.priority || 0,
            conditions: ruleData.conditions || [],
            actions: ruleData.actions || [],
            enabled: ruleData.enabled !== undefined ? ruleData.enabled : true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: ruleData.expiresAt || null,
            metadata: ruleData.metadata || {}
        };

        // Validate rule
        this.validateRule(rule);

        this.rules.set(rule.id, rule);
        await this.storeRule(rule);

        console.log(`✅ Rule created: ${rule.name} (${rule.id})`);
        return rule;
    }

    /**
     * Execute a rule
     */
    async executeRule(ruleId, context) {
        const rule = this.rules.get(ruleId);
        if (!rule) {
            throw new Error(`Rule not found: ${ruleId}`);
        }

        if (!rule.enabled) {
            return { executed: false, reason: 'Rule disabled' };
        }

        // Check if rule is expired
        if (rule.expiresAt && new Date(rule.expiresAt) < new Date()) {
            return { executed: false, reason: 'Rule expired' };
        }

        // Evaluate conditions
        const conditionsMet = await this.evaluateConditions(rule.conditions, context);
        if (!conditionsMet) {
            return { executed: false, reason: 'Conditions not met' };
        }

        // Execute actions
        const results = await this.executeActions(rule.actions, context);

        // Log execution
        await this.logExecution(rule.id, context, results);

        return {
            executed: true,
            ruleId: rule.id,
            ruleName: rule.name,
            results,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Evaluate conditions
     */
    async evaluateConditions(conditions, context) {
        if (!conditions || conditions.length === 0) {
            return true;
        }

        for (const condition of conditions) {
            const result = await this.evaluateCondition(condition, context);
            if (!result) {
                return false;
            }
        }

        return true;
    }

    /**
     * Evaluate a single condition
     */
    async evaluateCondition(condition, context) {
        const { field, operator, value, logicalOperator } = condition;

        // Handle logical operators
        if (LOGICAL_OPERATORS.includes(operator)) {
            return this.evaluateLogicalCondition(condition, context);
        }

        // Get context value
        const contextValue = this.getContextValue(context, field);

        // Evaluate based on operator
        switch (operator) {
            case OPERATORS.EQUALS:
                return contextValue === value;
            case OPERATORS.NOT_EQUALS:
                return contextValue !== value;
            case OPERATORS.GREATER_THAN:
                return contextValue > value;
            case OPERATORS.LESS_THAN:
                return contextValue < value;
            case OPERATORS.GREATER_THAN_OR_EQUALS:
                return contextValue >= value;
            case OPERATORS.LESS_THAN_OR_EQUALS:
                return contextValue <= value;
            case OPERATORS.CONTAINS:
                return contextValue && contextValue.includes(value);
            case OPERATORS.NOT_CONTAINS:
                return contextValue && !contextValue.includes(value);
            case OPERATORS.STARTS_WITH:
                return contextValue && contextValue.startsWith(value);
            case OPERATORS.ENDS_WITH:
                return contextValue && contextValue.endsWith(value);
            case OPERATORS.IN:
                return Array.isArray(value) && value.includes(contextValue);
            case OPERATORS.NOT_IN:
                return Array.isArray(value) && !value.includes(contextValue);
            case OPERATORS.BETWEEN:
                return Array.isArray(value) && value.length === 2 && 
                       contextValue >= value[0] && contextValue <= value[1];
            default:
                throw new Error(`Unknown operator: ${operator}`);
        }
    }

    /**
     * Evaluate logical condition
     */
    async evaluateLogicalCondition(condition, context) {
        const { operator, conditions } = condition;

        if (operator === OPERATORS.AND) {
            for (const cond of conditions) {
                const result = await this.evaluateCondition(cond, context);
                if (!result) return false;
            }
            return true;
        }

        if (operator === OPERATORS.OR) {
            for (const cond of conditions) {
                const result = await this.evaluateCondition(cond, context);
                if (result) return true;
            }
            return false;
        }

        if (operator === OPERATORS.NOT) {
            const result = await this.evaluateCondition(conditions[0], context);
            return !result;
        }

        return false;
    }

    /**
     * Get context value by path
     */
    getContextValue(context, path) {
        if (!path) return null;

        const parts = path.split('.');
        let value = context;

        for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
                value = value[part];
            } else {
                return null;
            }
        }

        return value;
    }

    /**
     * Execute actions
     */
    async executeActions(actions, context) {
        const results = [];

        for (const action of actions) {
            try {
                const result = await this.executeAction(action, context);
                results.push({
                    action: action.type,
                    success: true,
                    result
                });
            } catch (error) {
                results.push({
                    action: action.type,
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Execute a single action
     */
    async executeAction(action, context) {
        const { type, parameters } = action;

        switch (type) {
            case 'apply_discount':
                return this.applyDiscount(parameters, context);
            case 'calculate_shipping':
                return this.calculateShipping(parameters, context);
            case 'calculate_tax':
                return this.calculateTax(parameters, context);
            case 'apply_promotion':
                return this.applyPromotion(parameters, context);
            case 'add_to_cart':
                return this.addToCart(parameters, context);
            case 'send_notification':
                return this.sendNotification(parameters, context);
            case 'update_cart':
                return this.updateCart(parameters, context);
            default:
                throw new Error(`Unknown action type: ${type}`);
        }
    }

    // ============================================
    // ACTION IMPLEMENTATIONS
    // ============================================

    async applyDiscount(params, context) {
        const discount = {
            type: params.type || 'percentage',
            value: params.value || 0,
            code: params.code || null,
            maxDiscount: params.maxDiscount || null,
            minOrder: params.minOrder || 0
        };

        const orderTotal = context.order?.total || 0;
        let discountAmount = 0;

        if (discount.type === 'percentage') {
            discountAmount = (orderTotal * discount.value) / 100;
        } else if (discount.type === 'fixed') {
            discountAmount = discount.value;
        }

        // Apply max discount limit
        if (discount.maxDiscount && discountAmount > discount.maxDiscount) {
            discountAmount = discount.maxDiscount;
        }

        // Apply min order requirement
        if (orderTotal < discount.minOrder) {
            return { applied: false, reason: 'Minimum order not met' };
        }

        return {
            applied: true,
            discountAmount,
            discountType: discount.type,
            discountValue: discount.value,
            newTotal: orderTotal - discountAmount
        };
    }

    async calculateShipping(params, context) {
        const { method, cost, freeShippingThreshold } = params;
        const orderTotal = context.order?.total || 0;

        let shippingCost = cost || 0;

        // Free shipping if order exceeds threshold
        if (freeShippingThreshold && orderTotal >= freeShippingThreshold) {
            shippingCost = 0;
        }

        // Weight-based shipping
        if (params.weightBased && context.order?.weight) {
            const weight = context.order.weight;
            const rate = params.ratePerKg || 10;
            shippingCost = weight * rate;
        }

        return {
            method,
            cost: shippingCost,
            freeShipping: shippingCost === 0
        };
    }

    async calculateTax(params, context) {
        const { rate, type, exemptions } = params;
        const orderTotal = context.order?.total || 0;

        let taxableAmount = orderTotal;

        // Apply exemptions
        if (exemptions && context.order?.items) {
            for (const item of context.order.items) {
                if (exemptions.includes(item.category)) {
                    taxableAmount -= item.price * item.quantity;
                }
            }
        }

        const taxAmount = (taxableAmount * rate) / 100;

        return {
            rate,
            type: type || 'standard',
            taxableAmount,
            taxAmount,
            totalWithTax: orderTotal + taxAmount
        };
    }

    async applyPromotion(params, context) {
        const { promotionId, type, value, conditions } = params;
        const orderTotal = context.order?.total || 0;

        // Check promotion conditions
        if (conditions) {
            const conditionsMet = await this.evaluateConditions(conditions, context);
            if (!conditionsMet) {
                return { applied: false, reason: 'Promotion conditions not met' };
            }
        }

        let discountAmount = 0;
        if (type === 'percentage') {
            discountAmount = (orderTotal * value) / 100;
        } else if (type === 'fixed') {
            discountAmount = value;
        }

        return {
            applied: true,
            promotionId,
            discountAmount,
            newTotal: orderTotal - discountAmount
        };
    }

    async addToCart(params, context) {
        const { productId, quantity, options } = params;
        const cart = context.cart || [];

        // Check if product already in cart
        const existingItem = cart.find(item => item.productId === productId);
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            cart.push({
                productId,
                quantity,
                options: options || {},
                addedAt: new Date().toISOString()
            });
        }

        return {
            cart,
            itemAdded: true,
            quantity
        };
    }

    async sendNotification(params, context) {
        const { type, recipient, template, data } = params;

        // In production, send actual notification
        console.log(`📧 Notification sent to ${recipient}: ${type} - ${template}`);

        return {
            sent: true,
            type,
            recipient,
            template,
            timestamp: new Date().toISOString()
        };
    }

    async updateCart(params, context) {
        // Implementation for cart updates
        return {
            updated: true,
            params
        };
    }

    // ============================================
    // RULE MANAGEMENT
    // ============================================

    /**
     * Update rule
     */
    async updateRule(ruleId, updates) {
        const rule = this.rules.get(ruleId);
        if (!rule) {
            throw new Error(`Rule not found: ${ruleId}`);
        }

        Object.assign(rule, updates);
        rule.updatedAt = new Date().toISOString();

        this.rules.set(ruleId, rule);
        await this.storeRule(rule);

        console.log(`✅ Rule updated: ${rule.name}`);
        return rule;
    }

    /**
     * Delete rule
     */
    async deleteRule(ruleId) {
        const rule = this.rules.get(ruleId);
        if (!rule) {
            throw new Error(`Rule not found: ${ruleId}`);
        }

        this.rules.delete(ruleId);
        await this.deleteStoredRule(ruleId);

        console.log(`✅ Rule deleted: ${rule.name}`);
        return { success: true };
    }

    /**
     * Get rule by ID
     */
    getRule(ruleId) {
        return this.rules.get(ruleId) || null;
    }

    /**
     * Get all rules
     */
    getAllRules(filters = {}) {
        let rules = Array.from(this.rules.values());

        if (filters.type) {
            rules = rules.filter(r => r.type === filters.type);
        }

        if (filters.category) {
            rules = rules.filter(r => r.category === filters.category);
        }

        if (filters.enabled !== undefined) {
            rules = rules.filter(r => r.enabled === filters.enabled);
        }

        return rules;
    }

    /**
     * Get rules by type
     */
    getRulesByType(type) {
        return Array.from(this.rules.values()).filter(r => r.type === type);
    }

    /**
     * Execute rules by type
     */
    async executeRulesByType(type, context, priority = true) {
        const rules = this.getRulesByType(type);

        // Sort by priority if requested
        if (priority) {
            rules.sort((a, b) => b.priority - a.priority);
        }

        const results = [];
        for (const rule of rules) {
            const result = await this.executeRule(rule.id, context);
            if (result.executed) {
                results.push(result);
            }
        }

        return results;
    }

    // ============================================
    // VALIDATION
    // ============================================

    validateRule(rule) {
        if (!rule.name) {
            throw new Error('Rule name is required');
        }

        if (!rule.type || !Object.values(RULE_TYPES).includes(rule.type)) {
            throw new Error(`Invalid rule type: ${rule.type}`);
        }

        if (!rule.conditions || rule.conditions.length === 0) {
            throw new Error('Rule must have at least one condition');
        }

        if (!rule.actions || rule.actions.length === 0) {
            throw new Error('Rule must have at least one action');
        }
    }

    // ============================================
    // GENERATE IDS
    // ============================================

    generateRuleId() {
        return `RULE_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeRule(rule) {
        try {
            await db.query(
                `INSERT INTO business_rules 
                 (rule_id, name, description, type, category, priority,
                  conditions, actions, enabled, created_at, updated_at, expires_at, metadata)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), description = VALUES(description),
                 type = VALUES(type), category = VALUES(category),
                 priority = VALUES(priority), conditions = VALUES(conditions),
                 actions = VALUES(actions), enabled = VALUES(enabled),
                 updated_at = VALUES(updated_at), expires_at = VALUES(expires_at),
                 metadata = VALUES(metadata)`,
                [
                    rule.id,
                    rule.name,
                    rule.description,
                    rule.type,
                    rule.category,
                    rule.priority,
                    JSON.stringify(rule.conditions),
                    JSON.stringify(rule.actions),
                    rule.enabled ? 1 : 0,
                    rule.createdAt,
                    rule.updatedAt,
                    rule.expiresAt,
                    JSON.stringify(rule.metadata)
                ]
            );
        } catch (error) {
            console.error('Store rule error:', error);
        }
    }

    async deleteStoredRule(ruleId) {
        try {
            await db.query(
                `DELETE FROM business_rules WHERE rule_id = ?`,
                [ruleId]
            );
        } catch (error) {
            console.error('Delete rule error:', error);
        }
    }

    async logExecution(ruleId, context, results) {
        try {
            await db.query(
                `INSERT INTO rule_execution_logs 
                 (rule_id, context, results, executed_at)
                 VALUES (?, ?, ?, NOW())`,
                [
                    ruleId,
                    JSON.stringify(context),
                    JSON.stringify(results)
                ]
            );
        } catch (error) {
            console.error('Log execution error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_rules,
                    COUNT(DISTINCT type) as rule_types,
                    SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_rules,
                    COUNT(DISTINCT category) as categories
                 FROM business_rules`
            );

            const [executionStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_executions,
                    COUNT(DISTINCT rule_id) as unique_rules_executed,
                    MAX(executed_at) as last_execution
                 FROM rule_execution_logs
                 WHERE executed_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                rules: stats[0],
                executions: executionStats[0],
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            totalRules: this.rules.size,
            ruleTypes: Object.values(RULE_TYPES),
            operators: Object.values(OPERATORS),
            executionHistory: this.executionHistory.length
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    RuleEngine,
    RULE_TYPES,
    OPERATORS,
    ruleEngine: new RuleEngine()
};