// backend/services/recommendationService.js
const db = require("../config/db");
const { INTERACTION_TYPES } = require("../constants/interactionTypes");
const NodeCache = require('node-cache');

const config = {
    cacheTTL: parseInt(process.env.RECOMMENDATION_CACHE_TTL) || 300,
    interactionLimit: parseInt(process.env.INTERACTION_LIMIT) || 100,
    defaultLimit: parseInt(process.env.DEFAULT_LIMIT) || 8,
    maxLimit: parseInt(process.env.MAX_LIMIT) || 50,
    weights: {
        [INTERACTION_TYPES.PURCHASE]: parseInt(process.env.WEIGHT_PURCHASE) || 5,
        [INTERACTION_TYPES.CART_ADD]: parseInt(process.env.WEIGHT_CART) || 3,
        [INTERACTION_TYPES.WISHLIST_ADD]: parseInt(process.env.WEIGHT_WISHLIST) || 2,
        [INTERACTION_TYPES.VIEW]: parseInt(process.env.WEIGHT_VIEW) || 1
    }
};

const cache = new NodeCache({
    stdTTL: config.cacheTTL,
    checkperiod: 60
});

function validateUserId(userId) {
    if (!userId || isNaN(parseInt(userId))) {
        throw new Error('Invalid user ID');
    }
    return parseInt(userId);
}

function validateLimit(limit) {
    const parsed = parseInt(limit) || config.defaultLimit;
    if (parsed < 1) {
        throw new Error('Limit must be greater than 0');
    }
    if (parsed > config.maxLimit) {
        throw new Error(`Limit cannot exceed ${config.maxLimit}`);
    }
    return parsed;
}

function validateOffset(offset) {
    const parsed = parseInt(offset) || 0;
    if (parsed < 0) {
        throw new Error('Offset must be greater than or equal to 0');
    }
    return parsed;
}

function getCacheKey(userId, limit, offset) {
    return `recommendations_${userId}_${limit}_${offset}`;
}


// Cache configuration
const CACHE_TTL = 300000; // 5 minutes
const cache = new Map();

class RecommendationService {
    constructor() {
        this.maxItems = 20;
        this.cacheTTL = CACHE_TTL;
        this.initialized = false;
    }

    /**
     * Initialize service
     */
    initialize() {
        if (this.initialized) return;
        
        // Clean cache periodically
        setInterval(() => this.cleanCache(), 600000); // 10 minutes
        
        this.initialized = true;
        console.log('✅ Recommendation Service initialized');
        return this;
    }

