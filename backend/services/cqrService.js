// backend/services/cqrsService.js
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// CQRS CONFIGURATION
// ============================================

const CQRS_CONFIG = {
    // Query cache settings
    queryCacheTTL: 300, // 5 minutes
    queryCacheSize: 1000,
    
    // Read model settings
    readModelSyncInterval: 60000, // 1 minute
    batchSize: 100,
    
    // Materialized view settings
    materializedViews: {
        product_summary: true,
        order_summary: true,
        user_summary: true,
        category_summary: true
    }
};

// ============================================
// COMMAND HANDLER
// ============================================

class CommandHandler {
    constructor() {
        this.commands = new Map();
        this.eventBus = new EventEmitter();
        this.commandHistory = [];
    }

    /**
     * Register a command handler
     */
    register(commandType, handler) {
        this.commands.set(commandType, handler);
        console.log(`✅ Command registered: ${commandType}`);
    }

    /**
     * Execute a command
     */
    async execute(command) {
        const { type, payload, userId } = command;
        
        const handler = this.commands.get(type);
        if (!handler) {
            throw new Error(`No handler registered for command: ${type}`);
        }

        const startTime = Date.now();
        
        try {
            const result = await handler(payload, userId);
            
            const duration = Date.now() - startTime;
            this.commandHistory.push({
                type,
                userId,
                duration,
                timestamp: new Date().toISOString()
            });

            // Emit event for read model updates
            this.eventBus.emit('command.executed', {
                type,
                payload,
                result,
                userId
            });

            return {
                success: true,
                data: result,
                commandId: this.generateCommandId(),
                duration
            };
        } catch (error) {
            console.error(`Command execution error: ${type}`, error);
            throw error;
        }
    }

    generateCommandId() {
        return `CMD_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    getStatistics() {
        const total = this.commandHistory.length;
        const byType = {};
        
        for (const entry of this.commandHistory) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
        }

        return {
            total,
            byType,
            avgDuration: total > 0 
                ? this.commandHistory.reduce((sum, e) => sum + e.duration, 0) / total
                : 0
        };
    }
}

// ============================================
// QUERY HANDLER
// ============================================

class QueryHandler {
    constructor() {
        this.queryCache = new Map();
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.queryHistory = [];
    }

    /**
     * Execute a query with caching
     */
    async execute(query, options = {}) {
        const { type, params, userId } = query;
        const { useCache = true, ttl = CQRS_CONFIG.queryCacheTTL } = options;

        // Generate cache key
        const cacheKey = this.generateCacheKey(type, params);

        // Check cache
        if (useCache) {
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                this.cacheHits++;
                return cached;
            }
            this.cacheMisses++;
        }

        // Execute query
        const startTime = Date.now();
        const result = await this.executeQuery(type, params, userId);
        const duration = Date.now() - startTime;

        // Cache result
        if (useCache && result) {
            this.setCache(cacheKey, result, ttl);
        }

        // Track query
        this.queryHistory.push({
            type,
            userId,
            duration,
            timestamp: new Date().toISOString(),
            cacheHit: false
        });

        return result;
    }

    /**
     * Execute specific query type
     */
    async executeQuery(type, params, userId) {
        switch (type) {
            case 'getProducts':
                return this.getProducts(params);
            case 'getProductDetails':
                return this.getProductDetails(params);
            case 'getCategories':
                return this.getCategories(params);
            case 'getOrders':
                return this.getOrders(params, userId);
            case 'getDashboardStats':
                return this.getDashboardStats(params);
            case 'getRecommendations':
                return this.getRecommendations(params, userId);
            case 'getAnalytics':
                return this.getAnalytics(params);
            default:
                throw new Error(`Unknown query type: ${type}`);
        }
    }

    /**
     * Query: Get products
     */
    async getProducts(params) {
        const { category, minPrice, maxPrice, sort, limit = 20, offset = 0 } = params;

        let query = 'SELECT * FROM products WHERE stock > 0';
        const queryParams = [];

        if (category) {
            query += ' AND category = ?';
            queryParams.push(category);
        }

        if (minPrice) {
            query += ' AND price >= ?';
            queryParams.push(minPrice);
        }

        if (maxPrice) {
            query += ' AND price <= ?';
            queryParams.push(maxPrice);
        }

        switch (sort) {
            case 'price_asc':
                query += ' ORDER BY price ASC';
                break;
            case 'price_desc':
                query += ' ORDER BY price DESC';
                break;
            case 'rating':
                query += ' ORDER BY avg_rating DESC';
                break;
            default:
                query += ' ORDER BY created_at DESC';
        }

        query += ' LIMIT ? OFFSET ?';
        queryParams.push(limit, offset);

        const [products] = await db.query(query, queryParams);
        return products;
    }

    /**
     * Query: Get product details
     */
    async getProductDetails(params) {
        const { productId } = params;

        const [products] = await db.query(
            `SELECT p.*, 
                    AVG(r.rating) as avg_rating,
                    COUNT(r.id) as review_count
             FROM products p
             LEFT JOIN reviews r ON p.id = r.product_id
             WHERE p.id = ?
             GROUP BY p.id`,
            [productId]
        );

        if (products.length === 0) {
            throw new Error('Product not found');
        }

        return products[0];
    }

    /**
     * Query: Get categories
     */
    async getCategories(params) {
        const [categories] = await db.query(
            `SELECT DISTINCT category, COUNT(*) as product_count 
             FROM products 
             WHERE stock > 0 
             GROUP BY category
             ORDER BY product_count DESC`
        );

        return categories;
    }

    /**
     * Query: Get orders
     */
    async getOrders(params, userId) {
        const { status, limit = 20, offset = 0 } = params;

        let query = 'SELECT * FROM orders WHERE user_id = ?';
        const queryParams = [userId];

        if (status) {
            query += ' AND status = ?';
            queryParams.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        queryParams.push(limit, offset);

        const [orders] = await db.query(query, queryParams);
        return orders;
    }

    /**
     * Query: Get dashboard statistics
     */
    async getDashboardStats(params) {
        const { userId } = params;

        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_orders,
                SUM(total_amount) as total_spent,
                AVG(total_amount) as avg_order_value,
                COUNT(DISTINCT product_id) as unique_products
             FROM orders
             WHERE user_id = ?`,
            [userId]
        );

