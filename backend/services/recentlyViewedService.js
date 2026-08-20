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

// #1610 fixed the second defect this cache had. `addViewed` seeded its list
// from `readCache(userId) || []`, so on a MISS -- a cold worker, a restart, or
// simply the first view after the 5-minute TTL lapsed -- the cache was written
// back holding exactly one row: the product just viewed. `getRecentlyViewed`
// then served any non-empty cache without consulting the database, so the
// user's whole history vanished from the storefront for five minutes and came
// back only when the entry expired, at which point the next view wiped it
// again.
//
// The comment in `addViewed` claimed "the next read will reconcile with the
// database anyway". Nothing reconciled anything. It does now, and the mechanism
// is the `complete` flag below: an entry is complete only when it came from a
// database read, and only a complete entry may be served without one.

const db = require('../config/db').promise;

const PLACEHOLDER_IMAGE = '/assets/images/placeholder.png';

/**
 * One row shape, whichever path produced it.
 *
 * The two writers disagreed: the database read hands back `viewed_at` aliased
 * to `viewedAt` as a MySQL DATETIME, while `addViewed` wrote
 * `new Date().toISOString()`. Any consumer that sorted or formatted that field
 * got a Date sometimes and a string other times, depending on which path last
 * filled the cache.
 *
 * @param {object} row
 * @returns {object}
 */
