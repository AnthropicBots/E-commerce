// backend/validators/index.js
const BaseValidator = require('./baseValidator');
const OrderValidator = require('./orderValidator');
const ProductValidator = require('./productValidator');
const UserValidator = require('./userValidator');
const CouponValidator = require('./couponValidator');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Check whether a string is a valid canonical 36-character UUID.
 * @param {string} uuid
 * @returns {boolean}
 */
function isValidUUID(uuid) {
    if (typeof uuid !== 'string') {
        return false;
    }
    return UUID_REGEX.test(uuid);
}

/**
 * Validator for UUID parameters (such as /orders/:orderId).
 * @param {string} uuid
 * @returns {{ success: boolean, message?: string }}
 */
function validateUUID(uuid) {
    if (!isValidUUID(uuid)) {
        return { success: false, message: 'Invalid UUID' };
    }
    return { success: true };
}

function validateOrderId(orderId) {
    return validateUUID(orderId);
}

function validateUserId(userId) {
    return validateUUID(userId);
}

function validateProductId(productId) {
    return validateUUID(productId);
}

module.exports = {
    isValidUUID,
    validateUUID,
    validateOrderId,
    validateUserId,
    validateProductId,
    BaseValidator,
    OrderValidator,
    ProductValidator,
    UserValidator,
    CouponValidator,
    
    // Convenience exports
    orderValidator: OrderValidator,
    productValidator: ProductValidator,
    userValidator: UserValidator,
    couponValidator: CouponValidator
};