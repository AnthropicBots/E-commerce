// backend/repositories/productRepository.js
const BaseRepository = require('./baseRepository');

class ProductRepository extends BaseRepository {
    constructor() {
        super('products', 'id');
    }

    /**
     * Find products by category
     */
    async findByCategory(category, options = {}) {
        const { limit = 20, offset = 0 } = options;

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} 
             WHERE category = ? AND stock > 0 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [category, limit, offset]
        );

        return rows;
    }

    /**
     * Find products by price range
     */
    async findByPriceRange(minPrice, maxPrice, options = {}) {
        const { limit = 20, offset = 0 } = options;

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} 
             WHERE price BETWEEN ? AND ? AND stock > 0 
             ORDER BY price ASC 
             LIMIT ? OFFSET ?`,
            [minPrice, maxPrice, limit, offset]
        );

        return rows;
    }

    /**
     * Search products
     */
    async search(query, options = {}) {
        const { limit = 20, offset = 0 } = options;

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} 
             WHERE (name LIKE ? OR description LIKE ?) AND stock > 0 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [`%${query}%`, `%${query}%`, limit, offset]
        );

        return rows;
    }

    /**
     * Get products with low stock
     */
    async getLowStockProducts(threshold = 10) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} 
             WHERE stock <= ? AND stock > 0 
             ORDER BY stock ASC`,
            [threshold]
        );

        return rows;
    }

    /**
     * Update stock
     */
    async updateStock(id, quantity) {
        const [result] = await this.db.query(
            `UPDATE ${this.tableName} SET stock = stock + ? WHERE id = ?`,
            [quantity, id]
        );

        this.cache.delete(id);
        return result.affectedRows > 0;
    }

    /**
     * Get product with reviews
     */
    async findWithReviews(id) {
        const [rows] = await this.db.query(
            `SELECT p.*, 
                    AVG(r.rating) as avg_rating,
                    COUNT(r.id) as review_count
             FROM ${this.tableName} p
             LEFT JOIN reviews r ON p.id = r.product_id
             WHERE p.id = ?
             GROUP BY p.id`,
            [id]
        );

        if (rows.length === 0) {
            return null;
        }

        // Get reviews
        const [reviews] = await this.db.query(
            `SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 10`,
            [id]
        );

        return {
            ...rows[0],
            reviews
        };
    }

    /**
     * Get related products
     */
    async getRelatedProducts(id, limit = 5) {
        const product = await this.findById(id);
        if (!product) return [];

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} 
             WHERE category = ? AND id != ? AND stock > 0 
             ORDER BY created_at DESC 
             LIMIT ?`,
            [product.category, id, limit]
        );

        return rows;
    }

    /**
     * Increment view count
     */
    async incrementViews(id) {
        await this.db.query(
            `UPDATE ${this.tableName} SET views = views + 1 WHERE id = ?`,
            [id]
        );
        this.cache.delete(id);
    }

    /**
     * Get products by IDs
     */
    async findByIds(ids) {
        if (!ids || ids.length === 0) return [];

        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} WHERE id IN (${placeholders})`,
            ids
        );

        return rows;
    }

    /**
     * Get featured products
     */
    async getFeatured(limit = 10) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName} 
             WHERE featured = 1 AND stock > 0 
             ORDER BY created_at DESC 
             LIMIT ?`,
            [limit]
        );

        return rows;
    }
}

module.exports = new ProductRepository();