// backend/services/recommendationService.js
//
// Fixes #1294.
//
// This file previously held two complete, incompatible recommendation engines
// concatenated together:
//
//   A) a `node-cache` + free-function implementation exporting an object
//      literal, whose `getRecommendations(userId, limit, offset)` took a
//      pagination offset as its third argument; and
//   B) this class, whose `getRecommendations(userId, limit, strategy)` takes a
//      strategy name as its third argument.
//
// Both declared `const cache` and both declared `const recommendationService`
// in module scope, so the file did not parse:
//
//     SyntaxError: Identifier 'cache' has already been declared
//
// Implementation A was removed rather than B. A's `validateUserId()` did
// `isNaN(parseInt(userId))`, which rejects every UUID — and externally exposed
// ids were migrated to UUIDs in #1025 — so it could not have worked against
// the current schema. A's only behaviour worth keeping was its bounds
// checking, which is folded into `clampLimit()` below; the class previously
// passed `limit` through to SQL unclamped.

const db = require("../config/db");
const { INTERACTION_TYPES } = require("../constants/interactionTypes");

// Cache configuration
const CACHE_TTL = 300000; // 5 minutes
const CACHE_CLEAN_INTERVAL = 600000; // 10 minutes
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

const cache = new Map();

/**
 * Clamp a caller-supplied limit into [1, MAX_LIMIT].
 *
 * Carried over from the implementation that was removed. Without it a caller
 * could pass `?limit=100000` straight through to a `LIMIT` clause.
 *
 * @param {any} limit
 * @returns {number}
 */
function clampLimit(limit) {
    const parsed = Number.parseInt(limit, 10);
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_LIMIT);
}

class RecommendationService {
    constructor() {
        this.maxItems = 20;
        this.cacheTTL = CACHE_TTL;
        this.initialized = false;
        // Handle for the periodic cache sweep, so shutdown() can stop it.
        this.cleanupTimer = null;
    }

    /**
     * Initialize service
     */
    initialize() {
        if (this.initialized) return this;

        // Clean cache periodically. The handle is retained so shutdown() can
        // clear it -- previously the interval was created and dropped, so it
        // kept the event loop alive forever and shutdown() could not stop it.
        // unref() lets the process exit while the timer is still pending,
        // which is what stops this service from hanging the test runner.
        this.cleanupTimer = setInterval(() => this.cleanCache(), CACHE_CLEAN_INTERVAL);
        if (typeof this.cleanupTimer.unref === 'function') {
            this.cleanupTimer.unref();
        }

        this.initialized = true;
        console.log('✅ Recommendation Service initialized');
        return this;
    }

    /**
     * Get recommendations with multiple strategies
     *
     * @param {string} userId
     * @param {number} [limit] - Clamped into [1, MAX_LIMIT].
     * @param {'hybrid'|'collaborative'|'content_based'} [strategy]
     */
    async getRecommendations(userId, limit = DEFAULT_LIMIT, strategy = 'hybrid') {
        const safeLimit = clampLimit(limit);

        if (!userId) {
            return this.getTrendingProducts(safeLimit);
        }

        try {
            // Cache key includes the limit: the same user asking for 8 and for
            // 24 items must not share an entry, or the second caller silently
            // receives the first caller's shorter list.
            const cacheKey = `recommendations_${userId}_${strategy}_${safeLimit}`;
            const cached = cache.get(cacheKey);
            
            if (cached && cached.timestamp && (Date.now() - cached.timestamp < this.cacheTTL)) {
                return cached.data;
            }

            let recommendations = [];

            switch (strategy) {
                case 'collaborative':
                    recommendations = await this.collaborativeFiltering(userId, safeLimit);
                    break;
                case 'content_based':
                    recommendations = await this.contentBased(userId, safeLimit);
                    break;
                case 'hybrid':
                default:
                    recommendations = await this.hybridRecommendations(userId, safeLimit);
                    break;
            }

            // Cache results
            if (recommendations.length > 0) {
                cache.set(cacheKey, {
                    data: recommendations,
                    timestamp: Date.now()
                });
            }

            return recommendations;
        } catch (error) {
            console.error("❌ Error generating recommendations:", error);
            return this.getTrendingProducts(safeLimit);
        }
    }

