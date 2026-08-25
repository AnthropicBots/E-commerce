// backend/services/recommendationStrategyService.js
//
// The strategies behind GET /api/recommendations (#1525).
//
// Every one of them was written against a schema this project does not have:
// `products.image_url` and `products.category` (the columns are `image` and
// `category_id`), `products.discount_price` and `products.discount_percentage`
// (there are none -- a discount is `compare_price` above `price`), and, in four
// separate queries, `orders.product_id`. Orders have never carried a product;
// what was bought lives in `order_items`.
//
// Each strategy then caught the resulting `ER_BAD_FIELD_ERROR` and returned an
// empty array, so the endpoint answered `200 {"count": 0}` and the homepage
// rendered "Explore more products to get personalized recommendations!" to
// every shopper, forever. Failing loudly is why the catches below rethrow.
//
// The queries here go through `order_items`, `product_views`, `wishlist_items`
// and `categories`, which is where this data actually is.

const db = require("../config/db");
const logger = require("../utils/logger");

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
// SHARED SQL
// ============================================

/**
 * A product that may be recommended.
 *
 * Recommending something the shop has withdrawn wastes the slot and sends the
 * shopper to a product page that will not load.
 */
const LIVE_PRODUCT = "p.is_active = 1 AND p.deleted_at IS NULL";

/**
 * The columns every strategy returns, so one mapper can shape all of them.
 *
 * `p.image`, not `p.image_url`. `c.name` through `categories`, because a
 * product carries a `category_id` and not a category name.
 */
const PRODUCT_COLUMNS = `
    p.id,
    p.name,
    p.price,
    p.compare_price,
    p.image,
    p.stock,
    p.rating,
    p.num_reviews,
    p.category_id,
    c.name AS category
`;

const PRODUCT_SOURCE = `
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
`;

/**
 * Orders that count as a purchase.
 *
 * Cancelled and refunded orders say nothing about what somebody wanted, and a
 * soft-deleted one should not be read at all.
 */
const PURCHASED = `
    o.status NOT IN ('cancelled', 'refunded') AND o.deleted_at IS NULL
`;

/**
 * Shape a product row for the client.
 *
 * `discount` is derived rather than stored: `compare_price` is the "was" price,
 * so a compare price above the selling price is the discount. The columns the
 * old code read (`discount_price`, `discount_percentage`) have never existed.
 *
 * @param {Object} row
 * @param {Object} [extra] strategy-specific fields (score, reason, viewedAt)
 * @returns {Object}
 */
function toRecommendation(row, extra = {}) {
    const price = Number(row.price) || 0;
    const comparePrice = Number(row.compare_price) || 0;
    const hasDiscount = comparePrice > price && price > 0;

    return {
        id: row.id,
        name: row.name,
        price,
        // The card reads `original_price` and `discount`; both are absent
        // rather than zero when the product is not on offer, so no badge is
        // rendered for a product that is simply at its normal price.
        original_price: hasDiscount ? comparePrice : null,
        discount: hasDiscount
            ? Math.round(((comparePrice - price) / comparePrice) * 100)
            : null,
        image: row.image,
        imageUrl: row.image,
        stock: Number(row.stock) || 0,
        rating: Number(row.rating) || 0,
        review_count: Number(row.num_reviews) || 0,
        categoryId: row.category_id,
        category: row.category,
        ...extra
    };
}

/**
 * Clamp a caller-supplied limit.
 *
 * `parseInt(req.query.limit)` reaches these straight from the query string, so
 * without this `?limit=1000000` is a LIMIT clause.
 */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

function clampLimit(limit) {
    const parsed = Number.parseInt(limit, 10);

    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;

    return Math.min(parsed, MAX_LIMIT);
}

// ============================================
// BASE STRATEGY CLASS
// ============================================

class RecommendationStrategy {
    constructor(name, type) {
        this.name = name;
        this.type = type;
    }

    async getRecommendations(userId, limit = DEFAULT_LIMIT) {
        throw new Error('getRecommendations must be implemented');
    }

    /**
     * Report a failure and let it travel.
     *
     * The previous version logged and returned `[]`, which turned "the query
     * does not compile" into "we have nothing to suggest" -- indistinguishable
     * from the ordinary empty case, and the reason a broken file sat in the
     * request path unnoticed. The route turns a thrown error into a 500, which
     * is what a failed lookup is.
     */
    fail(error) {
        logger.error(`${this.name} strategy failed: ${error.message}`);
        throw error;
    }
}

