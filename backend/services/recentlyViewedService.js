// backend/services/recentlyViewedService.js
const db = require('../config/db').promise;

class RecentlyViewedService {
    constructor() {
        this.cache = new Map();
        this.maxItems = 20;
    }

    /**
     * Add product to recently viewed
     */
    async addViewed(userId, productId) {
        if (!userId || !productId) return;

        try {
            // Check if product exists
            const [product] = await db.query(
                'SELECT id, name, price, image_url FROM products WHERE id = ? AND stock > 0',
                [productId]
            );

            if (product.length === 0) return;

            // Get existing viewed items
            const key = `recently_viewed_${userId}`;
            let viewed = this.cache.get(key) || [];

            // Remove if already exists
            viewed = viewed.filter(item => item.id !== productId);

            // Add to front
            viewed.unshift({
                id: productId,
                name: product[0].name,
                price: product[0].price,
                imageUrl: product[0].image_url,
                viewedAt: new Date().toISOString()
            });

            // Limit size
            if (viewed.length > this.maxItems) {
                viewed = viewed.slice(0, this.maxItems);
            }

            this.cache.set(key, viewed);

            // Store in database
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
     * Get recently viewed products for user
     */
    async getRecentlyViewed(userId, limit = 10) {
        if (!userId) return [];

        try {
            // Check cache first
            const key = `recently_viewed_${userId}`;
            let viewed = this.cache.get(key);

            if (viewed && viewed.length > 0) {
                return viewed.slice(0, limit);
            }

            // Get from database
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
                [userId, limit]
            );

            if (rows.length > 0) {
                this.cache.set(key, rows);
                return rows;
            }

            return [];
        } catch (error) {
            console.error('Get recently viewed error:', error);
            return [];
        }
    }

    /**
     * Clear recently viewed for user
     */
    async clearRecentlyViewed(userId) {
        if (!userId) return;

        try {
            const key = `recently_viewed_${userId}`;
            this.cache.delete(key);

            await db.query(
                'DELETE FROM recently_viewed WHERE user_id = ?',
                [userId]
            );

            return true;
        } catch (error) {
            console.error('Clear recently viewed error:', error);
            return false;
        }
    }
}

module.exports = new RecentlyViewedService();