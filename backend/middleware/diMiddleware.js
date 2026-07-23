// backend/middleware/diMiddleware.js
const { container } = require('../core/diContainer');

/**
 * Middleware to inject services into request
 */
function injectServices(serviceMap) {
    return (req, res, next) => {
        req.services = {};
        
        for (const [key, serviceToken] of Object.entries(serviceMap)) {
            try {
                req.services[key] = container.resolve(serviceToken);
            } catch (error) {
                console.error(`Failed to inject service ${serviceToken}:`, error);
                req.services[key] = null;
            }
        }

        next();
    };
}

/**
 * Middleware to create a new scope for request
 */
function createRequestScope(req, res, next) {
    const scopeId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    req.scopeId = container.enterScope(scopeId);
    
    // Clean up scope after request
    res.on('finish', () => {
        container.exitScope();
    });

    next();
}

/**
 * Middleware to inject specific service
 */
function injectService(serviceToken, propertyName) {
    return (req, res, next) => {
        try {
            req[propertyName || serviceToken] = container.resolve(serviceToken);
        } catch (error) {
            console.error(`Failed to inject ${serviceToken}:`, error);
        }
        next();
    };
}

/**
 * Get service from container
 */
function getService(serviceToken) {
    return container.resolve(serviceToken);
}

module.exports = {
    injectServices,
    createRequestScope,
    injectService,
    getService
};