// ============================================
// STRATEGY IMPLEMENTATIONS
// ============================================

/**
 * Trending Products Strategy
 *
 * Popularity over the last 30 days: units sold, views logged, and how many
 * people have saved it. Bounded to a window because "most sold ever" is a
 * list that stops moving.
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

    async getRecommendations(userId, limit = DEFAULT_LIMIT) {
        const safeLimit = clampLimit(limit);

        try {
            // Counted in subqueries rather than three JOINs against one row.
            // Joining sales, views and wishlist rows together multiplies them
            // -- a product with 4 sales and 10 views counts 40 of each -- and
            // the original did exactly that, then divided by DATEDIFF, which
            // is a division by zero on anything added today.
            const [rows] = await db.query(`
                SELECT
                    ${PRODUCT_COLUMNS},
                    COALESCE(sales.units, 0) AS sales_count,
                    COALESCE(views.total, 0) AS view_count,
                    COALESCE(saves.total, 0) AS wishlist_count,
                    DATEDIFF(NOW(), p.created_at) AS days_old
                ${PRODUCT_SOURCE}
                LEFT JOIN (
                    SELECT oi.product_id, SUM(oi.qty) AS units
                    FROM order_items oi
                    JOIN orders o ON o.id = oi.order_id
                    WHERE ${PURCHASED}
                      AND o.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
                    GROUP BY oi.product_id
                ) sales ON sales.product_id = p.id
                LEFT JOIN (
                    SELECT product_id, COUNT(*) AS total
                    FROM product_views
                    WHERE viewed_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
                    GROUP BY product_id
                ) views ON views.product_id = p.id
                LEFT JOIN (
                    SELECT product_id, COUNT(*) AS total
                    FROM wishlist_items
                    GROUP BY product_id
                ) saves ON saves.product_id = p.id
                WHERE p.stock > 0 AND ${LIVE_PRODUCT}
                ORDER BY
                    COALESCE(sales.units, 0) * 0.4
                    + COALESCE(views.total, 0) * 0.3
                    + COALESCE(saves.total, 0) * 0.2
                    + (1 / (DATEDIFF(NOW(), p.created_at) + 1)) * 0.1 DESC
                LIMIT ?
            `, [safeLimit]);

            return rows.map((row) => toRecommendation(row, {
                score:
                    Number(row.sales_count) * this.weight.sales
                    + Number(row.view_count) * this.weight.views
                    + Number(row.wishlist_count) * this.weight.wishlist
                    + (1 / (Number(row.days_old) + 1)) * this.weight.recency,
                reason: 'Trending product'
            }));
        } catch (error) {
            return this.fail(error);
        }
    }
}

/**
 * Recently Viewed Strategy
 *
 * The last few products this shopper looked at, one row per product rather
 * than one per view -- `product_views` is an append-only log, so a product
 * looked at five times filled five of the ten slots.
 */
class RecentlyViewedStrategy extends RecommendationStrategy {
    constructor() {
        super('Recently Viewed', STRATEGY_TYPES.RECENTLY_VIEWED);
    }

    async getRecommendations(userId, limit = DEFAULT_LIMIT) {
        const safeLimit = clampLimit(limit);

        try {
            const [rows] = await db.query(`
                SELECT
                    ${PRODUCT_COLUMNS},
                    MAX(v.viewed_at) AS viewed_at
                ${PRODUCT_SOURCE}
                JOIN product_views v ON v.product_id = p.id
                WHERE v.user_id = ? AND p.stock > 0 AND ${LIVE_PRODUCT}
                GROUP BY p.id
                ORDER BY viewed_at DESC
                LIMIT ?
            `, [userId, safeLimit]);

            return rows.map((row) => toRecommendation(row, {
                viewedAt: row.viewed_at,
                reason: 'Recently viewed'
            }));
        } catch (error) {
            return this.fail(error);
        }
    }
}

/**
 * Collaborative Filtering Strategy
 *
 * What people who bought what this shopper bought also bought.
 */
class CollaborativeStrategy extends RecommendationStrategy {
    constructor() {
        super('Collaborative Filtering', STRATEGY_TYPES.COLLABORATIVE);
    }

