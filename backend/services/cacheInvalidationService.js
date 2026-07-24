// backend/services/cacheInvalidationService.js
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// INVALIDATION CONFIGURATION
// ============================================

const INVALIDATION_STRATEGIES = {
    DEPENDENCY_BASED: 'dependency_based',
    EVENT_DRIVEN: 'event_driven',
    PRODUCT_UPDATE: 'product_update',
    CATEGORY_INVALIDATION: 'category_invalidation',
    USER_SPECIFIC: 'user_specific',
    PATTERN_BASED: 'pattern_based',
    ADAPTIVE: 'adaptive'
};

const DEPENDENCY_TYPES = {
    PRODUCT: 'product',
    CATEGORY: 'category',
    USER: 'user',
    ORDER: 'order',
    INVENTORY: 'inventory',
    SETTINGS: 'settings'
};

// ============================================
// ADAPTIVE CACHE INVALIDATION
// ============================================

class AdaptiveCacheInvalidation {
    constructor() {
        this.dependencies = new Map();
        this.patterns = new Map();
        this.invalidationQueue = [];
        this.eventListeners = new Map();
        this.stats = {
            invalidations: 0,
            events: 0,
            patternsMatched: 0
        };
        this.eventBus = new EventEmitter();
    }

    /**
     * Initialize invalidation service
     */
    async initialize() {
        await this.loadDependencies();
        await this.loadPatterns();
        this.setupEventListeners();
        console.log('✅ Adaptive Cache Invalidation initialized');
        return this;
    }

    /**
     * Register a cache dependency
     */
    registerDependency(key, dependencies, options = {}) {
        const dependency = {
            key,
            dependencies: Array.isArray(dependencies) ? dependencies : [dependencies],
            strategy: options.strategy || INVALIDATION_STRATEGIES.DEPENDENCY_BASED,
            ttl: options.ttl || 300,
            lastInvalidated: null,
            invalidateCount: 0
        };

        this.dependencies.set(key, dependency);
        console.log(`📦 Dependency registered: ${key}`);
        return dependency;
    }

    /**
     * Invalidate cache by key
     */
    async invalidate(key, options = {}) {
        const { reason, cascade = true, strategy = INVALIDATION_STRATEGIES.DEPENDENCY_BASED } = options;

        console.log(`🗑️ Invalidating: ${key} (${reason || 'manual'})`);

        // Direct invalidation
        await this.invalidateDirect(key);

        // Cascade invalidation
        if (cascade) {
            await this.invalidateDependents(key);
        }

        // Apply strategy-specific invalidation
        await this.applyStrategy(key, strategy);

        this.stats.invalidations++;
        this.emit('invalidation', { key, reason, strategy });

        return { invalidated: true };
    }

    /**
     * Direct invalidation
     */
    async invalidateDirect(key) {
        // In production, this would call your cache service
        console.log(`🗑️ Direct invalidation: ${key}`);
        // await cacheService.delete(key);
    }

    /**
     * Invalidate dependents
     */
    async invalidateDependents(key) {
        const dependents = this.getDependents(key);
        for (const dep of dependents) {
            console.log(`🗑️ Cascading invalidation: ${dep}`);
            await this.invalidateDirect(dep);
        }
    }

    /**
     * Apply invalidation strategy
     */
    async applyStrategy(key, strategy) {
        switch (strategy) {
            case INVALIDATION_STRATEGIES.EVENT_DRIVEN:
                await this.eventDrivenInvalidation(key);
                break;
            case INVALIDATION_STRATEGIES.PRODUCT_UPDATE:
                await this.productUpdateInvalidation(key);
                break;
            case INVALIDATION_STRATEGIES.CATEGORY_INVALIDATION:
                await this.categoryInvalidation(key);
                break;
            case INVALIDATION_STRATEGIES.USER_SPECIFIC:
                await this.userSpecificInvalidation(key);
                break;
            case INVALIDATION_STRATEGIES.PATTERN_BASED:
                await this.patternBasedInvalidation(key);
                break;
            case INVALIDATION_STRATEGIES.ADAPTIVE:
                await this.adaptiveInvalidation(key);
                break;
            default:
                break;
        }
    }

    // ============================================
    // INVALIDATION STRATEGIES
    // ============================================

    /**
     * Event-driven invalidation
     */
    async eventDrivenInvalidation(key) {
        // Invalidate based on events
        const events = this.getEventsForKey(key);
        for (const event of events) {
            console.log(`📡 Event-driven invalidation: ${key} via ${event}`);
            await this.invalidateDirect(event.key);
        }
    }

