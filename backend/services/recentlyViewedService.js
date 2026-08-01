// backend/services/recentlyViewedService.js
//
// Recently-viewed product tracking with a short-lived in-process cache in front
// of the `recently_viewed` table.
//
// This file was rebuilt in #1341. Two generations of the service had been
// merged by keeping *both* sides of every conflict, which left it with:
//
//   * two `addViewed` headers, the first of which opened a `try` that never got
//     a `catch` -- the SyntaxError ("Missing catch or finally after try") that
//     made the module, and therefore `routes/recentlyViewedRoutes.js`,
//     unloadable;
//   * `getRecentlyViewed` spliced together from two different queries, so the
//     SELECT list of one ran into the FROM clause of the other;
//   * `clearRecentlyViewed` defined twice, the second silently winning;
//   * `module.exports = new RecentlyViewedService()` sitting in the *middle* of
//     the class body, with six more methods after it;
//   * two competing cache shapes -- a bare array and `{ data, timestamp }` --
//     written to the same key, while every reader expected the second one.
//
// The `{ data, timestamp }` shape is the one `cleanCache`, `getCacheStats`,
// `syncCache` and the TTL check all rely on, so that is the shape kept
// throughout. Column names are also corrected against `backend/schema.sql`:
// the products table has `image`, `category_id`, `rating` and `num_reviews` --
// not `image_url`, `category` or `avg_rating` -- so the surviving queries would
// have failed with ER_BAD_FIELD_ERROR even once the file parsed.

const db = require('../config/db').promise;

const PLACEHOLDER_IMAGE = '/assets/images/placeholder.png';

class RecentlyViewedService {
    constructor() {
        this.cache = new Map();
        this.maxItems = 20;
        this.cacheTTL = 300000; // 5 minutes in milliseconds
        this.cleanupInterval = null;
        this.initialized = false;
    }

    /**
     * Initialize service with periodic cache cleanup.
     */
    initialize() {
        if (this.initialized) return this;

        // Clean cache every 10 minutes.
        this.cleanupInterval = setInterval(() => {
            this.cleanCache();
        }, 600000);

        // Do not hold the event loop open for a cache sweep -- without this a
        // process that has finished its work (and every Jest worker that has
        // required this module) hangs until the timer is cleared.
        if (typeof this.cleanupInterval.unref === 'function') {
            this.cleanupInterval.unref();
        }

        this.initialized = true;
        return this;
    }

    /**
     * Cache key for a user.
     */
    getCacheKey(userId) {
        return `recently_viewed_${userId}`;
    }

    /**
     * Read a user's cache entry, honouring the TTL.
     *
     * Returns null when there is nothing usable, so callers never have to know
     * whether a miss was an absent key or an expired one.
     */
    readCache(userId) {
        const key = this.getCacheKey(userId);
        const cached = this.cache.get(key);

        if (!cached || !Array.isArray(cached.data)) return null;

        if (Date.now() - cached.timestamp >= this.cacheTTL) {
            this.cache.delete(key);
            return null;
        }

        return cached.data;
    }

    /**
     * Write a user's cache entry in the one shape every reader expects.
     */
    writeCache(userId, data) {
        this.cache.set(this.getCacheKey(userId), {
            data,
            timestamp: Date.now()
        });
        return data;
    }