    /**
     * Get recommendations with multiple strategies
     */
    async getRecommendations(userId, limit = 8, strategy = 'hybrid') {
        if (!userId) {
            return this.getTrendingProducts(limit);
        }

        try {
            // Check cache
            const cacheKey = `recommendations_${userId}_${strategy}`;
            const cached = cache.get(cacheKey);
            
            if (cached && cached.timestamp && (Date.now() - cached.timestamp < this.cacheTTL)) {
                return cached.data;
            }

            let recommendations = [];

            switch (strategy) {
                case 'collaborative':
                    recommendations = await this.collaborativeFiltering(userId, limit);
                    break;
                case 'content_based':
                    recommendations = await this.contentBased(userId, limit);
                    break;
                case 'hybrid':
                default:
                    recommendations = await this.hybridRecommendations(userId, limit);
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
            return this.getTrendingProducts(limit);
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
     */
    async getTrendingProducts(limit = 10) {
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
        cache.clear();
        this.initialized = false;
        console.log('⏹️ Recommendation Service shut down');
    }
}

// Export singleton instance
const recommendationService = new RecommendationService();

// Auto-initialize
recommendationService.initialize();

const recommendationService = {
    getRecommendations: async (userId, limit = config.defaultLimit, offset = 0) => {
        try {
            const validUserId = validateUserId(userId);
            const validLimit = validateLimit(limit);
            const validOffset = validateOffset(offset);

            const cacheKey = getCacheKey(validUserId, validLimit, validOffset);
            const cached = cache.get(cacheKey);
            if (cached) {
                console.log(`Cache hit for user ${validUserId}`);
                return cached;
            }

            const [interactions] = await db.query(
                `
                SELECT ui.interaction_type, p.category, ui.product_id
                FROM user_interactions ui
                JOIN products p ON ui.product_id = p.id
                WHERE ui.user_id = ?
                ORDER BY ui.created_at DESC
                LIMIT ?
                `,
                [validUserId, config.interactionLimit]
            );

            if (!interactions || interactions.length === 0) {
                const fallback = await getFallbackRecommendations(validLimit);
                cache.set(cacheKey, fallback);
                return fallback;
            }

            const weights = config.weights;
            const categoryScores = {};
            interactions.forEach((item) => {
                if (!item.category) return;
                const weight = weights[item.interaction_type] || 1;
                categoryScores[item.category] =
                    (categoryScores[item.category] || 0) + weight;
            });

            const topCategories = Object.entries(categoryScores)
                .sort((a, b) => b[1] - a[1])
                .map((entry) => entry[0]);

            if (topCategories.length === 0) {
                const fallback = await getFallbackRecommendations(validLimit);
                cache.set(cacheKey, fallback);
                return fallback;
            }

            const [purchased] = await db.query(
                `
                SELECT product_id
                FROM user_interactions
                WHERE user_id = ? AND interaction_type = ?
                `,
                [validUserId, INTERACTION_TYPES.PURCHASE]
            );

            const purchasedIds = purchased.map((p) => p.product_id);
            const categoryPlaceholders = topCategories.map(() => "?").join(",");

            let query = `
                SELECT * FROM products
                WHERE category IN (${categoryPlaceholders})
                AND stock > 0
                AND status = 'active'
            `;

            const queryParams = [...topCategories];

            if (purchasedIds.length > 0) {
                const idPlaceholders = purchasedIds.map(() => "?").join(",");
                query += ` AND id NOT IN (${idPlaceholders})`;
                queryParams.push(...purchasedIds);
            }

            query += ` ORDER BY rating DESC, num_reviews DESC LIMIT ? OFFSET ?`;
            queryParams.push(validLimit, validOffset);

            const [recommendedProducts] = await db.query(query, queryParams);

            const result = {
                data: recommendedProducts,
                pagination: {
                    limit: validLimit,
                    offset: validOffset,
                    total: recommendedProducts.length
                }
            };

            cache.set(cacheKey, result);

            console.log(`Recommendations generated for user ${validUserId}: ${recommendedProducts.length} products`);

            return result;

        } catch (error) {
            console.error("Error generating recommendations:", error);
            throw error;
        }
    },

    getTrendingRecommendations: async (limit = config.defaultLimit) => {
        try {
            const validLimit = validateLimit(limit);

            const [products] = await db.query(
                `
                SELECT p.*, 
                       COUNT(ui.id) as interaction_count,
                       AVG(ui.rating) as avg_rating
                FROM products p
                LEFT JOIN user_interactions ui ON p.id = ui.product_id
                WHERE p.stock > 0 AND p.status = 'active'
                GROUP BY p.id
                ORDER BY interaction_count DESC, avg_rating DESC
                LIMIT ?
                `,
                [validLimit]
            );

            return {
                data: products,
                pagination: {
                    limit: validLimit,
                    total: products.length
                }
            };
        } catch (error) {
            console.error("Error getting trending recommendations:", error);
            throw error;
        }
    },

    getSimilarProducts: async (productId, limit = config.defaultLimit) => {
        try {
            const validLimit = validateLimit(limit);

            const [product] = await db.query(
                'SELECT category FROM products WHERE id = ? AND status = "active"',
                [productId]
            );

            if (!product || product.length === 0) {
                throw new Error('Product not found');
            }

            const category = product[0].category;

            const [similar] = await db.query(
                `
                SELECT * FROM products
                WHERE category = ?
                AND id != ?
                AND stock > 0
                AND status = 'active'
                ORDER BY rating DESC
                LIMIT ?
                `,
                [category, productId, validLimit]
            );

            return {
                data: similar,
                pagination: {
                    limit: validLimit,
                    total: similar.length
                }
            };
        } catch (error) {
            console.error("Error getting similar products:", error);
            throw error;
        }
    },

    clearCache: async (userId = null) => {
        try {
            if (userId) {
                const keys = cache.keys();
                const userKeys = keys.filter(key => key.includes(`_${userId}_`));
                userKeys.forEach(key => cache.del(key));
                console.log(`Cleared cache for user ${userId}: ${userKeys.length} entries`);
                return { cleared: userKeys.length };
            } else {
                cache.flushAll();
                console.log('Cleared all recommendation cache');
                return { cleared: 'all' };
            }
        } catch (error) {
            console.error("Error clearing cache:", error);
            throw error;
        }
    }
};


async function getFallbackRecommendations(limit) {
    const [fallbackProducts] = await db.query(
        `
        SELECT * FROM products
        WHERE stock > 0 AND status = 'active'
        ORDER BY rating DESC, num_reviews DESC
        LIMIT ?
        `,
        [limit]
    );
    return {
        data: fallbackProducts,
        pagination: {
            limit: limit,
            total: fallbackProducts.length
        }
    };
}

module.exports = recommendationService;