const normalizeEntry = (row) => {
    const source = row || {};
    const viewedAt = source.viewedAt ?? source.viewed_at ?? null;
    const parsed = viewedAt instanceof Date ? viewedAt : new Date(viewedAt);

    return {
        id: source.id,
        name: source.name,
        price: Number.isFinite(parseFloat(source.price)) ? parseFloat(source.price) : 0,
        imageUrl: source.imageUrl || source.image || PLACEHOLDER_IMAGE,
        viewedAt: Number.isNaN(parsed.getTime())
            ? new Date().toISOString()
            : parsed.toISOString()
    };
};

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
     *
     * @returns {{data: Array, timestamp: number, complete: boolean}|null}
     */
    readCacheEntry(userId) {
        const key = this.getCacheKey(userId);
        const cached = this.cache.get(key);

        if (!cached || !Array.isArray(cached.data)) return null;

        if (Date.now() - cached.timestamp >= this.cacheTTL) {
            this.cache.delete(key);
            return null;
        }

        return cached;
    }

    /**
     * The cached rows for a user, or null.
     *
     * Kept alongside `readCacheEntry` because "give me the list" is what most
     * callers want; only the read path needs to know whether the list is the
     * whole story.
     */
    readCache(userId) {
        const entry = this.readCacheEntry(userId);
        return entry ? entry.data : null;
    }

    /**
     * Write a user's cache entry in the one shape every reader expects.
     *
     * `complete` says whether this list is the user's whole history (capped at
     * `maxItems`) or merely some of it. Only a database read may claim `true`.
     * Treating "non-empty" as "complete" is what made a single view hide the
     * rest of the list for five minutes (#1610).
     *
     * @param {string} userId
     * @param {Array} data
     * @param {{complete?: boolean}} [options]
     */
    writeCache(userId, data, { complete = false } = {}) {
        const rows = (Array.isArray(data) ? data : []).map(normalizeEntry);

        this.cache.set(this.getCacheKey(userId), {
            data: rows,
            timestamp: Date.now(),
            complete: Boolean(complete)
        });

        return rows;
    }

    /**
     * Drop a user's cache entry so the next read goes to the database.
     */
    invalidateCache(userId) {
        return this.cache.delete(this.getCacheKey(userId));
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

            // The database is written first and unconditionally: the view has
            // happened whatever the cache believes, and every reconciliation
            // path below reads back from here.
            await db.query(
                `INSERT INTO recently_viewed (user_id, product_id, viewed_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE viewed_at = NOW()`,
                [userId, productId]
            );

            const entry = this.readCacheEntry(userId);

            // Only a list that is already the whole history may be extended in
            // place. Anything else -- a miss, an expired entry, a list seeded
            // by an earlier partial write -- is reconciled against the database
            // rather than being grown from a fragment and then trusted.
            //
            // This is the fix for #1610. The old code did the opposite: it
            // started from `[]` on a miss, wrote a one-item list, and
            // `getRecentlyViewed` then served that one item for the next five
            // minutes.
            if (!entry || !entry.complete) {
                return this.syncCache(userId);
            }

            const viewed = entry.data
                // Move an existing entry to the front rather than duplicating
                // it. Compared as strings: `products.id` is a CHAR(36) UUID,
                // and the numeric comparison this class used to carry matched
                // nothing at all (#1497).
                .filter((item) => String(item.id) !== String(productId))
                .slice(0, this.maxItems - 1);

            viewed.unshift(normalizeEntry({
                id: productId,
                name: product[0].name,
                price: product[0].price,
                imageUrl: product[0].image || PLACEHOLDER_IMAGE,
                viewedAt: new Date().toISOString()
            }));

            // Still complete: the whole history plus one product that is now
            // part of it, capped the same way the database read is.
            return this.writeCache(userId, viewed, { complete: true });
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

        const effectiveLimit = Math.min(Math.max(1, Number(limit) || 10), this.maxItems);

        try {
            const entry = this.readCacheEntry(userId);

            // `complete` and nothing else. Emptiness is not the question --
            // a one-row entry seeded by a view is non-empty and wrong, and a
            // genuinely empty history is complete and right.
            if (entry && entry.complete) {
                return entry.data.slice(0, effectiveLimit);
            }

            // Always read the full window, never just what this caller asked
            // for. A cache filled from a limit-5 read cannot answer a limit-10
            // one, and "complete" would stop meaning anything if it could hold
            // fewer rows than the history has.
            const rows = await this.fetchFromDatabase(userId, this.maxItems);

            // Cached even when empty: "this user has viewed nothing" is a fact
            // worth not re-querying for every page load, and the entry still
            // expires on the TTL.
            const cached = this.writeCache(userId, rows, { complete: true });

            return cached.slice(0, effectiveLimit);
        } catch (error) {
            console.error('Get recently viewed error:', error);
            return [];
        }
    }

    /**
     * The user's history, newest first, straight from the database.
     *
     * The one place the visibility predicate and the column aliases live, so
     * `getRecentlyViewed`, `syncCache` and anything added later cannot drift
     * apart -- which is how this file ended up with two different SELECT lists
     * spliced together in the first place (#1341).
     *
     * @param {string} userId
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async fetchFromDatabase(userId, limit) {
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
            [PLACEHOLDER_IMAGE, userId, limit]
        );

        return Array.isArray(rows) ? rows : [];
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
            this.invalidateCache(userId);

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
            const entry = this.readCacheEntry(userId);
            if (entry) {
                // Removing a row cannot make an incomplete list complete, and
                // cannot make a complete one incomplete -- so the flag is
                // carried through rather than reset. Compared as strings
                // because `products.id` is a UUID.
                this.writeCache(
                    userId,
                    entry.data.filter((item) => String(item.id) !== String(productId)),
                    { complete: entry.complete }
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
        // Surfaced because a cache full of partial entries is the symptom of
        // #1610 coming back, and the admin route is where that would be seen.
        let partial = 0;

        for (const [, value] of this.cache) {
            total++;
            if (value && value.timestamp && now - value.timestamp > this.cacheTTL) {
                expired++;
            }
            if (value && !value.complete) {
                partial++;
            }
        }

        return {
            totalEntries: total,
            expiredEntries: expired,
            partialEntries: partial,
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
            const rows = await this.fetchFromDatabase(userId, this.maxItems);

            return this.writeCache(userId, rows, { complete: true });
        } catch (error) {
            console.error('Sync cache error:', error);

            // A failed sync must not leave a stale or partial entry behind
            // claiming to be the whole history.
            this.invalidateCache(userId);
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