        return stats[0] || { total_orders: 0, total_spent: 0, avg_order_value: 0, unique_products: 0 };
    }

    /**
     * Query: Get recommendations
     */
    async getRecommendations(params, userId) {
        const { limit = 10 } = params;

        // Simple recommendation based on purchase history
        const [recommendations] = await db.query(
            `SELECT p.*, COUNT(o.id) as purchase_count
             FROM products p
             JOIN orders o ON o.product_id = p.id
             WHERE o.user_id IN (
                 SELECT DISTINCT user_id 
                 FROM orders 
                 WHERE product_id IN (
                     SELECT product_id 
                     FROM orders 
                     WHERE user_id = ?
                 )
                 AND user_id != ?
             )
             AND p.id NOT IN (
                 SELECT product_id 
                 FROM orders 
                 WHERE user_id = ?
             )
             AND p.stock > 0
             GROUP BY p.id
             ORDER BY purchase_count DESC
             LIMIT ?`,
            [userId, userId, userId, limit]
        );

        return recommendations;
    }

    /**
     * Query: Get analytics
     */
    async getAnalytics(params) {
        const { period = '30d' } = params;

        const [analytics] = await db.query(
            `SELECT 
                COUNT(*) as total_orders,
                SUM(total_amount) as total_revenue,
                AVG(total_amount) as avg_order_value,
                COUNT(DISTINCT user_id) as unique_customers,
                DATE_FORMAT(created_at, '%Y-%m') as month
             FROM orders
             WHERE created_at > DATE_SUB(NOW(), INTERVAL ?)
             GROUP BY month
             ORDER BY month DESC`,
            [period]
        );

        return analytics;
    }

    // ============================================
    // CACHE MANAGEMENT
    // ============================================

    generateCacheKey(type, params) {
        const sortedParams = Object.keys(params).sort().reduce((acc, key) => {
            acc[key] = params[key];
            return acc;
        }, {});
        return `${type}:${JSON.stringify(sortedParams)}`;
    }

    getFromCache(key) {
        const cached = this.queryCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        this.queryCache.delete(key);
        return null;
    }

    setCache(key, data, ttl) {
        if (this.queryCache.size >= CQRS_CONFIG.queryCacheSize) {
            // Evict oldest entry
            const oldest = this.queryCache.keys().next().value;
            this.queryCache.delete(oldest);
        }

        this.queryCache.set(key, {
            data,
            expiresAt: Date.now() + ttl * 1000
        });
    }

    clearCache() {
        this.queryCache.clear();
        console.log('🗑️ Query cache cleared');
    }

    getStatistics() {
        const total = this.cacheHits + this.cacheMisses;
        return {
            cacheHits: this.cacheHits,
            cacheMisses: this.cacheMisses,
            hitRate: total > 0 ? (this.cacheHits / total * 100).toFixed(2) + '%' : '0%',
            cacheSize: this.queryCache.size,
            totalQueries: this.queryHistory.length,
            avgDuration: this.queryHistory.length > 0
                ? this.queryHistory.reduce((sum, q) => sum + q.duration, 0) / this.queryHistory.length
                : 0
        };
    }
}