    /**
     * Product update invalidation
     */
    async productUpdateInvalidation(key) {
        // Invalidate product-related caches
        const productId = this.extractProductId(key);
        if (productId) {
            const relatedKeys = await this.getProductRelatedKeys(productId);
            for (const relatedKey of relatedKeys) {
                console.log(`📦 Product update invalidation: ${relatedKey}`);
                await this.invalidateDirect(relatedKey);
            }
        }
    }

    /**
     * Category invalidation
     */
    async categoryInvalidation(key) {
        // Invalidate category caches
        const categoryId = this.extractCategoryId(key);
        if (categoryId) {
            const categoryKeys = await this.getCategoryKeys(categoryId);
            for (const catKey of categoryKeys) {
                console.log(`📂 Category invalidation: ${catKey}`);
                await this.invalidateDirect(catKey);
            }
        }
    }

    /**
     * User-specific invalidation
     */
    async userSpecificInvalidation(key) {
        // Invalidate user-specific caches
        const userId = this.extractUserId(key);
        if (userId) {
            const userKeys = await this.getUserKeys(userId);
            for (const userKey of userKeys) {
                console.log(`👤 User-specific invalidation: ${userKey}`);
                await this.invalidateDirect(userKey);
            }
        }
    }

    /**
     * Pattern-based invalidation
     */
    async patternBasedInvalidation(key) {
        // Invalidate based on patterns
        const patterns = this.patterns.get(key) || [];
        for (const pattern of patterns) {
            const matchedKeys = await this.getKeysByPattern(pattern);
            for (const matchedKey of matchedKeys) {
                console.log(`🔍 Pattern-based invalidation: ${matchedKey}`);
                await this.invalidateDirect(matchedKey);
            }
        }
    }

    /**
     * Adaptive invalidation
     */
    async adaptiveInvalidation(key) {
        // Learn and adapt invalidation patterns
        const usagePattern = await this.getUsagePattern(key);
        const optimalStrategy = this.determineOptimalStrategy(usagePattern);
        
        console.log(`🧠 Adaptive invalidation for ${key}: ${optimalStrategy}`);
        
        // Apply the determined strategy
        await this.applyStrategy(key, optimalStrategy);

        // Update usage patterns
        await this.updateUsagePattern(key, usagePattern);
    }

    // ============================================
    // DEPENDENCY MANAGEMENT
    // ============================================

    /**
     * Load dependencies from database
     */
    async loadDependencies() {
        try {
            const [dependencies] = await db.query(
                'SELECT * FROM cache_dependencies'
            );

            for (const row of dependencies) {
                this.dependencies.set(row.key, {
                    key: row.key,
                    dependencies: JSON.parse(row.dependencies),
                    strategy: row.strategy,
                    ttl: row.ttl,
                    lastInvalidated: row.last_invalidated,
                    invalidateCount: row.invalidate_count
                });
            }

            console.log(`📦 Loaded ${dependencies.length} dependencies`);
        } catch (error) {
            console.error('Load dependencies error:', error);
        }
    }

    /**
     * Load invalidation patterns
     */
    async loadPatterns() {
        try {
            const [patterns] = await db.query(
                'SELECT * FROM invalidation_patterns'
            );

            for (const row of patterns) {
                if (!this.patterns.has(row.key)) {
                    this.patterns.set(row.key, []);
                }
                this.patterns.get(row.key).push(row.pattern);
            }

            console.log(`📦 Loaded ${patterns.length} patterns`);
        } catch (error) {
            console.error('Load patterns error:', error);
        }
    }

    /**
     * Get dependents of a key
     */
    getDependents(key) {
        const dependents = [];
        for (const [k, v] of this.dependencies) {
            if (v.dependencies.includes(key)) {
                dependents.push(k);
            }
        }
        return dependents;
    }

    /**
     * Get events for a key
     */
    getEventsForKey(key) {
        // In production, fetch from event store
        return [];
    }

    /**
     * Extract IDs from keys
     */
    extractProductId(key) {
        const match = key.match(/product[_:](\d+)/i);
        return match ? match[1] : null;
    }

    extractCategoryId(key) {
        const match = key.match(/category[_:](\d+)/i);
        return match ? match[1] : null;
    }

    extractUserId(key) {
        const match = key.match(/user[_:](\d+)/i);
        return match ? match[1] : null;
    }