    /**
     * Hybrid recommendations combining multiple strategies
     */
    async hybridRecommendations(userId, limit) {
        try {
            // Get user interactions
            const interactions = await this.getUserInteractions(userId);
            
            if (!interactions || interactions.length === 0) {
                return this.getTrendingProducts(limit);
            }

            // Calculate category scores with weights
            const categoryScores = this.calculateCategoryScores(interactions);
            
            // Get purchased products to exclude
            const purchasedIds = await this.getPurchasedProductIds(userId);
            
            // Get user's viewed categories
            const viewedCategories = this.getViewedCategories(interactions);
            
            // Get recommendations from multiple sources
            const recommendations = await this.getMultiSourceRecommendations(
                userId,
                categoryScores,
                purchasedIds,
                viewedCategories,
                limit
            );

            // Add recommendation type metadata
            return recommendations.map(r => ({
                ...r,
                recommendationType: this.getRecommendationType(r)
            }));
        } catch (error) {
            console.error("❌ Hybrid recommendations error:", error);
            return this.getTrendingProducts(limit);
        }
    }

    /**
     * Collaborative filtering - find similar users
     */
    async collaborativeFiltering(userId, limit) {
        try {
            // Find similar users based on interactions
            const [similarUsers] = await db.query(
                `SELECT 
                    o2.user_id,
                    COUNT(*) as common_products
                 FROM user_interactions o1
                 JOIN user_interactions o2 ON o1.product_id = o2.product_id
                 WHERE o1.user_id = ? 
                 AND o2.user_id != ?
                 AND o1.interaction_type IN (?, ?, ?)
                 AND o2.interaction_type IN (?, ?, ?)
                 GROUP BY o2.user_id
                 ORDER BY common_products DESC
                 LIMIT 5`,
                [
                    userId, 
                    userId,
                    INTERACTION_TYPES.PURCHASE,
                    INTERACTION_TYPES.CART_ADD,
                    INTERACTION_TYPES.WISHLIST_ADD,
                    INTERACTION_TYPES.PURCHASE,
                    INTERACTION_TYPES.CART_ADD,
                    INTERACTION_TYPES.WISHLIST_ADD
                ]
            );

            if (similarUsers.length === 0) return [];

            const userIds = similarUsers.map(u => u.user_id);
            const placeholders = userIds.map(() => '?').join(',');

            // Get products from similar users
            const [recommendations] = await db.query(
                `SELECT 
                    p.*,
                    COUNT(ui.id) as interaction_count,
                    AVG(CASE 
                        WHEN ui.interaction_type = ? THEN 5
                        WHEN ui.interaction_type = ? THEN 3
                        WHEN ui.interaction_type = ? THEN 2
                        ELSE 1
                    END) as score
                 FROM user_interactions ui
                 JOIN products p ON p.id = ui.product_id
                 WHERE ui.user_id IN (${placeholders})
                 AND ui.product_id NOT IN (
                     SELECT product_id FROM user_interactions 
                     WHERE user_id = ? 
                     AND interaction_type = ?
                 )
                 AND p.stock > 0
                 GROUP BY p.id
                 ORDER BY score DESC, interaction_count DESC
                 LIMIT ?`,
                [
                    ...userIds,
                    userId,
                    INTERACTION_TYPES.PURCHASE,
                    INTERACTION_TYPES.PURCHASE,
                    INTERACTION_TYPES.CART_ADD,
                    INTERACTION_TYPES.WISHLIST_ADD,
                    limit
                ]
            );

            return recommendations;
        } catch (error) {
            console.error("❌ Collaborative filtering error:", error);
            return [];
        }
    }

