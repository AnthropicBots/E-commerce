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

    /**
     * Lock product row and return stock (Issue #1260).
     * Must be called inside an open transaction.
     */
    async lockForUpdate(id, connection = null) {
        const db = connection || this.db;
        const [rows] = await db.query(
            `SELECT id, name, stock FROM ${this.tableName} WHERE id = ? FOR UPDATE`,
            [id]
        );
        return rows[0] || null;
    }

    /**
     * Atomic decrement that refuses to drive stock negative.
     * Returns { success, availableStock, affectedRows }.
     */
    async decrementStockAtomic(id, quantity, connection = null) {
        const db = connection || this.db;
        const qty = Number(quantity);

        const product = await this.lockForUpdate(id, db);
        if (!product) {
            return { success: false, availableStock: 0, affectedRows: 0, code: 'PRODUCT_NOT_FOUND' };
        }

        if (Number(product.stock) < qty) {
            return {
                success: false,
                availableStock: Number(product.stock),
                affectedRows: 0,
                code: 'INSUFFICIENT_STOCK',
                productName: product.name
            };
        }

        const [result] = await db.query(
            `UPDATE ${this.tableName}
             SET stock = stock - ?
             WHERE id = ? AND stock >= ?`,
            [qty, id, qty]
        );

        this.cache.delete(id);

        if (result.affectedRows === 0) {
            return {
                success: false,
                availableStock: 0,
                affectedRows: 0,
                code: 'INSUFFICIENT_STOCK',
                productName: product.name
            };
        }

        return {
            success: true,
            availableStock: Number(product.stock) - qty,
            affectedRows: result.affectedRows
        };
    }

    /**
     * Available sellable units = physical stock minus active reservations.
     */
    async getAvailableStock(id, connection = null) {
        const db = connection || this.db;
        const now = new Date();

        const [products] = await db.query(
            `SELECT stock FROM ${this.tableName} WHERE id = ? FOR UPDATE`,
            [id]
        );
        if (!products.length) {
            return { productId: id, totalStock: 0, lockedStock: 0, availableStock: 0 };
        }

        const [locks] = await db.query(
            `SELECT COALESCE(SUM(quantity), 0) AS locked_qty
             FROM inventory_locks
             WHERE product_id = ? AND expires_at > ?`,
            [id, now]
        );

        const totalStock = Number(products[0].stock) || 0;
        const lockedStock = Number(locks[0]?.locked_qty) || 0;
        return {
            productId: id,
            totalStock,
            lockedStock,
            availableStock: Math.max(0, totalStock - lockedStock)
        };
    }
}

module.exports = new ProductRepository();