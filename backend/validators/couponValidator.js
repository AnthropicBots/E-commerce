// backend/validators/couponValidator.js
const BaseValidator = require('./baseValidator');

class CouponValidator extends BaseValidator {
    /**
     * Validate coupon creation
     */
    validateCreate(data) {
        this.validate(data);

        this.required(data.code, 'code');
        this.pattern(data.code, 'code', /^[A-Z0-9-]+$/);
        this.minLength(data.code, 'code', 3);
        this.maxLength(data.code, 'code', 20);

        this.required(data.discountType, 'discountType');
        this.enum(data.discountType, 'discountType', ['percentage', 'fixed']);

        this.required(data.discountValue, 'discountValue');
        this.positive(data.discountValue, 'discountValue');

        if (data.discountType === 'percentage') {
            this.range(data.discountValue, 'discountValue', 0, 100);
        }

        if (data.maxDiscount) {
            this.positive(data.maxDiscount, 'maxDiscount');
        }

        if (data.minOrderAmount) {
            this.nonNegative(data.minOrderAmount, 'minOrderAmount');
        }

        if (data.startDate) {
            this.date(data.startDate, 'startDate');
        }

        if (data.endDate) {
            this.date(data.endDate, 'endDate');
            this.futureDate(data.endDate, 'endDate');
        }

        if (data.usageLimit) {
            this.positive(data.usageLimit, 'usageLimit');
            this.integer(data.usageLimit, 'usageLimit');
        }

        if (data.usageLimitPerUser) {
            this.positive(data.usageLimitPerUser, 'usageLimitPerUser');
            this.integer(data.usageLimitPerUser, 'usageLimitPerUser');
        }

        return this;
    }

    /**
     * Validate coupon application
     */
    validateApply(data) {
        this.validate(data);

        this.required(data.code, 'code');
        this.required(data.orderTotal, 'orderTotal');
        this.positive(data.orderTotal, 'orderTotal');

        return this;
    }

    /**
     * Validate coupon update
     */
    validateUpdate(data) {
        this.validate(data);

        if (data.code !== undefined) {
            this.pattern(data.code, 'code', /^[A-Z0-9-]+$/);
            this.minLength(data.code, 'code', 3);
            this.maxLength(data.code, 'code', 20);
        }

        if (data.discountType !== undefined) {
            this.enum(data.discountType, 'discountType', ['percentage', 'fixed']);
        }

        if (data.discountValue !== undefined) {
            this.positive(data.discountValue, 'discountValue');
        }

        return this;
    }
}

module.exports = new CouponValidator();