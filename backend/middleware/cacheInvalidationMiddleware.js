// backend/middleware/cacheInvalidationMiddleware.js
const { cacheInvalidation, INVALIDATION_STRATEGIES } = require('../services/cacheInvalidationService');

/**
 * Middleware to invalidate cache on write operations
 */
function invalidateCacheOnWrite(keyGenerator, strategy = INVALIDATION_STRATEGIES.DEPENDENCY_BASED) {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const key = typeof keyGenerator === 'function' 
                    ? keyGenerator(req, data) 
                    : keyGenerator;

                if (key) {
                    cacheInvalidation.invalidate(key, {
                        reason: 'write_operation',
                        strategy
                    });
                }
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Middleware to invalidate product cache
 */
function invalidateProductCache() {
    return invalidateCacheOnWrite(
        (req, data) => {
            const productId = req.params.id || data?.data?.id;
            return productId ? `product:${productId}` : null;
        },
        INVALIDATION_STRATEGIES.PRODUCT_UPDATE
    );
}

/**
 * Middleware to invalidate category cache
 */
function invalidateCategoryCache() {
    return invalidateCacheOnWrite(
        (req, data) => {
            const categoryId = req.params.id || data?.data?.id;
            return categoryId ? `category:${categoryId}` : null;
        },
        INVALIDATION_STRATEGIES.CATEGORY_INVALIDATION
    );
}

/**
 * Middleware to invalidate user cache
 */
function invalidateUserCache() {
    return invalidateCacheOnWrite(
        (req, data) => {
            const userId = req.params.id || req.user?.id || data?.data?.userId;
            return userId ? `user:${userId}` : null;
        },
        INVALIDATION_STRATEGIES.USER_SPECIFIC
    );
}

module.exports = {
    invalidateCacheOnWrite,
    invalidateProductCache,
    invalidateCategoryCache,
    invalidateUserCache
};