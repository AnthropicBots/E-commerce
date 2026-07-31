// backend/middleware/auditMiddleware.js
const { auditService, AUDIT_ACTIONS } = require('../services/auditService');

/**
 * Middleware to audit product actions
 */
function auditProductAction(action) {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const productId = req.params.id || req.body.id || data?.data?.id;
                const changes = {
                    previous: req.body._previousState || null,
                    updated: req.body || null,
                    productName: req.body.name,
                    category: req.body.category
                };

                auditService.logProductAction(action, productId, {
                    id: req.user?.id,
                    name: req.user?.name || req.user?.email,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                }, changes);
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Middleware to audit order actions
 */
function auditOrderAction(action) {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const orderId = req.params.id || data?.data?.id;
                const changes = {
                    previous: req.body._previousState || null,
                    updated: req.body || null,
                    total: req.body.total,
                    status: req.body.status
                };

                auditService.logOrderAction(action, orderId, {
                    id: req.user?.id,
                    name: req.user?.name || req.user?.email,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                }, changes);
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Middleware to audit user actions
 */
function auditUserAction(action) {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const userId = req.params.id || data?.data?.id;
                const changes = {
                    previous: req.body._previousState || null,
                    updated: req.body || null,
                    email: req.body.email,
                    role: req.body.role
                };

                auditService.logUserAction(action, userId, {
                    id: req.user?.id,
                    name: req.user?.name || req.user?.email,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                }, changes);
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Middleware to audit admin actions
 */
function auditAdminAction(action) {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                auditService.logAdminAction(action, {
                    id: req.user?.id,
                    name: req.user?.name || req.user?.email,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                }, {
                    path: req.path,
                    method: req.method,
                    body: req.body,
                    query: req.query
                });
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Middleware to audit coupon actions
 */
function auditCouponAction(action) {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const couponId = req.params.id || data?.data?.id;
                const changes = {
                    previous: req.body._previousState || null,
                    updated: req.body || null,
                    code: req.body.code,
                    discount: req.body.discount
                };

                auditService.logCouponAction(action, couponId, {
                    id: req.user?.id,
                    name: req.user?.name || req.user?.email,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                }, changes);
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Middleware to audit inventory actions
 */
function auditInventoryAction(action) {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const productId = req.params.id || data?.data?.id;
                const changes = {
                    previous: req.body._previousState || null,
                    updated: req.body || null,
                    productName: req.body.name,
                    quantityChanged: req.body.quantity
                };

                auditService.logInventoryAction(action, productId, {
                    id: req.user?.id,
                    name: req.user?.name || req.user?.email,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                }, changes);
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

module.exports = {
    auditProductAction,
    auditOrderAction,
    auditUserAction,
    auditAdminAction,
    auditCouponAction,
    auditInventoryAction
};