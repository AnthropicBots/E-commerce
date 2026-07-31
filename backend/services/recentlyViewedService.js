// backend/services/recentlyViewedService.js
const db = require('../config/db').promise;

class RecentlyViewedService {
    constructor() {
        this.cache = new Map();
        this.maxItems = 20;
        this.cacheTTL = 300000; // 5 minutes in milliseconds
        this.cleanupInterval = null;
        this.initialized = false;
    }

    /**
     * Initialize service with cleanup
     */
    initialize() {
        if (this.initialized) return;
        
        // Clean cache every 10 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanCache();
        }, 600000);
        
        this.initialized = true;
        console.log('✅ Recently Viewed Service initialized');
        return this;
    }

    /**
     * Add product to recently viewed
     */
    async addViewed(userId, productId) {
        if (!userId || !productId) {
            console.warn('⚠️ Missing userId or productId for recently viewed');
            return [];
        }

        try {
            // Validate product exists and is in stock
            const [product] = await db.query(
                `SELECT id, name, price, image_url, stock 
                 FROM products 
                 WHERE id = ?`,
                [productId]
            );

            if (product.length === 0) {
                console.warn(`⚠️ Product ${productId} not found`);
                return [];
            }

            // Don't add out of stock products
            if (product[0].stock <= 0) {
                console.warn(`⚠️ Product ${productId} is out of stock`);
                return [];
            }

            // Get existing viewed items
            const key = this.getCacheKey(userId);
            let viewed = this.cache.get(key) || [];

            // Remove if already exists
            viewed = viewed.filter(item => item.id !== productId);

            // Add to front
            viewed.unshift({
                id: productId,
                name: product[0].name,
                price: parseFloat(product[0].price),
                imageUrl: product[0].image_url || '/assets/images/placeholder.png',
                viewedAt: new Date().toISOString()
            });

            // Limit size
            if (viewed.length > this.maxItems) {
                viewed = viewed.slice(0, this.maxItems);
            }

            // Store in cache with timestamp
            this.cache.set(key, {
                data: viewed,
                timestamp: Date.now()
            });

            // Store in database
            await db.query(
                `INSERT INTO recently_viewed (user_id, product_id, viewed_at) 
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE viewed_at = NOW()`,
                [userId, productId]
            );

            return viewed;
        } catch (error) {
            console.error('❌ Add recently viewed error:', error);
            return [];
        }
    }

    /**
     * Get recently viewed products for user
     */
    async getRecentlyViewed(userId, limit = 10) {
        if (!userId) {
            console.warn('⚠️ No userId provided for recently viewed');
            return [];
        }

        try {
            const key = this.getCacheKey(userId);
            const cached = this.cache.get(key);

            // Check cache with TTL
            if (cached && cached.data && cached.data.length > 0) {
                const age = Date.now() - cached.timestamp;
                if (age < this.cacheTTL) {
                    return cached.data.slice(0, limit);
                }
                // Cache expired, remove it
                this.cache.delete(key);
            }

            // Get from database
            const [rows] = await db.query(
                `SELECT 
                    p.id,
                    p.name,
                    p.price,
                    COALESCE(p.image_url, '/assets/images/placeholder.png') as imageUrl,
                    rv.viewed_at as viewedAt
                 FROM recently_viewed rv
                 INNER JOIN products p ON p.id = rv.product_id
                 WHERE rv.user_id = ? AND p.stock > 0
                 ORDER BY rv.viewed_at DESC
                 LIMIT ?`,
                [userId, Math.min(limit, this.maxItems)]
            );

            if (rows.length > 0) {
                // Cache the results
                this.cache.set(key, {
                    data: rows,
                    timestamp: Date.now()
                });
                return rows;
            }

            return [];
        } catch (error) {
            console.error('❌ Get recently viewed error:', error);
            return [];
        }
    }

    /**
     * Get recently viewed with product details
     */
    async getRecentlyViewedWithDetails(userId, limit = 10) {
        const products = await this.getRecentlyViewed(userId, limit);
        
        if (products.length === 0) return [];

        try {
            // Get additional details for each product
            const productIds = products.map(p => p.id);
            const placeholders = productIds.map(() => '?').join(',');
            
            const [details] = await db.query(
                `SELECT 
                    p.id,
                    p.name,
                    p.description,
                    p.price,
                    p.image_url as imageUrl,
                    p.category,
                    p.stock,
                    p.avg_rating,
                    COUNT(r.id) as review_count
                 FROM products p
                 LEFT JOIN reviews r ON r.product_id = p.id
                 WHERE p.id IN (${placeholders})
                 GROUP BY p.id`,
                productIds
            );

            // Merge details with viewed data
            return products.map(product => {
                const detail = details.find(d => d.id === product.id);
                return detail ? { ...product, ...detail } : product;
            });
        } catch (error) {
            console.error('❌ Get recently viewed with details error:', error);
            return products;
        }
    }

    /**
     * Clear recently viewed for user
     */
    async clearRecentlyViewed(userId) {
        if (!userId) {
            console.warn('⚠️ No userId provided for clearing recently viewed');
            return false;
        }

        try {
            const key = this.getCacheKey(userId);
            this.cache.delete(key);

            await db.query(
                'DELETE FROM recently_viewed WHERE user_id = ?',
                [userId]
            );

            console.log(`🧹 Cleared recently viewed for user ${userId}`);
            return true;
        } catch (error) {
            console.error('❌ Clear recently viewed error:', error);
            return false;
        }
    }

    /**
     * Remove specific product from recently viewed
     */
    async removeFromViewed(userId, productId) {
        if (!userId || !productId) return false;

        try {
            const key = this.getCacheKey(userId);
            const cached = this.cache.get(key);
            
            if (cached && cached.data) {
                cached.data = cached.data.filter(item => item.id !== productId);
                this.cache.set(key, cached);
            }

            await db.query(
                'DELETE FROM recently_viewed WHERE user_id = ? AND product_id = ?',
                [userId, productId]
            );

            return true;
        } catch (error) {
            console.error('❌ Remove from viewed error:', error);
            return false;
        }
    }

    /**
     * Get recently viewed count for user
     */
    async getCount(userId) {
        if (!userId) return 0;

        try {
            const [result] = await db.query(
                'SELECT COUNT(*) as count FROM recently_viewed WHERE user_id = ?',
                [userId]
            );
            return result[0]?.count || 0;
        } catch (error) {
            console.error('❌ Get count error:', error);
            return 0;
        }
    }

    /**
     * Get cache key for user
     */
    getCacheKey(userId) {
        return `recently_viewed_${userId}`;
    }

    /**
     * Clean expired cache entries
     */
    cleanCache() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, value] of this.cache) {
            if (value && value.timestamp) {
                const age = now - value.timestamp;
                if (age > this.cacheTTL) {
                    this.cache.delete(key);
                    cleaned++;
                }
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleaned ${cleaned} expired cache entries`);
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        let total = 0;
        let expired = 0;
        const now = Date.now();
        
        for (const [key, value] of this.cache) {
            total++;
            if (value && value.timestamp && (now - value.timestamp > this.cacheTTL)) {
                expired++;
            }
        }
        
        return {
            totalEntries: total,
            expiredEntries: expired,
            maxItems: this.maxItems,
            cacheTTL: this.cacheTTL / 1000 + 's'
        };
    }

    /**
     * Sync cache with database (for data consistency)
     */
    async syncCache(userId) {
        if (!userId) return;

        try {
            const [rows] = await db.query(
                `SELECT 
                    p.id,
                    p.name,
                    p.price,
                    p.image_url as imageUrl,
                    rv.viewed_at as viewedAt
                 FROM recently_viewed rv
                 JOIN products p ON p.id = rv.product_id
                 WHERE rv.user_id = ? AND p.stock > 0
                 ORDER BY rv.viewed_at DESC
                 LIMIT ?`,
                [userId, this.maxItems]
            );

            const key = this.getCacheKey(userId);
            this.cache.set(key, {
                data: rows,
                timestamp: Date.now()
            });

            return rows;
        } catch (error) {
            console.error('❌ Sync cache error:', error);
            return [];
        }
    }

    /**
     * Get recently viewed with pagination
     */
    async getRecentlyViewedPaginated(userId, page = 1, limit = 10) {
        if (!userId) return { data: [], pagination: {} };

        try {
            const offset = (page - 1) * limit;
            
            const [rows] = await db.query(
                `SELECT 
                    p.id,
                    p.name,
                    p.price,
                    p.image_url as imageUrl,
                    rv.viewed_at as viewedAt
                 FROM recently_viewed rv
                 JOIN products p ON p.id = rv.product_id
                 WHERE rv.user_id = ? AND p.stock > 0
                 ORDER BY rv.viewed_at DESC
                 LIMIT ? OFFSET ?`,
                [userId, limit, offset]
            );

            const total = await this.getCount(userId);
            
            return {
                data: rows,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            console.error('❌ Get recently viewed paginated error:', error);
            return { data: [], pagination: {} };
        }
    }

    /**
     * Shutdown service
     */
    shutdown() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.cache.clear();
        this.initialized = false;
        console.log('⏹️ Recently Viewed Service shut down');
    }
}

// Export singleton instance
const recentlyViewedService = new RecentlyViewedService();

// Auto-initialize
recentlyViewedService.initialize();

module.exports = recentlyViewedService;