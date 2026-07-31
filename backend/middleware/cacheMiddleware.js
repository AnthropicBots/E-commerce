// backend/middleware/cacheMiddleware.js
const { cacheService } = require('../services/cacheService');

/**
 * Cache middleware for GET requests
 */
function cacheMiddleware(target, ttl = null, tags = []) {
    return async (req, res, next) => {
        if (req.method !== 'GET') {
            return next();
        }

        const cacheKey = req.originalUrl || req.url;
        
        try {
            const cached = await cacheService.get(cacheKey, target);
            
            if (cached !== null) {
                return res.json({
                    ...cached,
                    _cached: true,
                    _cacheHit: true
                });
            }

            const originalJson = res.json;

            res.json = function(data) {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    if (!res.get('X-No-Cache')) {
                        cacheService.set(cacheKey, data, {
                            target,
                            ttl,
                            tags: [...tags, `target:${target}`]
                        });
                    }
                }
                return originalJson.call(this, data);
            };

            next();
        } catch (error) {
            console.error('Cache middleware error:', error);
            next();
        }
    };
}

/**
 * Invalidate cache by tag
 */
function invalidateCache(tag) {
    return async (req, res, next) => {
        try {
            await cacheService.invalidateByTag(tag);
            next();
        } catch (error) {
            console.error('Invalidate cache error:', error);
            next();
        }
    };
}

/**
 * Invalidate cache by target
 */
function invalidateTarget(target) {
    return async (req, res, next) => {
        try {
            await cacheService.invalidateByTarget(target);
            next();
        } catch (error) {
            console.error('Invalidate target error:', error);
            next();
        }
    };
}

module.exports = {
    cacheMiddleware,
    invalidateCache,
    invalidateTarget
};