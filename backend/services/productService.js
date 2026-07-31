// backend/services/productService.js
const { productRepo } = require('../repositories');
const Redis = require('ioredis');

const CATEGORY_TREE_CACHE_PREFIX = 'category:tree:';
const CATEGORY_TREE_TTL = parseInt(process.env.CATEGORY_TREE_CACHE_TTL, 10) || 1800;
const DEFAULT_MAX_DEPTH = parseInt(process.env.CATEGORY_TREE_MAX_DEPTH, 10) || 5;

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: false
});

let redisReady = false;
redis.connect().then(() => {
    redisReady = true;
}).catch(() => {
    redisReady = false;
});
redis.on('ready', () => { redisReady = true; });
redis.on('error', () => { redisReady = false; });

function categoryTreeCacheKey({ rootId = null, maxDepth = DEFAULT_MAX_DEPTH } = {}) {
    return `${CATEGORY_TREE_CACHE_PREFIX}v1:root:${rootId == null ? 'all' : rootId}:depth:${maxDepth}`;
}

class ProductService {
    /**
     * Get product by ID
     */
    async getProduct(id) {
        return productRepo.findWithReviews(id);
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

    /**
     * Multi-tier category navigation tree via single recursive CTE + Redis cache (#1264).
     */
    async getCategoryTree(options = {}) {
        const maxDepth = Math.min(
            Math.max(parseInt(options.maxDepth, 10) || DEFAULT_MAX_DEPTH, 1),
            20
        );
        const rootId = options.rootId != null && options.rootId !== ''
            ? Number(options.rootId)
            : null;

        const cacheKey = categoryTreeCacheKey({ rootId, maxDepth });

        if (redisReady) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    return {
                        tree: JSON.parse(cached),
                        cached: true,
                        maxDepth,
                        rootId
                    };
                }
            } catch (err) {
                console.warn('Category tree Redis get failed:', err.message);
            }
        }

        const tree = await productRepo.getCategoryTreeOptimized({ rootId, maxDepth });

        if (redisReady) {
            try {
                await redis.setex(cacheKey, CATEGORY_TREE_TTL, JSON.stringify(tree));
            } catch (err) {
                console.warn('Category tree Redis set failed:', err.message);
            }
        }

        return {
            tree,
            cached: false,
            maxDepth,
            rootId
        };
    }

    /**
     * Invalidate all cached category trees (call on category CRUD).
     */
    async invalidateCategoryTreeCache() {
        if (!redisReady) {
            return { success: true, cleared: 0, redis: false };
        }

        try {
            const keys = await redis.keys(`${CATEGORY_TREE_CACHE_PREFIX}*`);
            if (keys.length > 0) {
                await redis.del(...keys);
            }
            return { success: true, cleared: keys.length, redis: true };
        } catch (err) {
            console.warn('Category tree cache invalidation failed:', err.message);
            return { success: false, cleared: 0, error: err.message };
        }
    }

    /**
     * After category create/update/delete: bust Redis cache and optionally refresh MPTT.
     */
    async onCategoryMutation({ rebuildMptt = false } = {}) {
        const invalidation = await this.invalidateCategoryTreeCache();
        let mptt = null;
        if (rebuildMptt) {
            try {
                mptt = await productRepo.rebuildCategoryMptt();
            } catch (err) {
                console.warn('MPTT rebuild skipped/failed:', err.message);
            }
        }
        return { invalidation, mptt };
    }
}

module.exports = new ProductService();
