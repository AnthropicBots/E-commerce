// backend/services/recommendationStrategyService.js
const db = require('../config/db').promise;

// ============================================
// STRATEGY TYPES
// ============================================

const STRATEGY_TYPES = {
    TRENDING: 'trending',
    RECENTLY_VIEWED: 'recently_viewed',
    COLLABORATIVE: 'collaborative',
    CONTENT_BASED: 'content_based',
    HYBRID: 'hybrid',
    PROMOTIONAL: 'promotional',
    PERSONALIZED: 'personalized'
};

// ============================================
// BASE STRATEGY CLASS
// ============================================

class RecommendationStrategy {
    constructor(name, type) {
        this.name = name;
        this.type = type;
    }

    async getRecommendations(userId, limit = 10) {
        throw new Error('getRecommendations must be implemented');
    }
}

// ============================================
// STRATEGY IMPLEMENTATIONS
// ============================================

/**
 * Trending Products Strategy
 * Returns most popular products based on sales/views
 */
class TrendingStrategy extends RecommendationStrategy {
    constructor() {
        super('Trending Products', STRATEGY_TYPES.TRENDING);
        this.weight = {
            sales: 0.4,
            views: 0.3,
            wishlist: 0.2,
            recency: 0.1
        };
    }

    async getRecommendations(userId, limit = 10) {
        try {
            const [products] = await db.query(`
                SELECT 
                    p.id,
                    p.name,
                    p.price,
                    p.image_url,
                    p.category,
                    COUNT(o.id) as sales_count,
                    COUNT(v.id) as view_count,
                    COUNT(w.id) as wishlist_count,
                    DATEDIFF(NOW(), p.created_at) as days_old
                FROM products p
                LEFT JOIN orders o ON o.product_id = p.id
                LEFT JOIN product_views v ON v.product_id = p.id
                LEFT JOIN wishlist w ON w.product_id = p.id
                WHERE p.stock > 0
                GROUP BY p.id
                ORDER BY 
                    (COUNT(o.id) * 0.4 + COUNT(v.id) * 0.3 + COUNT(w.id) * 0.2 + 1/DATEDIFF(NOW(), p.created_at) * 0.1) DESC
                LIMIT ?
            `, [limit]);

            return products.map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                imageUrl: p.image_url,
                category: p.category,
                score: (p.sales_count * 0.4 + p.view_count * 0.3 + p.wishlist_count * 0.2 + 1/(p.days_old+1) * 0.1),
                reason: 'Trending product'
            }));
        } catch (error) {
            console.error('Trending strategy error:', error);
            return [];
        }
    }
}

/**
 * Recently Viewed Strategy
 * Returns products based on user's viewing history
 */
class RecentlyViewedStrategy extends RecommendationStrategy {
    constructor() {
        super('Recently Viewed', STRATEGY_TYPES.RECENTLY_VIEWED);
    }

    async getRecommendations(userId, limit = 10) {
        try {
            const [products] = await db.query(`
                SELECT 
                    p.id,
                    p.name,
                    p.price,
                    p.image_url,
                    p.category,
                    v.viewed_at
                FROM product_views v
                JOIN products p ON p.id = v.product_id
                WHERE v.user_id = ?
                AND p.stock > 0
                ORDER BY v.viewed_at DESC
                LIMIT ?
            `, [userId, limit]);

            return products.map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                imageUrl: p.image_url,
                category: p.category,
                viewedAt: p.viewed_at,
                reason: 'Recently viewed'
            }));
        } catch (error) {
            console.error('Recently viewed strategy error:', error);
            return [];
        }
    }
}

/**
 * Collaborative Filtering Strategy
 * Finds products based on similar users' preferences
 */
class CollaborativeStrategy extends RecommendationStrategy {
    constructor() {
        super('Collaborative Filtering', STRATEGY_TYPES.COLLABORATIVE);
    }