    /**
     * Content-based recommendations
     */
    async contentBased(userId, limit) {
        try {
            // Get user's preferred categories
            const [preferences] = await db.query(
                `SELECT 
                    p.category,
                    COUNT(*) as interaction_count,
                    SUM(CASE 
                        WHEN ui.interaction_type = ? THEN 5
                        WHEN ui.interaction_type = ? THEN 3
                        WHEN ui.interaction_type = ? THEN 2
                        ELSE 1
                    END) as score
                 FROM user_interactions ui
                 JOIN products p ON p.id = ui.product_id
                 WHERE ui.user_id = ?
                 GROUP BY p.category
                 ORDER BY score DESC, interaction_count DESC
                 LIMIT 3`,
                [
                    INTERACTION_TYPES.PURCHASE,
                    INTERACTION_TYPES.CART_ADD,
                    INTERACTION_TYPES.WISHLIST_ADD,
                    userId
                ]
            );

            if (preferences.length === 0) return [];

            const categories = preferences.map(p => p.category);
            const placeholders = categories.map(() => '?').join(',');

            // Recommend products from preferred categories
            const [recommendations] = await db.query(
                `SELECT 
                    p.*,
                    p.category
                 FROM products p
                 WHERE p.category IN (${placeholders})
                 AND p.id NOT IN (
                     SELECT product_id FROM user_interactions 
                     WHERE user_id = ? 
                     AND interaction_type = ?
                 )
                 AND p.stock > 0
                 ORDER BY 
                    CASE 
                        WHEN p.rating IS NULL THEN 0
                        ELSE p.rating
                    END DESC,
                    p.created_at DESC
                 LIMIT ?`,
                [...categories, userId, INTERACTION_TYPES.PURCHASE, limit]
            );

            return recommendations;
        } catch (error) {
            console.error("❌ Content-based error:", error);
            return [];
        }
    }

    /**
     * Get trending products
     *
     * Public entry point, so the limit is clamped here as well as in
     * getRecommendations().
     */
    async getTrendingProducts(limit = 10) {
        limit = clampLimit(limit);
        try {
            const [recommendations] = await db.query(
                `SELECT 
                    p.*,
                    COUNT(ui.id) as interaction_count,
                    AVG(CASE 
                        WHEN ui.interaction_type = ? THEN 5
                        WHEN ui.interaction_type = ? THEN 3
                        WHEN ui.interaction_type = ? THEN 2
                        ELSE 1
                    END) as trending_score
                 FROM products p
                 LEFT JOIN user_interactions ui ON ui.product_id = p.id
                 WHERE p.stock > 0
                 GROUP BY p.id
                 ORDER BY trending_score DESC, p.rating DESC, interaction_count DESC
                 LIMIT ?`,
                [
                    INTERACTION_TYPES.PURCHASE,
                    INTERACTION_TYPES.CART_ADD,
                    INTERACTION_TYPES.WISHLIST_ADD,
                    limit
                ]
            );

            return recommendations;
        } catch (error) {
            console.error("❌ Get trending error:", error);
            return [];
        }
    }

    /**
     * Get user interactions
     */
    async getUserInteractions(userId) {
        try {
            const [interactions] = await db.query(
                `SELECT ui.interaction_type, p.category
                 FROM user_interactions ui
                 JOIN products p ON ui.product_id = p.id
                 WHERE ui.user_id = ?
                 ORDER BY ui.created_at DESC
                 LIMIT 100`,
                [userId]
            );

            return interactions;
        } catch (error) {
            console.error("❌ Get user interactions error:", error);
            return [];
        }
    }

    /**
     * Calculate category scores
     */
    calculateCategoryScores(interactions) {
        const weights = {
            [INTERACTION_TYPES.PURCHASE]: 5,
            [INTERACTION_TYPES.CART_ADD]: 3,
            [INTERACTION_TYPES.WISHLIST_ADD]: 2,
            [INTERACTION_TYPES.VIEW]: 1,
        };

        const categoryScores = {};
        interactions.forEach((item) => {
            if (!item.category) return;
            const weight = weights[item.interaction_type] || 1;
            categoryScores[item.category] = (categoryScores[item.category] || 0) + weight;
        });

        return categoryScores;
    }

    /**
     * Get purchased product IDs
     */
    async getPurchasedProductIds(userId) {
        try {
            const [purchased] = await db.query(
                `SELECT product_id
                 FROM user_interactions
                 WHERE user_id = ? AND interaction_type = ?`,
                [userId, INTERACTION_TYPES.PURCHASE]
            );

            return purchased.map((p) => p.product_id);
        } catch (error) {
            console.error("❌ Get purchased products error:", error);
            return [];
        }
    }

