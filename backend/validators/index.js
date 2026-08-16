// backend/validators/index.js
const BaseValidator = require('./baseValidator');
const OrderValidator = require('./orderValidator');
const ProductValidator = require('./productValidator');
const UserValidator = require('./userValidator');
const CouponValidator = require('./couponValidator');
const authSchemas = require('./authSchemas');
const orderSchemas = require('./orderSchemas');

module.exports = {
    BaseValidator,
    OrderValidator,
    ProductValidator,
    UserValidator,
    CouponValidator,
    authSchemas,
    orderSchemas,
    
    // Convenience exports
    orderValidator: OrderValidator,
    productValidator: ProductValidator,
    userValidator: UserValidator,
    couponValidator: CouponValidator
};