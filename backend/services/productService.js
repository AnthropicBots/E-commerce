// backend/services/productService.js
const { productRepo } = require('../repositories');
const { cacheService, CACHE_TARGETS } = require('./cacheService');

const CATEGORY_TREE_CACHE_PREFIX = 'category:tree:';
const CATEGORY_TREE_TTL = parseInt(process.env.CATEGORY_TREE_CACHE_TTL, 10) || 1800;
const DEFAULT_MAX_DEPTH = parseInt(process.env.CATEGORY_TREE_MAX_DEPTH, 10) || 5;
const PRODUCT_CACHE_TTL = parseInt(process.env.PRODUCT_CACHE_TTL, 10) || 600;

// Shared client -- see config/redis.js. A per-module `new Redis({ ... })`
// means an extra connection and an extra reconnect loop per module, and
// makes the module impossible to load without a live Redis (#1341).
const redis = require("../config/redis");

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
     * Get product by ID (uncached)
     */
    async getProduct(id) {
        return productRepo.findWithReviews(id);
    }

    /**
     * Stampede-safe product detail fetch (#1262)
     */
    async getProductCached(id) {
        const key = `detail:${id}`;
        return cacheService.getOrCompute(
            key,
            () => productRepo.findWithReviews(id),
            {
                target: CACHE_TARGETS.PRODUCT,
                ttl: PRODUCT_CACHE_TTL,
                tags: [`product:${id}`, 'products']
            }
        );
    }

    /**
     * Get products with filtering (uncached)
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
     * Stampede-safe product list fetch (#1262)
     */
    async getProductsCached(filters = {}, options = {}) {
        const key = `list:${cacheService.hashKey({ filters, options })}`;
        return cacheService.getOrCompute(
            key,
            () => this.getProducts(filters, options),
            {
                target: CACHE_TARGETS.PRODUCT,
                ttl: PRODUCT_CACHE_TTL,
                tags: ['products', 'product-list']
            }
        );
    }

    /**
     * High-traffic controller helper: run product DB work behind XFetch + singleflight
     */
    async withProductCache(cacheKeyParts, fetchFn, options = {}) {
        const key = typeof cacheKeyParts === 'string'
            ? cacheKeyParts
            : cacheService.hashKey(cacheKeyParts);

        return cacheService.getOrCompute(key, fetchFn, {
            target: CACHE_TARGETS.PRODUCT,
            ttl: options.ttl || PRODUCT_CACHE_TTL,
            tags: options.tags || ['products'],
            beta: options.beta
        });
    }

    /**
     * Bust product caches after mutations
     */
    async invalidateProductCaches(productId = null) {
        if (productId) {
            await cacheService.delete(`detail:${productId}`, CACHE_TARGETS.PRODUCT);
            await cacheService.invalidateByTag(`product:${productId}`);
        }
        await cacheService.invalidateByTag('products');
        await cacheService.invalidateByTag('product-list');
        await cacheService.invalidateByTarget(CACHE_TARGETS.PRODUCT);
        return { success: true };
    }

    async createProduct(data) {
        const created = await productRepo.create(data);
        await this.invalidateProductCaches(created?.id);
        return created;
    }

    async updateProduct(id, data) {
        const updated = await productRepo.update(id, data);
        await this.invalidateProductCaches(id);
        return updated;
    }

    async deleteProduct(id) {
        const deleted = await productRepo.delete(id);
        await this.invalidateProductCaches(id);
        return deleted;
    }

    async updateStock(id, quantity) {
        const result = await productRepo.updateStock(id, quantity);
        await this.invalidateProductCaches(id);
        return result;
    }

    async getRelatedProducts(id, limit = 5) {
        return productRepo.getRelatedProducts(id, limit);
    }

    async getLowStock(threshold = 10) {
        return productRepo.getLowStockProducts(threshold);
    }

    /**
     * Multi-tier category navigation tree via CTE + stampede-safe cache
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

        const tree = await cacheService.getOrCompute(
            cacheKey,
            async () => productRepo.getCategoryTreeOptimized({ rootId, maxDepth }),
            {
                target: CACHE_TARGETS.CATEGORY,
                ttl: CATEGORY_TREE_TTL,
                tags: ['categories']
            }
        );

        return {
            tree,
            cached: true,
            maxDepth,
            rootId
        };
    }

    async invalidateCategoryTreeCache() {
        await cacheService.invalidateByTag('categories');
        await cacheService.invalidateByTarget(CACHE_TARGETS.CATEGORY);

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
