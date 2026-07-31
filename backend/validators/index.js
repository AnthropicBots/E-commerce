// backend/validators/index.js
const BaseValidator = require('./baseValidator');
const OrderValidator = require('./orderValidator');
const ProductValidator = require('./productValidator');
const UserValidator = require('./userValidator');
const CouponValidator = require('./couponValidator');

module.exports = {
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