    /**
     * Add a product to a user's recently-viewed list.
     *
     * Out-of-stock and unknown products are ignored rather than cached, so the
     * list never shows something the user cannot buy.
     *
     * @returns {Promise<Array>} the updated list (empty on any failure)
     */
    async addViewed(userId, productId) {
        if (!userId || !productId) {
            console.warn('Missing userId or productId for recently viewed');
            return [];
        }

        try {
            const [product] = await db.query(
                'SELECT id, name, price, image, stock FROM products WHERE id = ? AND deleted_at IS NULL',
                [productId]
            );

            if (product.length === 0) {
                console.warn(`Product ${productId} not found`);
                return [];
            }

            if (product[0].stock <= 0) {
                console.warn(`Product ${productId} is out of stock`);
                return [];
            }

            // Start from whatever is cached; a miss simply means this write
            // seeds a fresh list, which the next read will reconcile with the
            // database anyway.
            let viewed = this.readCache(userId) || [];

            // Move an existing entry to the front rather than duplicating it.
            viewed = viewed.filter((item) => item.id !== productId);

            viewed.unshift({
                id: productId,
                name: product[0].name,
                price: parseFloat(product[0].price),
                imageUrl: product[0].image || PLACEHOLDER_IMAGE,
                viewedAt: new Date().toISOString()
            });

            if (viewed.length > this.maxItems) {
                viewed = viewed.slice(0, this.maxItems);
            }

            this.writeCache(userId, viewed);

            await db.query(
                `INSERT INTO recently_viewed (user_id, product_id, viewed_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE viewed_at = NOW()`,
                [userId, productId]
            );

            return viewed;
        } catch (error) {
            console.error('Add recently viewed error:', error);
            return [];
        }
    }

    /**
     * Get a user's recently-viewed products, newest first.
     */
    async getRecentlyViewed(userId, limit = 10) {
        if (!userId) {
            console.warn('No userId provided for recently viewed');
            return [];
        }

        const effectiveLimit = Math.min(Number(limit) || 10, this.maxItems);

        try {
            const cached = this.readCache(userId);
            if (cached && cached.length > 0) {
                return cached.slice(0, effectiveLimit);
            }

            const [rows] = await db.query(
                `SELECT
                    p.id,
                    p.name,
                    p.price,
                    COALESCE(p.image, ?) AS imageUrl,
                    rv.viewed_at AS viewedAt
                 FROM recently_viewed rv
                 INNER JOIN products p ON p.id = rv.product_id
                 WHERE rv.user_id = ? AND p.stock > 0 AND p.deleted_at IS NULL
                 ORDER BY rv.viewed_at DESC
                 LIMIT ?`,
                [PLACEHOLDER_IMAGE, userId, effectiveLimit]
            );

            if (rows.length > 0) {
                this.writeCache(userId, rows);
            }

            return rows;
        } catch (error) {
            console.error('Get recently viewed error:', error);
            return [];
        }
    }

    /**
     * Get recently-viewed products enriched with catalogue detail.
     *
     * Falls back to the plain list if the detail lookup fails, because a
     * missing description is not a reason to show the user an empty carousel.
     */
    async getRecentlyViewedWithDetails(userId, limit = 10) {
        const products = await this.getRecentlyViewed(userId, limit);

        if (products.length === 0) return [];

        try {
            const productIds = products.map((p) => p.id);
            const placeholders = productIds.map(() => '?').join(',');

            const [details] = await db.query(
                `SELECT
                    p.id,
                    p.description,
                    c.name AS category,
                    p.stock,
                    p.rating,
                    p.num_reviews AS reviewCount
                 FROM products p
                 LEFT JOIN categories c ON c.id = p.category_id
                 WHERE p.id IN (${placeholders})`,
                productIds
            );

            const detailById = new Map(details.map((d) => [d.id, d]));

            return products.map((product) => {
                const detail = detailById.get(product.id);
                return detail ? { ...product, ...detail } : product;
            });
        } catch (error) {
            console.error('Get recently viewed with details error:', error);
            return products;
        }
    }

    /**
     * Clear a user's recently-viewed list.
     */
    async clearRecentlyViewed(userId) {
        if (!userId) {
            console.warn('No userId provided for clearing recently viewed');
            return false;
        }

        try {
            this.cache.delete(this.getCacheKey(userId));

            await db.query('DELETE FROM recently_viewed WHERE user_id = ?', [userId]);

            return true;
        } catch (error) {
            console.error('Clear recently viewed error:', error);
            return false;
        }
    }

    /**
     * Remove a single product from a user's recently-viewed list.
     */
    async removeFromViewed(userId, productId) {
        if (!userId || !productId) return false;

        try {
            const cached = this.readCache(userId);
            if (cached) {
                this.writeCache(
                    userId,
                    cached.filter((item) => item.id !== productId)
                );
            }

            await db.query(
                'DELETE FROM recently_viewed WHERE user_id = ? AND product_id = ?',
                [userId, productId]
            );

            return true;
        } catch (error) {
            console.error('Remove from viewed error:', error);
            return false;
        }
    }