    async getRecommendations(userId, limit = DEFAULT_LIMIT) {
        const safeLimit = clampLimit(limit);

        try {
            // Shoppers who bought at least one of the same products, ordered
            // by how much overlap there is. The join is order_items to
            // order_items through orders, because that is where a product id
            // on a purchase can be found.
            const [similarUsers] = await db.query(`
                SELECT o2.user_id, COUNT(DISTINCT oi2.product_id) AS shared
                FROM order_items oi1
                JOIN orders o1 ON o1.id = oi1.order_id
                JOIN order_items oi2 ON oi2.product_id = oi1.product_id
                JOIN orders o2 ON o2.id = oi2.order_id
                WHERE o1.user_id = ?
                  AND o2.user_id IS NOT NULL
                  AND o2.user_id <> ?
                  AND o1.status NOT IN ('cancelled', 'refunded')
                  AND o1.deleted_at IS NULL
                  AND o2.status NOT IN ('cancelled', 'refunded')
                  AND o2.deleted_at IS NULL
                GROUP BY o2.user_id
                ORDER BY shared DESC
                LIMIT 5
            `, [userId, userId]);

            if (!similarUsers.length) {
                return [];
            }

            const userIds = similarUsers.map((row) => row.user_id);
            const placeholders = userIds.map(() => '?').join(',');

            const [rows] = await db.query(`
                SELECT
                    ${PRODUCT_COLUMNS},
                    COUNT(*) AS purchase_count
                ${PRODUCT_SOURCE}
                JOIN order_items oi ON oi.product_id = p.id
                JOIN orders o ON o.id = oi.order_id
                WHERE o.user_id IN (${placeholders})
                  AND ${PURCHASED}
                  AND p.stock > 0 AND ${LIVE_PRODUCT}
                  AND p.id NOT IN (
                      SELECT oi_own.product_id
                      FROM order_items oi_own
                      JOIN orders o_own ON o_own.id = oi_own.order_id
                      WHERE o_own.user_id = ?
                  )
                GROUP BY p.id
                ORDER BY purchase_count DESC
                LIMIT ?
            `, [...userIds, userId, safeLimit]);

            return rows.map((row) => toRecommendation(row, {
                score: Number(row.purchase_count),
                reason: 'Users like you also bought'
            }));
        } catch (error) {
            return this.fail(error);
        }
    }
}

/**
 * Content-Based Strategy
 *
 * More of the categories this shopper buys from.
 */
class ContentBasedStrategy extends RecommendationStrategy {
    constructor() {
        super('Content-Based', STRATEGY_TYPES.CONTENT_BASED);
    }

    async getRecommendations(userId, limit = DEFAULT_LIMIT) {
        const safeLimit = clampLimit(limit);

        try {
            const [preferences] = await db.query(`
                SELECT p.category_id, COUNT(*) AS purchases
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                JOIN products p ON p.id = oi.product_id
                WHERE o.user_id = ? AND ${PURCHASED} AND p.category_id IS NOT NULL
                GROUP BY p.category_id
                ORDER BY purchases DESC
                LIMIT 3
            `, [userId]);

            if (!preferences.length) {
                // Nothing bought yet, so nothing to be similar to.
                return new TrendingStrategy().getRecommendations(userId, safeLimit);
            }

            const categoryIds = preferences.map((row) => row.category_id);
            const placeholders = categoryIds.map(() => '?').join(',');

            const [rows] = await db.query(`
                SELECT ${PRODUCT_COLUMNS}
                ${PRODUCT_SOURCE}
                WHERE p.category_id IN (${placeholders})
                  AND p.stock > 0 AND ${LIVE_PRODUCT}
                  AND p.id NOT IN (
                      SELECT oi.product_id
                      FROM order_items oi
                      JOIN orders o ON o.id = oi.order_id
                      WHERE o.user_id = ?
                  )
                ORDER BY p.rating DESC, p.sold_count DESC
                LIMIT ?
            `, [...categoryIds, userId, safeLimit]);

            return rows.map((row) => toRecommendation(row, {
                reason: 'Based on your preferences'
            }));
        } catch (error) {
            return this.fail(error);
        }
    }
}