// ============================================
// READ MODEL SYNCHRONIZATION
// ============================================

class ReadModelSynchronizer {
    constructor() {
        this.isSyncing = false;
        this.lastSync = null;
        this.syncInterval = null;
    }

    /**
     * Start read model synchronization
     */
    start() {
        if (this.syncInterval) return;

        this.syncInterval = setInterval(() => {
            this.syncReadModels();
        }, CQRS_CONFIG.readModelSyncInterval);

        // Initial sync
        setTimeout(() => this.syncReadModels(), 5000);

        console.log('✅ Read model synchronization started');
    }

    /**
     * Sync read models
     */
    async syncReadModels() {
        if (this.isSyncing) return;

        this.isSyncing = true;
        console.log('🔄 Syncing read models...');

        try {
            await this.syncProductSummary();
            await this.syncOrderSummary();
            await this.syncUserSummary();
            await this.syncCategorySummary();

            this.lastSync = new Date().toISOString();
            console.log('✅ Read models synced successfully');
        } catch (error) {
            console.error('Read model sync error:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Sync product summary read model
     */
    async syncProductSummary() {
        await db.query(`
            INSERT INTO read_model_product_summary 
            (product_id, total_orders, total_revenue, average_rating, view_count, last_updated)
            SELECT 
                p.id,
                COUNT(o.id),
                SUM(o.total_amount),
                AVG(r.rating),
                COUNT(v.id),
                NOW()
            FROM products p
            LEFT JOIN orders o ON o.product_id = p.id
            LEFT JOIN reviews r ON r.product_id = p.id
            LEFT JOIN product_views v ON v.product_id = p.id
            GROUP BY p.id
            ON DUPLICATE KEY UPDATE
            total_orders = VALUES(total_orders),
            total_revenue = VALUES(total_revenue),
            average_rating = VALUES(average_rating),
            view_count = VALUES(view_count),
            last_updated = VALUES(last_updated)
        `);
    }

    /**
     * Sync order summary read model
     */
    async syncOrderSummary() {
        await db.query(`
            INSERT INTO read_model_order_summary 
            (user_id, total_orders, total_spent, average_order_value, last_order_date, last_updated)
            SELECT 
                user_id,
                COUNT(*),
                SUM(total_amount),
                AVG(total_amount),
                MAX(created_at),
                NOW()
            FROM orders
            GROUP BY user_id
            ON DUPLICATE KEY UPDATE
            total_orders = VALUES(total_orders),
            total_spent = VALUES(total_spent),
            average_order_value = VALUES(average_order_value),
            last_order_date = VALUES(last_order_date),
            last_updated = VALUES(last_updated)
        `);
    }

    /**
     * Sync user summary read model
     */
    async syncUserSummary() {
        await db.query(`
            INSERT INTO read_model_user_summary 
            (user_id, total_orders, total_spent, last_active, account_age, last_updated)
            SELECT 
                u.id,
                COUNT(o.id),
                SUM(o.total_amount),
                MAX(o.created_at),
                DATEDIFF(NOW(), u.created_at),
                NOW()
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            GROUP BY u.id
            ON DUPLICATE KEY UPDATE
            total_orders = VALUES(total_orders),
            total_spent = VALUES(total_spent),
            last_active = VALUES(last_active),
            account_age = VALUES(account_age),
            last_updated = VALUES(last_updated)
        `);
    }

    /**
     * Sync category summary read model
     */
    async syncCategorySummary() {
        await db.query(`
            INSERT INTO read_model_category_summary 
            (category, product_count, total_orders, total_revenue, last_updated)
            SELECT 
                p.category,
                COUNT(DISTINCT p.id),
                COUNT(o.id),
                SUM(o.total_amount),
                NOW()
            FROM products p
            LEFT JOIN orders o ON o.product_id = p.id
            GROUP BY p.category
            ON DUPLICATE KEY UPDATE
            product_count = VALUES(product_count),
            total_orders = VALUES(total_orders),
            total_revenue = VALUES(total_revenue),
            last_updated = VALUES(last_updated)
        `);
    }

    /**
     * Stop synchronization
     */
    stop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        console.log('⏹️ Read model synchronization stopped');
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    CommandHandler,
    QueryHandler,
    ReadModelSynchronizer,
    CQRS_CONFIG,
    commandHandler: new CommandHandler(),
    queryHandler: new QueryHandler(),
    readModelSynchronizer: new ReadModelSynchronizer()
};