// backend/middleware/validatorMiddleware.js

/**
 * Middleware to validate request using a validator
 */
function validateWith(validator, method = 'validate') {
    return (req, res, next) => {
        try {
            // Execute validation
            const validatorInstance = validator[method](req.body);
            
            // Check if valid
            if (!validatorInstance.isValid()) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    errors: validatorInstance.getErrors(),
                    warnings: validatorInstance.getWarnings()
                });
            }

            // Attach validated data to request
            req.validatedData = validatorInstance.data;
            
            next();
        } catch (error) {
            console.error('Validation error:', error);
            res.status(500).json({
                success: false,
                error: 'Validation failed'
            });
        }
    };
}

/**
 * Middleware to validate order creation
 */
function validateOrderCreation() {
    const { orderValidator } = require('../validators');
    return validateWith(orderValidator, 'validateCreate');
}

/**
 * Middleware to validate order update
 */
function validateOrderUpdate() {
    const { orderValidator } = require('../validators');
    return validateWith(orderValidator, 'validateUpdate');
}

/**
 * Middleware to validate order cancellation
 */
function validateOrderCancel() {
    const { orderValidator } = require('../validators');
    return validateWith(orderValidator, 'validateCancel');
}

/**
 * Middleware to validate product creation
 */
function validateProductCreation() {
    const { productValidator } = require('../validators');
    return validateWith(productValidator, 'validateCreate');
}

/**
 * Middleware to validate product update
 */
function validateProductUpdate() {
    const { productValidator } = require('../validators');
    return validateWith(productValidator, 'validateUpdate');
}

/**
 * Middleware to validate user registration
 */
function validateUserRegistration() {
    const { userValidator } = require('../validators');
    return validateWith(userValidator, 'validateRegister');
}

/**
 * Middleware to validate user login
 */
function validateUserLogin() {
    const { userValidator } = require('../validators');
    return validateWith(userValidator, 'validateLogin');
}

/**
 * Middleware to validate coupon creation
 */
function validateCouponCreation() {
    const { couponValidator } = require('../validators');
    return validateWith(couponValidator, 'validateCreate');
}

/**
 * Middleware to validate coupon application
 */
function validateCouponApplication() {
    const { couponValidator } = require('../validators');
    return validateWith(couponValidator, 'validateApply');
}

module.exports = {
    validateWith,
    validateOrderCreation,
    validateOrderUpdate,
    validateOrderCancel,
    validateProductCreation,
    validateProductUpdate,
    validateUserRegistration,
    validateUserLogin,
    validateCouponCreation,
    validateCouponApplication
};