    async getRecommendations(userId, limit = 10) {
        try {
            // Find similar users based on purchase history
            const [similarUsers] = await db.query(`
                SELECT DISTINCT o2.user_id
                FROM orders o1
                JOIN orders o2 ON o1.product_id = o2.product_id
                WHERE o1.user_id = ?
                AND o2.user_id != ?
                GROUP BY o2.user_id
                ORDER BY COUNT(o2.product_id) DESC
                LIMIT 5
            `, [userId, userId]);

            if (similarUsers.length === 0) {
                return [];
            }

            const userIds = similarUsers.map(u => u.user_id);
            const placeholders = userIds.map(() => '?').join(',');

            const [products] = await db.query(`
                SELECT 
                    p.id,
                    p.name,
                    p.price,
                    p.image_url,
                    p.category,
                    COUNT(o.id) as purchase_count
                FROM orders o
                JOIN products p ON p.id = o.product_id
                WHERE o.user_id IN (${placeholders})
                AND p.id NOT IN (
                    SELECT product_id FROM orders WHERE user_id = ?
                )
                AND p.stock > 0
                GROUP BY p.id
                ORDER BY purchase_count DESC
                LIMIT ?
            `, [...userIds, userId, limit]);

            return products.map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                imageUrl: p.image_url,
                category: p.category,
                score: p.purchase_count,
                reason: 'Users like you also bought'
            }));
        } catch (error) {
            console.error('Collaborative strategy error:', error);
            return [];
        }
    }
}

/**
 * Content-Based Strategy
 * Recommends products similar to what user has viewed/purchased
 */
class ContentBasedStrategy extends RecommendationStrategy {
    constructor() {
        super('Content-Based', STRATEGY_TYPES.CONTENT_BASED);
    }

    async getRecommendations(userId, limit = 10) {
        try {
            // Get user's preferred categories
            const [preferences] = await db.query(`
                SELECT 
                    p.category,
                    COUNT(*) as count
                FROM orders o
                JOIN products p ON p.id = o.product_id
                WHERE o.user_id = ?
                GROUP BY p.category
                ORDER BY count DESC
                LIMIT 3
            `, [userId]);

            if (preferences.length === 0) {
                // Fallback to trending
                const trending = new TrendingStrategy();
                return trending.getRecommendations(userId, limit);
            }

            const categories = preferences.map(p => p.category);
            const placeholders = categories.map(() => '?').join(',');

            const [products] = await db.query(`
                SELECT 
                    p.id,
                    p.name,
                    p.price,
                    p.image_url,
                    p.category
                FROM products p
                WHERE p.category IN (${placeholders})
                AND p.id NOT IN (
                    SELECT product_id FROM orders WHERE user_id = ?
                )
                AND p.stock > 0
                ORDER BY RAND()
                LIMIT ?
            `, [...categories, userId, limit]);

            return products.map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                imageUrl: p.image_url,
                category: p.category,
                reason: 'Based on your preferences'
            }));
        } catch (error) {
            console.error('Content-based strategy error:', error);
            return [];
        }
    }
}

/**
 * Hybrid Strategy
 * Combines multiple strategies for better recommendations
 */
class HybridStrategy extends RecommendationStrategy {
    constructor() {
        super('Hybrid', STRATEGY_TYPES.HYBRID);
        this.strategies = [
            new TrendingStrategy(),
            new RecentlyViewedStrategy(),
            new CollaborativeStrategy(),
            new ContentBasedStrategy()
        ];
        this.weights = {
            trending: 0.25,
            recently_viewed: 0.25,
            collaborative: 0.25,
            content_based: 0.25
        };
    }

    async getRecommendations(userId, limit = 10) {
        try {
            const allRecommendations = [];
            const seen = new Set();

            // Get recommendations from each strategy
            for (const strategy of this.strategies) {
                const results = await strategy.getRecommendations(userId, Math.ceil(limit / this.strategies.length));
                
                // Score and deduplicate
                for (const item of results) {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        const weight = this.weights[strategy.type] || 0.25;
                        item.weightedScore = (item.score || 0) * weight;
                        allRecommendations.push(item);
                    }
                }
            }

            // Sort by weighted score and limit
            return allRecommendations
                .sort((a, b) => (b.weightedScore || 0) - (a.weightedScore || 0))
                .slice(0, limit)
                .map(item => ({
                    ...item,
                    reason: item.reason || 'Recommended for you'
                }));
        } catch (error) {
            console.error('Hybrid strategy error:', error);
            return [];
        }
    }
}

/**
 * Promotional Strategy
 * Recommends products with active promotions/discounts
 */
