// backend/repositories/productRepository.js
const BaseRepository = require('./baseRepository');

// The rows a catalogue read is allowed to see.
//
// `deleted_at` is what the `softDeleteColumn` declared below is for, and until
// #1565 not one read in this file filtered on it. Withdrawing a product stamps
// the column, and every method here read straight past the stamp -- so a
// product an admin removed still came back from search, featured, low-stock,
// related and by-id lookups alike. That is the other half of #1457: the write
// path stopped cascading, and the read path never noticed.
//
// Named once so that a read added later cannot quietly omit it.
const LIVE = 'deleted_at IS NULL';

/** The same predicate, where the table carries an alias. */
const liveOn = (alias) => `${alias}.deleted_at IS NULL`;

/**
 * Escape the characters that are metacharacters *inside* a LIKE pattern.
 *
 * Parameterising the term stops injection but not this: `%` and `_` keep their
 * wildcard meaning once the driver has substituted the value, so searching the
 * catalogue for "50%" matched every product rather than the discounted ones,
 * and "_" matched any single character. The backslash goes first, or it would
 * escape the escapes added after it.
 *
 * Paired with an explicit `ESCAPE '\\'` at the call site, because MySQL's
 * default escape character depends on `NO_BACKSLASH_ESCAPES` being off.
 *
 * @param {any} value the raw search term
 * @returns {string}
 */
const escapeLike = (value) =>
    String(value ?? '').replace(/[\\%_]/g, (character) => `\\${character}`);

class ProductRepository extends BaseRepository {
    constructor() {
        // `products.deleted_at` is filtered by every read path in the codebase
        // and was set by nothing, because the only statement that would ever
        // have set it was a hard `DELETE` (#1457). Declaring it here means
        // `productService.deleteProduct()` cannot reintroduce that cascade
        // through the repository while the controller is being careful.
        super('products', 'id', { softDeleteColumn: 'deleted_at' });
    }

    /**
     * Find products by category.
     *
     * The column is `category_id INT` (`0001_baseline_schema.sql:163`). There
     * is no `products.category`, so the previous `WHERE category = ?` failed
     * outright with `ER_BAD_FIELD_ERROR` rather than returning the wrong rows
     * (#1565).
     *
     * @param {number} categoryId
     * @param {{limit?: number, offset?: number}} [options]
     * @returns {Promise<object[]>}
     */
    async findByCategory(categoryId, options = {}) {
        const { limit = 20, offset = 0 } = options;

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName}
             WHERE category_id = ? AND stock > 0 AND ${LIVE}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [categoryId, limit, offset]
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
             WHERE price BETWEEN ? AND ? AND stock > 0 AND ${LIVE}
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
        const term = `%${escapeLike(query)}%`;

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName}
             WHERE (name LIKE ? ESCAPE '\\\\' OR description LIKE ? ESCAPE '\\\\')
               AND stock > 0 AND ${LIVE}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [term, term, limit, offset]
        );

        return rows;
    }

    /**
     * Get products with low stock
     */
    async getLowStockProducts(threshold = 10) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName}
             WHERE stock <= ? AND stock > 0 AND ${LIVE}
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
     * Get product with reviews.
     *
     * The aggregate counts only reviews a shopper is allowed to see. `reviews`
     * carries both `deleted_at` and `is_approved` (`0001_baseline_schema.sql:
     * 824-838`) and the previous version consulted neither, so withdrawn and
     * unapproved reviews inflated `review_count` and skewed `avg_rating` --
     * which is the rating shown against the product.
     *
     * The predicates sit in the JOIN rather than the WHERE because the join is
     * a LEFT one: moving them out would turn it into an inner join and drop the
     * product entirely as soon as it had no visible reviews.
     *
     * @param {string} id product UUID
     * @returns {Promise<object|null>}
     */
    async findWithReviews(id) {
        const [rows] = await this.db.query(
            `SELECT p.*,
                    AVG(r.rating) as avg_rating,
                    COUNT(r.id) as review_count
             FROM ${this.tableName} p
             LEFT JOIN reviews r
                    ON p.id = r.product_id
                   AND ${liveOn('r')}
                   AND r.is_approved = 1
             WHERE p.id = ? AND ${liveOn('p')}
             GROUP BY p.id`,
            [id]
        );

        if (rows.length === 0) {
            return null;
        }

        // Get reviews
        const [reviews] = await this.db.query(
            `SELECT * FROM reviews
              WHERE product_id = ? AND ${LIVE} AND is_approved = 1
              ORDER BY created_at DESC
              LIMIT 10`,
            [id]
        );

        return {
            ...rows[0],
            reviews
        };
    }

    /**
     * Get related products.
     *
     * Related by `category_id`, read off the product this method just loaded.
     * It previously matched `WHERE category = ?` against `product.category`,
     * and since neither the column nor the property exists that was a
     * `ER_BAD_FIELD_ERROR` with `undefined` as its parameter (#1565).
     *
     * A product filed under no category has nothing to be related to, so it
     * returns nothing rather than matching every other uncategorised product
     * via `category_id = NULL`.
     *
     * @param {string} id
     * @param {number} [limit=5]
     * @returns {Promise<object[]>}
     */
    async getRelatedProducts(id, limit = 5) {
        const product = await this.findById(id);
        if (!product) return [];

        if (product.category_id === null || product.category_id === undefined) {
            return [];
        }

        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName}
             WHERE category_id = ? AND id != ? AND stock > 0 AND ${LIVE}
             ORDER BY created_at DESC
             LIMIT ?`,
            [product.category_id, id, limit]
        );

        return rows;
    }

    /**
     * Increment view count.
     *
     * The counter is `views_count INT DEFAULT 0` (`0001_baseline_schema.sql:
     * 180`). There is no `products.views`, so this threw `ER_BAD_FIELD_ERROR`
     * on every product page view (#1565).
     *
     * @param {string} id
     */
    async incrementViews(id) {
        await this.db.query(
            `UPDATE ${this.tableName}
                SET views_count = views_count + 1
              WHERE id = ? AND ${LIVE}`,
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
            `SELECT * FROM ${this.tableName}
              WHERE id IN (${placeholders}) AND ${LIVE}`,
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
             WHERE featured = 1 AND stock > 0 AND ${LIVE}
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