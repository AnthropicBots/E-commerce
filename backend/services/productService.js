// backend/services/productService.js
// Issue #1262: Stampede-protected product cache lookups
const { productRepo } = require('../repositories');
const {
    cacheService,
    CACHE_TARGETS,
    CACHE_CONFIG
} = require('./cacheService');

class ProductService {
    /**
     * Get product by ID (Redis/XFetch + Singleflight protected)
     */
    async getProduct(id) {
        const cacheKey = `id:${id}`;

        return cacheService.rememberWithStampedeProtection(
            cacheKey,
            () => productRepo.findWithReviews(id),
            {
                target: CACHE_TARGETS.PRODUCT,
                ttl: CACHE_CONFIG.productTTL,
                tags: [`product:${id}`]
            }
        );
    }

    /**
     * Get products with filtering (list cache + stampede protection)
     */
    async getProducts(filters = {}, options = {}) {
        const { category, minPrice, maxPrice, search } = filters;
        const { page = 1, limit = 20 } = options;
        const listKey = cacheService.buildProductListKey(filters, { page, limit });

        return cacheService.rememberWithStampedeProtection(
            listKey,
            async () => {
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
            },
            {
                target: CACHE_TARGETS.PRODUCT,
                ttl: Math.min(CACHE_CONFIG.productTTL, 120),
                tags: ['product:list', category ? `category:${category}` : 'product:all']
            }
        );
    }

    /**
     * Create product and invalidate related caches
     */
    async createProduct(data) {
        const created = await productRepo.create(data);
        await this.invalidateProductCaches(created?.id);
        return created;
    }

    /**
     * Update product and invalidate related caches
     */
    async updateProduct(id, data) {
        const updated = await productRepo.update(id, data);
        await this.invalidateProductCaches(id);
        return updated;
    }

    /**
     * Delete product and invalidate related caches
     */
    async deleteProduct(id) {
        const deleted = await productRepo.delete(id);
        await this.invalidateProductCaches(id);
        return deleted;
    }

    /**
     * Update stock
     */
    async updateStock(id, quantity) {
        const result = await productRepo.updateStock(id, quantity);
        await this.invalidateProductCaches(id);
        return result;
    }

    /**
     * Get related products (stampede protected)
     */
    async getRelatedProducts(id, limit = 5) {
        const cacheKey = `related:${id}:${limit}`;

        return cacheService.rememberWithStampedeProtection(
            cacheKey,
            () => productRepo.getRelatedProducts(id, limit),
            {
                target: CACHE_TARGETS.PRODUCT,
                ttl: CACHE_CONFIG.productTTL,
                tags: [`product:${id}`, 'product:related']
            }
        );
    }

    /**
     * Get low stock products
     */
    async getLowStock(threshold = 10) {
        return productRepo.getLowStockProducts(threshold);
    }

    /**
     * Drop single-product + list caches after mutations.
     */
    async invalidateProductCaches(productId) {
        if (productId != null) {
            await cacheService.delete(`id:${productId}`, CACHE_TARGETS.PRODUCT);
            await cacheService.invalidateByTag(`product:${productId}`);
        }
        await cacheService.invalidateByTag('product:list');
        await cacheService.invalidateByTag('product:all');
    }

    /**
     * Expose cache stats for ops / debugging.
     */
    getCacheStats() {
        return cacheService.getStats();
    }
}

module.exports = new ProductService();
