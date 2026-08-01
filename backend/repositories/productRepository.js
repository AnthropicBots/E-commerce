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
     * Update stock (delta can be negative)
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
     * Lock product row and return current stock (#1260)
     */
    async getStockForUpdate(id, connection = null) {
        const db = connection || this.db;
        const [rows] = await db.query(
            `SELECT id, stock, name FROM ${this.tableName} WHERE id = ? FOR UPDATE`,
            [id]
        );
        return rows[0] || null;
    }

    /**
     * Atomic stock deduction — fails if stock would go negative
     */
    async deductStockAtomic(id, quantity, connection = null) {
        const db = connection || this.db;
        const qty = Math.abs(Number(quantity) || 0);
        if (qty <= 0) {
            return { ok: false, availableStock: null, reason: 'invalid_quantity' };
        }

        const [result] = await db.query(
            `UPDATE ${this.tableName}
             SET stock = stock - ?
             WHERE id = ? AND stock >= ?`,
            [qty, id, qty]
        );

        if (result.affectedRows === 0) {
            const [rows] = await db.query(
                `SELECT stock FROM ${this.tableName} WHERE id = ?`,
                [id]
            );
            return {
                ok: false,
                availableStock: rows[0] ? Number(rows[0].stock) : 0,
                reason: 'insufficient_stock'
            };
        }

        this.cache.delete(id);
        return { ok: true, deducted: qty };
    }

    /**
     * Restore stock (order cancel / rollback)
     */
    async restoreStock(id, quantity, connection = null) {
        const db = connection || this.db;
        const qty = Math.abs(Number(quantity) || 0);
        const [result] = await db.query(
            `UPDATE ${this.tableName} SET stock = stock + ? WHERE id = ?`,
            [qty, id]
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
     * Fetch a multi-tier category hierarchy in ONE recursive CTE roundtrip (#1264).
     * Avoids the classic N+1 "query children per node" cascade.
     *
     * @param {{ rootId?: number|null, maxDepth?: number }} options
     * @returns {Promise<object[]>} flat rows with depth
     */
    async fetchCategoryHierarchyViaCte(options = {}) {
        const maxDepth = Math.min(
            Math.max(parseInt(options.maxDepth, 10) || 5, 1),
            20
        );
        const rootId = options.rootId != null ? Number(options.rootId) : null;

        const [rows] = await this.db.query(
            `
            WITH RECURSIVE category_tree AS (
                SELECT
                    c.id,
                    c.parent_id,
                    c.name,
                    c.slug,
                    c.description,
                    c.image_url,
                    c.icon,
                    c.level,
                    c.path,
                    c.lft,
                    c.rgt,
                    c.display_order,
                    c.is_active,
                    0 AS depth
                FROM categories c
                WHERE c.deleted_at IS NULL
                  AND c.is_active = 1
                  AND (
                        (? IS NOT NULL AND c.id = ?)
                     OR (? IS NULL AND c.parent_id IS NULL)
                  )

                UNION ALL

                SELECT
                    child.id,
                    child.parent_id,
                    child.name,
                    child.slug,
                    child.description,
                    child.image_url,
                    child.icon,
                    child.level,
                    child.path,
                    child.lft,
                    child.rgt,
                    child.display_order,
                    child.is_active,
                    parent.depth + 1
                FROM categories child
                INNER JOIN category_tree parent ON child.parent_id = parent.id
                WHERE child.deleted_at IS NULL
                  AND child.is_active = 1
                  AND parent.depth < ?
            )
            SELECT *
            FROM category_tree
            ORDER BY depth ASC, display_order ASC, name ASC
            `,
            [rootId, rootId, rootId, maxDepth]
        );

        return rows;
    }

    /**
     * Serialize flat CTE rows into a nested JSON tree with a hard depth cap
     * to bound memory for very wide/deep catalogs.
     */
    buildCategoryTree(flatRows = [], options = {}) {
        const maxDepth = Math.min(
            Math.max(parseInt(options.maxDepth, 10) || 5, 1),
            20
        );
        const byId = new Map();
        const roots = [];

        for (const row of flatRows) {
            if (row.depth > maxDepth) continue;
            byId.set(row.id, {
                id: row.id,
                parentId: row.parent_id,
                name: row.name,
                slug: row.slug,
                description: row.description,
                imageUrl: row.image_url,
                icon: row.icon,
                level: row.level,
                path: row.path,
                lft: row.lft,
                rgt: row.rgt,
                displayOrder: row.display_order,
                depth: row.depth,
                children: []
            });
        }

        for (const node of byId.values()) {
            if (node.parentId != null && byId.has(node.parentId)) {
                byId.get(node.parentId).children.push(node);
            } else if (node.depth === 0) {
                roots.push(node);
            }
        }

        const sortRecursive = (nodes) => {
            nodes.sort((a, b) => {
                const orderDiff = (a.displayOrder || 0) - (b.displayOrder || 0);
                if (orderDiff !== 0) return orderDiff;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });
            for (const n of nodes) {
                if (n.children.length) sortRecursive(n.children);
            }
        };
        sortRecursive(roots);

        return roots;
    }

    /**
     * Optimized category navigation tree: 1 CTE query + in-memory nest.
     */
    async getCategoryTreeOptimized(options = {}) {
        const flat = await this.fetchCategoryHierarchyViaCte(options);
        return this.buildCategoryTree(flat, options);
    }

    /**
     * Rebuild MPTT lft/rgt bounds from the adjacency list in a single
     * read + batched updates (not per-node recursive SELECTs).
     */
    async rebuildCategoryMptt() {
        const [rows] = await this.db.query(
            `SELECT id, parent_id, display_order, name
             FROM categories
             WHERE deleted_at IS NULL
             ORDER BY display_order ASC, name ASC`
        );

        const childrenMap = new Map();
        for (const row of rows) {
            const key = row.parent_id == null ? 'root' : row.parent_id;
            if (!childrenMap.has(key)) childrenMap.set(key, []);
            childrenMap.get(key).push(row);
        }

        const bounds = new Map();
        let counter = 1;

        const dfs = (parentKey) => {
            const kids = childrenMap.get(parentKey) || [];
            for (const kid of kids) {
                const left = counter++;
                dfs(kid.id);
                const right = counter++;
                bounds.set(kid.id, { lft: left, rgt: right });
            }
        };
        dfs('root');

        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();
            for (const [id, { lft, rgt }] of bounds.entries()) {
                await connection.query(
                    `UPDATE categories SET lft = ?, rgt = ? WHERE id = ?`,
                    [lft, rgt, id]
                );
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        return { updated: bounds.size };
    }
}

module.exports = new ProductRepository();