/**
 * Hybrid Strategy
 *
 * The four above, weighted and deduplicated.
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

    async getRecommendations(userId, limit = DEFAULT_LIMIT) {
        const safeLimit = clampLimit(limit);
        const allRecommendations = [];
        const seen = new Set();
        let succeeded = 0;
        let lastError = null;

        for (const strategy of this.strategies) {
            let results;

            // The one place a failure is absorbed, and only because this is
            // four independent lookups: one of them failing should cost its
            // share of the list, not the whole response. If every one fails
            // the error is rethrown below rather than reported as "nothing to
            // suggest".
            try {
                results = await strategy.getRecommendations(
                    userId,
                    Math.ceil(safeLimit / this.strategies.length)
                );
                succeeded += 1;
            } catch (error) {
                lastError = error;
                continue;
            }

            for (const item of results) {
                if (seen.has(item.id)) continue;

                seen.add(item.id);
                allRecommendations.push({
                    ...item,
                    weightedScore:
                        (item.score || 0) * (this.weights[strategy.type] || 0.25)
                });
            }
        }

        if (!succeeded && lastError) {
            logger.error(`Hybrid strategy failed: every strategy errored`);
            throw lastError;
        }

        return allRecommendations
            .sort((a, b) => (b.weightedScore || 0) - (a.weightedScore || 0))
            .slice(0, safeLimit)
            .map((item) => ({
                ...item,
                reason: item.reason || 'Recommended for you'
            }));
    }
}

/**
 * Promotional Strategy
 *
 * Products currently marked down. A discount is `compare_price` standing above
 * `price` -- the "was" price the product page already shows. The columns the
 * previous version read, `discount_price` and `discount_percentage`, do not
 * exist on `products` and never have.
 */
class PromotionalStrategy extends RecommendationStrategy {
    constructor() {
        super('Promotional', STRATEGY_TYPES.PROMOTIONAL);
    }

    async getRecommendations(userId, limit = DEFAULT_LIMIT) {
        const safeLimit = clampLimit(limit);

        try {
            const [rows] = await db.query(`
                SELECT
                    ${PRODUCT_COLUMNS},
                    ROUND(((p.compare_price - p.price) / p.compare_price) * 100) AS discount_percentage
                ${PRODUCT_SOURCE}
                WHERE p.compare_price > p.price
                  AND p.price > 0
                  AND p.stock > 0
                  AND ${LIVE_PRODUCT}
                ORDER BY discount_percentage DESC
                LIMIT ?
            `, [safeLimit]);

            return rows.map((row) => toRecommendation(row, {
                score: Number(row.discount_percentage) || 0,
                reason: `${Number(row.discount_percentage) || 0}% OFF - Special deal!`
            }));
        } catch (error) {
            return this.fail(error);
        }
    }
}

/**
 * Personalized Strategy
 *
 * A shopper who has bought before gets collaborative and content-based
 * suggestions, which are the two that can use a purchase history; everyone
 * else gets the hybrid mix.
 *
 * The previous version read `users.preferences` -- a column that does not
 * exist -- to decide which strategies to combine, and read `total_orders` off
 * the rows *array* rather than off a row, so the check for a new shopper was
 * `undefined === 0` and never true.
 */
class PersonalizedStrategy extends RecommendationStrategy {
    constructor() {
        super('Personalized', STRATEGY_TYPES.PERSONALIZED);
    }

    async getRecommendations(userId, limit = DEFAULT_LIMIT) {
        const safeLimit = clampLimit(limit);

        try {
            const [rows] = await db.query(`
                SELECT COUNT(*) AS total_orders
                FROM orders o
                WHERE o.user_id = ? AND ${PURCHASED}
            `, [userId]);

            const totalOrders = Number(rows[0]?.total_orders) || 0;

            if (totalOrders === 0) {
                return new HybridStrategy().getRecommendations(userId, safeLimit);
            }

            const strategies = [
                new CollaborativeStrategy(),
                new ContentBasedStrategy()
            ];

            const combined = [];
            const seen = new Set();

            for (const strategy of strategies) {
                const results = await strategy.getRecommendations(
                    userId,
                    Math.ceil(safeLimit / strategies.length)
                );

                for (const item of results) {
                    if (seen.has(item.id)) continue;

                    seen.add(item.id);
                    combined.push(item);
                }
            }

            // Both of those need a purchase history to say anything, and a
            // shopper can have orders and still produce nothing from either --
            // one order of a product nobody else bought, in no category.
            if (!combined.length) {
                return new HybridStrategy().getRecommendations(userId, safeLimit);
            }

            return combined.slice(0, safeLimit);
        } catch (error) {
            return this.fail(error);
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
    MAX_LIMIT,
    DEFAULT_LIMIT,
    clampLimit,
    toRecommendation,
    // Individual strategies for testing
    RecommendationStrategy,
    TrendingStrategy,
    RecentlyViewedStrategy,
    CollaborativeStrategy,
    ContentBasedStrategy,
    HybridStrategy,
    PromotionalStrategy,
    PersonalizedStrategy
};