class PromotionalStrategy extends RecommendationStrategy {
    constructor() {
        super('Promotional', STRATEGY_TYPES.PROMOTIONAL);
    }

    async getRecommendations(userId, limit = 10) {
        try {
            const [products] = await db.query(`
                SELECT 
                    p.id,
                    p.name,
                    p.price,
                    p.image_url,
                    p.category,
                    p.discount_price,
                    p.discount_percentage
                FROM products p
                WHERE p.discount_percentage > 0
                AND p.stock > 0
                ORDER BY p.discount_percentage DESC
                LIMIT ?
            `, [limit]);

            return products.map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                discountPrice: p.discount_price,
                discountPercentage: p.discount_percentage,
                imageUrl: p.image_url,
                category: p.category,
                reason: `${p.discount_percentage}% OFF - Special deal!`
            }));
        } catch (error) {
            console.error('Promotional strategy error:', error);
            return [];
        }
    }
}

/**
 * Personalized Strategy
 * Uses user data for personalized recommendations
 */
class PersonalizedStrategy extends RecommendationStrategy {
    constructor() {
        super('Personalized', STRATEGY_TYPES.PERSONALIZED);
    }

    async getRecommendations(userId, limit = 10) {
        try {
            // Get user's purchase history and preferences
            const [userData] = await db.query(`
                SELECT 
                    u.id,
                    u.preferences,
                    COUNT(o.id) as total_orders,
                    AVG(o.total_amount) as avg_order_value
                FROM users u
                LEFT JOIN orders o ON o.user_id = u.id
                WHERE u.id = ?
                GROUP BY u.id
            `, [userId]);

            if (!userData || userData.total_orders === 0) {
                // New user - use hybrid
                const hybrid = new HybridStrategy();
                return hybrid.getRecommendations(userId, limit);
            }

            // Use combined approach based on user preferences
            const preferences = JSON.parse(userData.preferences || '{}');
            const strategies = [];

            if (preferences.trending) {
                strategies.push(new TrendingStrategy());
            }
            if (preferences.collaborative) {
                strategies.push(new CollaborativeStrategy());
            }
            if (preferences.content_based) {
                strategies.push(new ContentBasedStrategy());
            }

            if (strategies.length === 0) {
                // Default to hybrid
                const hybrid = new HybridStrategy();
                return hybrid.getRecommendations(userId, limit);
            }

            // Combine selected strategies
            const allRecommendations = [];
            const seen = new Set();

            for (const strategy of strategies) {
                const results = await strategy.getRecommendations(userId, Math.ceil(limit / strategies.length));
                for (const item of results) {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        allRecommendations.push(item);
                    }
                }
            }

            return allRecommendations.slice(0, limit);
        } catch (error) {
            console.error('Personalized strategy error:', error);
            return [];
        }
    }
}

// ============================================
// STRATEGY FACTORY
// ============================================

class RecommendationStrategyFactory {
    static createStrategy(type) {
        switch (type) {
            case STRATEGY_TYPES.TRENDING:
                return new TrendingStrategy();
            case STRATEGY_TYPES.RECENTLY_VIEWED:
                return new RecentlyViewedStrategy();
            case STRATEGY_TYPES.COLLABORATIVE:
                return new CollaborativeStrategy();
            case STRATEGY_TYPES.CONTENT_BASED:
                return new ContentBasedStrategy();
            case STRATEGY_TYPES.HYBRID:
                return new HybridStrategy();
            case STRATEGY_TYPES.PROMOTIONAL:
                return new PromotionalStrategy();
            case STRATEGY_TYPES.PERSONALIZED:
                return new PersonalizedStrategy();
            default:
                return new HybridStrategy();
        }
    }

    static getAllStrategies() {
        return [
            new TrendingStrategy(),
            new RecentlyViewedStrategy(),
            new CollaborativeStrategy(),
            new ContentBasedStrategy(),
            new HybridStrategy(),
            new PromotionalStrategy(),
            new PersonalizedStrategy()
        ];
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    RecommendationStrategyFactory,
    STRATEGY_TYPES,
    // Individual strategies for testing
    TrendingStrategy,
    RecentlyViewedStrategy,
    CollaborativeStrategy,
    ContentBasedStrategy,
    HybridStrategy,
    PromotionalStrategy,
    PersonalizedStrategy
};