// backend/services/productService.js
const { productRepo } = require('../repositories');
const redis = require('../config/redis');
const logger = require('../config/logger');

const CATEGORY_TREE_CACHE_PREFIX = 'catalog:category-tree';
const CATEGORY_TREE_TTL_SECONDS = Number(process.env.CATEGORY_TREE_CACHE_TTL) || 3600;
const DEFAULT_CATEGORY_MAX_DEPTH = 10;

class ProductService {
    /**
     * Get product by ID
     */
    async getProduct(id) {
        return productRepo.findWithReviews(id);
    }

    /**
     * Build Redis cache key for a category-tree variant.
     */
    getCategoryTreeCacheKey({ rootId = null, maxDepth = DEFAULT_CATEGORY_MAX_DEPTH, strategy = 'cte' } = {}) {
        const rootPart = rootId == null ? 'all' : String(rootId);
        return `${CATEGORY_TREE_CACHE_PREFIX}:${strategy}:${rootPart}:d${maxDepth}`;
    }

    /**
     * Read category tree from Redis (returns null on miss / Redis errors).
     */
    async getCachedCategoryTree(cacheKey) {
        try {
            const cached = await redis.get(cacheKey);
            if (!cached) return null;
            return JSON.parse(cached);
        } catch (err) {
            logger.warn('Category tree cache read failed', { error: err.message, cacheKey });
            return null;
        }
    }

    /**
     * Persist category tree JSON in Redis.
     */
    async setCachedCategoryTree(cacheKey, tree) {
        try {
            await redis.setex(cacheKey, CATEGORY_TREE_TTL_SECONDS, JSON.stringify(tree));
        } catch (err) {
            logger.warn('Category tree cache write failed', { error: err.message, cacheKey });
        }
    }

    /**
     * Invalidate all category-tree cache keys after category CRUD.
     */
    async invalidateCategoryTreeCache() {
        try {
            const pattern = `${CATEGORY_TREE_CACHE_PREFIX}:*`;
            let cursor = '0';
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = nextCursor;
                if (keys.length > 0) {
                    await redis.del(...keys);
                }
            } while (cursor !== '0');
            logger.info('Category tree cache invalidated');
        } catch (err) {
            logger.warn('Category tree cache invalidation failed', { error: err.message });
        }
    }

    /**
     * Fetch nested category navigation tree using a single CTE (or MPTT)
     * round-trip, with Redis caching and an in-memory depth limit.
     */
    async getCategoryTree(options = {}) {
        const {
            rootId = null,
            maxDepth = DEFAULT_CATEGORY_MAX_DEPTH,
            strategy = 'cte',
            bypassCache = false
        } = options;

        const normalizedDepth = Math.min(Math.max(Number.parseInt(maxDepth, 10) || DEFAULT_CATEGORY_MAX_DEPTH, 1), 20);
        const cacheKey = this.getCategoryTreeCacheKey({
            rootId,
            maxDepth: normalizedDepth,
            strategy
        });

        if (!bypassCache) {
            const cached = await this.getCachedCategoryTree(cacheKey);
            if (cached) {
                return {
                    tree: cached,
                    meta: {
                        cached: true,
                        strategy,
                        rootId,
                        maxDepth: normalizedDepth,
                        nodeCount: countTreeNodes(cached)
                    }
                };
            }
        }

        const rows = strategy === 'mptt'
            ? await productRepo.fetchCategoryTreeMPTT({ rootId, maxDepth: normalizedDepth })
            : await productRepo.fetchCategoryTreeCTE({ rootId, maxDepth: normalizedDepth });

        const tree = productRepo.buildCategoryTree(rows, {
            rootId,
            maxDepth: normalizedDepth
        });

        await this.setCachedCategoryTree(cacheKey, tree);

        return {
            tree,
            meta: {
                cached: false,
                strategy,
                rootId,
                maxDepth: normalizedDepth,
                nodeCount: countTreeNodes(tree),
                rowCount: rows.length
            }
        };
    }

    /**
     * Get products with filtering
     */
    async getProducts(filters = {}, options = {}) {
        const { category, minPrice, maxPrice, search } = filters;
        const { page = 1, limit = 20 } = options;

        let products;
        let total;

        if (search) {
            products = await productRepo.search(search, options);
            total = await productRepo.count({
                ...(category && { category }),
                ...(minPrice && { price: { $gte: minPrice } }),
                ...(maxPrice && { price: { $lte: maxPrice } })
            });
        } else if (category) {
            products = await productRepo.findByCategory(category, options);
            total = await productRepo.count({ category, stock: { $gt: 0 } });
        } else if (minPrice !== undefined || maxPrice !== undefined) {
            products = await productRepo.findByPriceRange(
                minPrice || 0,
                maxPrice || 999999,
                options
            );
            total = await productRepo.count({
                price: {
                    $gte: minPrice || 0,
                    $lte: maxPrice || 999999
                },
                stock: { $gt: 0 }
            });
        } else {
            products = await productRepo.findAll({ stock: { $gt: 0 } }, options);
            total = await productRepo.count({ stock: { $gt: 0 } });
        }

        return {
            products,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Create product
     */
    async createProduct(data) {
        return productRepo.create(data);
    }

    /**
     * Update product
     */
    async updateProduct(id, data) {
        return productRepo.update(id, data);
    }

    /**
     * Delete product
     */
    async deleteProduct(id) {
        return productRepo.delete(id);
    }

    /**
     * Update stock
     */
    async updateStock(id, quantity) {
        return productRepo.updateStock(id, quantity);
    }

    /**
     * Get related products
     */
    async getRelatedProducts(id, limit = 5) {
        return productRepo.getRelatedProducts(id, limit);
    }

    /**
     * Get low stock products
     */
    async getLowStock(threshold = 10) {
        return productRepo.getLowStockProducts(threshold);
    }
}

function countTreeNodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return 0;
    let count = 0;
    for (const node of nodes) {
        count += 1;
        if (node.children && node.children.length) {
            count += countTreeNodes(node.children);
        }
    }
    return count;
}

module.exports = new ProductService();