    /**
     * Number of products a user has viewed.
     */
    async getCount(userId) {
        if (!userId) return 0;

        try {
            const [result] = await db.query(
                'SELECT COUNT(*) AS count FROM recently_viewed WHERE user_id = ?',
                [userId]
            );
            return result[0]?.count || 0;
        } catch (error) {
            console.error('Get count error:', error);
            return 0;
        }
    }

    /**
     * Drop expired cache entries.
     */
    cleanCache() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, value] of this.cache) {
            if (value && value.timestamp && now - value.timestamp > this.cacheTTL) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        return cleaned;
    }

    /**
     * Cache diagnostics, surfaced by the recently-viewed admin route.
     */
    getCacheStats() {
        const now = Date.now();
        let total = 0;
        let expired = 0;

        for (const [, value] of this.cache) {
            total++;
            if (value && value.timestamp && now - value.timestamp > this.cacheTTL) {
                expired++;
            }
        }

        return {
            totalEntries: total,
            expiredEntries: expired,
            maxItems: this.maxItems,
            cacheTTL: `${this.cacheTTL / 1000}s`
        };
    }

    /**
     * Force the cache for a user back into agreement with the database.
     */
    async syncCache(userId) {
        if (!userId) return [];

        try {
            const [rows] = await db.query(
                `SELECT
                    p.id,
                    p.name,
                    p.price,
                    COALESCE(p.image, ?) AS imageUrl,
                    rv.viewed_at AS viewedAt
                 FROM recently_viewed rv
                 INNER JOIN products p ON p.id = rv.product_id
                 WHERE rv.user_id = ? AND p.stock > 0 AND p.deleted_at IS NULL
                 ORDER BY rv.viewed_at DESC
                 LIMIT ?`,
                [PLACEHOLDER_IMAGE, userId, this.maxItems]
            );

            return this.writeCache(userId, rows);
        } catch (error) {
            console.error('Sync cache error:', error);
            return [];
        }
    }

    /**
     * Paginated view over a user's history.
     *
     * This reads straight through to the database: the cache only ever holds
     * the first `maxItems`, so paging off it would silently truncate.
     */
    async getRecentlyViewedPaginated(userId, page = 1, limit = 10) {
        const emptyPage = { data: [], pagination: { page: 1, limit, total: 0, pages: 0 } };

        if (!userId) return emptyPage;

        const safePage = Math.max(1, Number(page) || 1);
        const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 100);

        try {
            const offset = (safePage - 1) * safeLimit;

            const [rows] = await db.query(
                `SELECT
                    p.id,
                    p.name,
                    p.price,
                    COALESCE(p.image, ?) AS imageUrl,
                    rv.viewed_at AS viewedAt
                 FROM recently_viewed rv
                 INNER JOIN products p ON p.id = rv.product_id
                 WHERE rv.user_id = ? AND p.stock > 0 AND p.deleted_at IS NULL
                 ORDER BY rv.viewed_at DESC
                 LIMIT ? OFFSET ?`,
                [PLACEHOLDER_IMAGE, userId, safeLimit, offset]
            );

            const total = await this.getCount(userId);

            return {
                data: rows,
                pagination: {
                    page: safePage,
                    limit: safeLimit,
                    total,
                    pages: Math.ceil(total / safeLimit)
                }
            };
        } catch (error) {
            console.error('Get recently viewed paginated error:', error);
            return emptyPage;
        }
    }

    /**
     * Stop the cleanup timer and drop the cache.
     */
    shutdown() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.cache.clear();
        this.initialized = false;
    }
}

// Export singleton instance.
const recentlyViewedService = new RecentlyViewedService();
recentlyViewedService.initialize();

module.exports = recentlyViewedService;
module.exports.RecentlyViewedService = RecentlyViewedService;
