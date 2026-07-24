// backend/middleware/outboxMiddleware.js
const { outboxService, EVENT_TYPES } = require('../services/outboxService');

/**
 * Middleware to store events in outbox
 */
function outboxMiddleware(eventType, dataExtractor = null) {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const eventData = dataExtractor ? dataExtractor(req, data) : { ...req.body, result: data };
                
                // Store event in outbox
                outboxService.storeEvent(eventType, eventData, {
                    userId: req.user?.id,
                    path: req.path,
                    method: req.method,
                    ip: req.ip
                });
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Middleware to store order events
 */
function outboxOrderEvent(eventType) {
    return outboxMiddleware(eventType, (req, data) => ({
        orderId: req.params.id || data?.data?.id,
        userId: req.user?.id,
        items: req.body.items || [],
        total: req.body.total || 0,
        status: req.body.status || data?.data?.status,
        result: data
    }));
}

/**
 * Middleware to store payment events
 */
function outboxPaymentEvent(eventType) {
    return outboxMiddleware(eventType, (req, data) => ({
        paymentId: req.params.id || data?.data?.id,
        orderId: req.body.orderId,
        userId: req.user?.id,
        amount: req.body.amount || 0,
        status: req.body.status || data?.data?.status,
        result: data
    }));
}

/**
 * Middleware to store product events
 */
function outboxProductEvent(eventType) {
    return outboxMiddleware(eventType, (req, data) => ({
        productId: req.params.id || data?.data?.id,
        userId: req.user?.id,
        name: req.body.name,
        price: req.body.price,
        stock: req.body.stock,
        result: data
    }));
}

/**
 * Middleware to store user events
 */
function outboxUserEvent(eventType) {
    return outboxMiddleware(eventType, (req, data) => ({
        userId: req.params.id || data?.data?.id,
        email: req.body.email,
        role: req.body.role,
        result: data
    }));
}

module.exports = {
    outboxMiddleware,
    outboxOrderEvent,
    outboxPaymentEvent,
    outboxProductEvent,
    outboxUserEvent
};