    /**
     * Get viewed categories
     */
    getViewedCategories(interactions) {
        const categories = interactions
            .filter(i => i.category)
            .map(i => i.category);
        return [...new Set(categories)];
    }

    /**
     * Get multi-source recommendations
     */
    async getMultiSourceRecommendations(userId, categoryScores, purchasedIds, viewedCategories, limit) {
        const topCategories = Object.entries(categoryScores)
            .sort((a, b) => b[1] - a[1])
            .map(entry => entry[0]);

        if (topCategories.length === 0) {
            return this.getTrendingProducts(limit);
        }

        const categoryPlaceholders = topCategories.map(() => "?").join(",");
        const queryParams = [...topCategories];

        let query = `
            SELECT 
                p.*,
                p.category
            FROM products p
            WHERE p.category IN (${categoryPlaceholders})
            AND p.stock > 0
        `;

        if (purchasedIds.length > 0) {
            const idPlaceholders = purchasedIds.map(() => "?").join(",");
            query += ` AND p.id NOT IN (${idPlaceholders})`;
            queryParams.push(...purchasedIds);
        }

        // Prefer products from top categories
        query += ` ORDER BY 
            CASE 
                WHEN p.category IN (${topCategories.map(() => '?').join(',')}) THEN 1
                ELSE 2
            END,
            p.rating DESC,
            p.created_at DESC
            LIMIT ?`;

        queryParams.push(...topCategories, limit);

        const [recommendations] = await db.query(query, queryParams);
        return recommendations;
    }

    /**
     * Get recommendation type
     */
    getRecommendationType(product) {
        if (product.rating >= 4.5) return 'top_rated';
        if (product.recommendationType) return product.recommendationType;
        return 'personalized';
    }

    /**
     * Get personalized recommendations for a specific product
     */
    async getRelatedProducts(productId, limit = 5) {
        limit = clampLimit(limit);
        try {
            // Get product details
            const [product] = await db.query(
                'SELECT category FROM products WHERE id = ?',
                [productId]
            );

            if (!product || product.length === 0) return [];

            const category = product[0].category;

            // Find similar products
            const [related] = await db.query(
                `SELECT 
                    p.*,
                    CASE 
                        WHEN p.category = ? THEN 1
                        ELSE 0
                    END as relevance
                 FROM products p
                 WHERE p.id != ? AND p.stock > 0
                 ORDER BY relevance DESC, p.rating DESC, p.created_at DESC
                 LIMIT ?`,
                [category, productId, limit]
            );

            return related;
        } catch (error) {
            console.error("❌ Get related products error:", error);
            return [];
        }
    }

    /**
     * Clear cache
     */
    clearCache(userId = null) {
        if (userId) {
            // Clear specific user's cache
            for (const [key] of cache) {
                if (key.includes(userId)) {
                    cache.delete(key);
                }
            }
        } else {
            cache.clear();
        }
        console.log('🧹 Recommendation cache cleared');
    }

    /**
     * Clean expired cache entries
     */
    cleanCache() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, value] of cache) {
            if (value && value.timestamp && (now - value.timestamp > this.cacheTTL)) {
                cache.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleaned ${cleaned} expired recommendation cache entries`);
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        let total = 0;
        let expired = 0;
        const now = Date.now();
        
        for (const [key, value] of cache) {
            total++;
            if (value && value.timestamp && (now - value.timestamp > this.cacheTTL)) {
                expired++;
            }
        }
        
        return {
            totalEntries: total,
            expiredEntries: expired,
            cacheTTL: this.cacheTTL / 1000 + 's'
        };
    }

    /**
     * Shutdown service
     */
    shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        cache.clear();
        this.initialized = false;
        console.log('⏹️ Recommendation Service shut down');
    }
}

// Export singleton instance
const recommendationService = new RecommendationService();

// Auto-initialize
recommendationService.initialize();

module.exports = recommendationService;
