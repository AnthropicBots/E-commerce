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

        if (data.maxDiscount !== undefined && data.maxDiscount !== null) {
            this.positive(data.maxDiscount, 'maxDiscount');
        }

        if (data.minOrderAmount !== undefined && data.minOrderAmount !== null) {
            this.nonNegative(data.minOrderAmount, 'minOrderAmount');
        }

        if (data.startDate !== undefined && data.startDate !== null) {
            this.date(data.startDate, 'startDate');
        }

        if (data.endDate !== undefined && data.endDate !== null) {
            this.date(data.endDate, 'endDate');
            this.futureDate(data.endDate, 'endDate');
        }

        if (data.startDate && data.endDate) {
            this.dateAfter(data.endDate, 'endDate', data.startDate, 'startDate');
        }

        if (data.usageLimit !== undefined && data.usageLimit !== null) {
            this.positive(data.usageLimit, 'usageLimit');
            this.integer(data.usageLimit, 'usageLimit');
        }

        if (data.usageLimitPerUser !== undefined && data.usageLimitPerUser !== null) {
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

        if (data.code !== undefined && data.code !== null) {
            this.pattern(data.code, 'code', /^[A-Z0-9-]+$/);
            this.minLength(data.code, 'code', 3);
            this.maxLength(data.code, 'code', 20);
        }

        if (data.discountType !== undefined && data.discountType !== null) {
            this.enum(data.discountType, 'discountType', ['percentage', 'fixed']);
        }

        if (data.discountValue !== undefined && data.discountValue !== null) {
            this.positive(data.discountValue, 'discountValue');
        }

        if (data.discountType === 'percentage') {
            this.range(data.discountValue, 'discountValue', 0, 100);
        }

        if (data.maxDiscount !== undefined && data.maxDiscount !== null) {
            this.positive(data.maxDiscount, 'maxDiscount');
        }

        if (data.minOrderAmount !== undefined && data.minOrderAmount !== null) {
            this.nonNegative(data.minOrderAmount, 'minOrderAmount');
        }

        if (data.usageLimit !== undefined && data.usageLimit !== null) {
            this.positive(data.usageLimit, 'usageLimit');
            this.integer(data.usageLimit, 'usageLimit');
        }

        if (data.usageLimitPerUser !== undefined && data.usageLimitPerUser !== null) {
            this.positive(data.usageLimitPerUser, 'usageLimitPerUser');
            this.integer(data.usageLimitPerUser, 'usageLimitPerUser');
        }

        if (data.startDate !== undefined && data.startDate !== null) {
            this.date(data.startDate, 'startDate');
        }

        if (data.endDate !== undefined && data.endDate !== null) {
            this.date(data.endDate, 'endDate');
            this.futureDate(data.endDate, 'endDate');
        }

        if (data.startDate && data.endDate) {
            this.dateAfter(data.endDate, 'endDate', data.startDate, 'startDate');
        }

        return this;
    }
}

module.exports = new CouponValidator();