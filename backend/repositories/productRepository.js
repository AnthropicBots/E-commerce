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
     * Legacy N+1 category subtree fetch (one query per node).
     * Kept only for comparison/tests — prefer fetchCategoryTreeCTE().
     */
    async fetchCategorySubtreeNPlusOne(parentId = null, maxDepth = 10, depth = 0) {
        if (depth >= maxDepth) return [];

        const [rows] = await this.db.query(
            `SELECT id, parent_id, name, slug, description, image_url, icon,
                    level, path, is_active, display_order
             FROM categories
             WHERE deleted_at IS NULL
               AND is_active = 1
               AND ${parentId == null ? 'parent_id IS NULL' : 'parent_id = ?'}
             ORDER BY display_order ASC, name ASC`,
            parentId == null ? [] : [parentId]
        );

        const nodes = [];
        for (const row of rows) {
            nodes.push({
                ...row,
                depth,
                children: await this.fetchCategorySubtreeNPlusOne(row.id, maxDepth, depth + 1)
            });
        }
        return nodes;
    }

    /**
     * Fetch a category hierarchy with a single MySQL 8 recursive CTE.
     * Optionally scopes to a root category and enforces a max depth.
     */
    async fetchCategoryTreeCTE({ rootId = null, maxDepth = 10, activeOnly = true } = {}) {
        const depthLimit = Math.min(Math.max(safeDepth(maxDepth), 1), 20);
        const params = [];

        let anchorWhere;
        if (rootId == null) {
            anchorWhere = 'parent_id IS NULL';
        } else {
            anchorWhere = 'id = ?';
            params.push(rootId);
        }

        const activeClause = activeOnly ? 'AND is_active = 1' : '';

        const sql = `
            WITH RECURSIVE category_tree AS (
                SELECT
                    id,
                    parent_id,
                    name,
                    slug,
                    description,
                    image_url,
                    icon,
                    level,
                    path,
                    is_active,
                    display_order,
                    0 AS depth
                FROM categories
                WHERE deleted_at IS NULL
                  ${activeClause}
                  AND ${anchorWhere}

                UNION ALL

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
                    c.is_active,
                    c.display_order,
                    ct.depth + 1
                FROM categories c
                INNER JOIN category_tree ct ON c.parent_id = ct.id
                WHERE c.deleted_at IS NULL
                  ${activeOnly ? 'AND c.is_active = 1' : ''}
                  AND ct.depth < ?
            )
            SELECT *
            FROM category_tree
            ORDER BY depth ASC, display_order ASC, name ASC
        `;

        params.push(depthLimit);
        const [rows] = await this.db.query(sql, params);
        return rows;
    }

    /**
     * Fetch a contiguous MPTT slice when lft/rgt bounds are populated.
     * Falls back to CTE when MPTT columns are missing or unset.
     */
    async fetchCategoryTreeMPTT({ rootId = null, maxDepth = 10 } = {}) {
        try {
            if (rootId == null) {
                const [rows] = await this.db.query(
                    `SELECT id, parent_id, name, slug, description, image_url, icon,
                            level, path, is_active, display_order, lft, rgt
                     FROM categories
                     WHERE deleted_at IS NULL
                       AND is_active = 1
                       AND lft IS NOT NULL
                       AND rgt IS NOT NULL
                     ORDER BY lft ASC`
                );
                if (!rows.length) {
                    return this.fetchCategoryTreeCTE({ rootId, maxDepth });
                }
                return rows.filter((row) => {
                    const depth = row.level != null ? row.level : 0;
                    return depth < maxDepth;
                });
            }

            const [roots] = await this.db.query(
                `SELECT id, parent_id, name, slug, description, image_url, icon,
                        level, path, is_active, display_order, lft, rgt
                 FROM categories
                 WHERE id = ? AND deleted_at IS NULL AND lft IS NOT NULL AND rgt IS NOT NULL
                 LIMIT 1`,
                [rootId]
            );

            if (!roots.length) {
                return this.fetchCategoryTreeCTE({ rootId, maxDepth });
            }

            const root = roots[0];
            const [rows] = await this.db.query(
                `SELECT id, parent_id, name, slug, description, image_url, icon,
                        level, path, is_active, display_order, lft, rgt
                 FROM categories
                 WHERE deleted_at IS NULL
                   AND is_active = 1
                   AND lft BETWEEN ? AND ?
                 ORDER BY lft ASC`,
                [root.lft, root.rgt]
            );

            const rootLevel = root.level || 0;
            return rows.filter((row) => (row.level || 0) - rootLevel < maxDepth);
        } catch (err) {
            // MPTT columns may not exist yet on older schemas
            if (err.code === 'ER_BAD_FIELD_ERROR') {
                return this.fetchCategoryTreeCTE({ rootId, maxDepth });
            }
            throw err;
        }
    }

    /**
     * Serialize flat CTE/MPTT rows into a nested JSON tree with depth limits.
     */
    buildCategoryTree(rows, { rootId = null, maxDepth = 10 } = {}) {
        if (!Array.isArray(rows) || rows.length === 0) return [];

        const depthLimit = Math.min(Math.max(safeDepth(maxDepth), 1), 20);
        const byParent = new Map();

        for (const row of rows) {
            const key = row.parent_id == null ? 'root' : String(row.parent_id);
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(row);
        }

        const toNode = (row, depth) => ({
            id: row.id,
            parent_id: row.parent_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            image_url: row.image_url,
            icon: row.icon,
            level: row.level,
            path: row.path,
            is_active: row.is_active,
            display_order: row.display_order,
            depth,
            children: depth + 1 < depthLimit
                ? (byParent.get(String(row.id)) || []).map((child) => toNode(child, depth + 1))
                : []
        });

        if (rootId != null) {
            const root = rows.find((r) => r.id === rootId);
            if (!root) return [];
            return [toNode(root, 0)];
        }

        const rootRows = byParent.get('root') || rows.filter((r) => {
            if (r.parent_id == null) return true;
            return !rows.some((other) => other.id === r.parent_id);
        });

        return rootRows.map((row) => toNode(row, 0));
    }
}

function safeDepth(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 10;
}

module.exports = new ProductRepository();