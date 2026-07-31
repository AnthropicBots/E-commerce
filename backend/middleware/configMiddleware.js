// backend/middleware/configMiddleware.js
const { configService } = require('../services/configService');

/**
 * Middleware to inject config into request
 */
function injectConfig(req, res, next) {
    req.config = configService;
    next();
}

/**
 * Middleware to get config value
 */
function getConfig(key, defaultValue = null) {
    return (req, res, next) => {
        req.configValue = configService.get(key, defaultValue);
        next();
    };
}

/**
 * Middleware to check feature flag
 */
function featureEnabled(feature) {
    return (req, res, next) => {
        const features = configService.get('features', {});
        const enabled = features[feature] !== undefined ? features[feature] : false;
        
        if (!enabled) {
            return res.status(403).json({
                success: false,
                error: `Feature "${feature}" is currently disabled`
            });
        }
        
        next();
    };
}

module.exports = {
    injectConfig,
    getConfig,
    featureEnabled
};