    /**
     * Get product related keys
     */
    async getProductRelatedKeys(productId) {
        // In production, query cache keys
        return [
            `product:${productId}`,
            `products:list`,
            `category:${productId}`,
            `recommendations:${productId}`
        ];
    }

    /**
     * Get category keys
     */
    async getCategoryKeys(categoryId) {
        return [
            `category:${categoryId}`,
            `categories:list`,
            `products:category:${categoryId}`
        ];
    }

    /**
     * Get user keys
     */
    async getUserKeys(userId) {
        return [
            `user:${userId}`,
            `orders:user:${userId}`,
            `cart:user:${userId}`,
            `wishlist:user:${userId}`
        ];
    }

    /**
     * Get keys by pattern
     */
    async getKeysByPattern(pattern) {
        // In production, query cache keys by pattern
        return [];
    }

    /**
     * Get usage pattern for adaptive invalidation
     */
    async getUsagePattern(key) {
        // In production, analyze cache usage
        return {
            frequency: 0.5,
            recency: 0.3,
            importance: 0.8
        };
    }

    /**
     * Determine optimal strategy based on usage
     */
    determineOptimalStrategy(usagePattern) {
        const { frequency, recency, importance } = usagePattern;

        if (frequency > 0.8 && importance > 0.7) {
            return INVALIDATION_STRATEGIES.EVENT_DRIVEN;
        }
        if (recency > 0.8) {
            return INVALIDATION_STRATEGIES.PATTERN_BASED;
        }
        if (importance > 0.6) {
            return INVALIDATION_STRATEGIES.DEPENDENCY_BASED;
        }
        return INVALIDATION_STRATEGIES.ADAPTIVE;
    }

    /**
     * Update usage pattern
     */
    async updateUsagePattern(key, pattern) {
        // In production, store usage patterns
        console.log(`📊 Updated usage pattern for ${key}`);
    }

    // ============================================
    // EVENT SYSTEM
    // ============================================

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for business events
        this.eventBus.on('product.updated', async (data) => {
            await this.invalidate(`product:${data.productId}`, {
                reason: 'product_updated',
                strategy: INVALIDATION_STRATEGIES.PRODUCT_UPDATE
            });
        });

        this.eventBus.on('order.created', async (data) => {
            await this.invalidate(`user:${data.userId}`, {
                reason: 'order_created',
                strategy: INVALIDATION_STRATEGIES.USER_SPECIFIC
            });
        });

        this.eventBus.on('inventory.updated', async (data) => {
            await this.invalidate(`product:${data.productId}`, {
                reason: 'inventory_updated',
                strategy: INVALIDATION_STRATEGIES.DEPENDENCY_BASED
            });
        });

        this.eventBus.on('settings.updated', async (data) => {
            await this.invalidate('settings:all', {
                reason: 'settings_updated',
                strategy: INVALIDATION_STRATEGIES.PATTERN_BASED
            });
        });
    }

    /**
     * Emit an event
     */
    emit(event, data) {
        this.eventBus.emit(event, data);
        this.stats.events++;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeDependency(key, dependency) {
        try {
            await db.query(
                `INSERT INTO cache_dependencies 
                 (key, dependencies, strategy, ttl, last_invalidated, invalidate_count)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 dependencies = VALUES(dependencies),
                 strategy = VALUES(strategy),
                 ttl = VALUES(ttl),
                 last_invalidated = VALUES(last_invalidated),
                 invalidate_count = VALUES(invalidate_count)`,
                [
                    key,
                    JSON.stringify(dependency.dependencies),
                    dependency.strategy,
                    dependency.ttl,
                    dependency.lastInvalidated,
                    dependency.invalidateCount
                ]
            );
        } catch (error) {
            console.error('Store dependency error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_dependencies,
                    COUNT(DISTINCT strategy) as strategies,
                    SUM(invalidate_count) as total_invalidations
                 FROM cache_dependencies`
            );

            return {
                ...stats[0],
                ...this.stats,
                activeStrategies: Object.values(INVALIDATION_STRATEGIES),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            return null;
        }
    }

    getStatus() {
        return {
            dependencies: this.dependencies.size,
            patterns: this.patterns.size,
            invalidationQueue: this.invalidationQueue.length,
            stats: this.stats
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    AdaptiveCacheInvalidation,
    INVALIDATION_STRATEGIES,
    DEPENDENCY_TYPES,
    cacheInvalidation: new AdaptiveCacheInvalidation()
};