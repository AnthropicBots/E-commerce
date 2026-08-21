const { couponValidator, BaseValidator } = require('../validators');

describe('CouponValidator Validation Tests', () => {
    const futureDate1 = new Date(Date.now() + 86400000).toISOString(); // 1 day in future
    const futureDate2 = new Date(Date.now() + 172800000).toISOString(); // 2 days in future

    describe('validateCreate', () => {
        test('passes validation when percentage discount is between 0 and 100', () => {
            const validData = {
                code: 'SUMMER2026',
                discountType: 'percentage',
                discountValue: 20,
                startDate: futureDate1,
                endDate: futureDate2
            };

            const result = couponValidator.validateCreate(validData);
            expect(result.isValid()).toBe(true);
            expect(result.getErrors()).toHaveLength(0);
        });

        test('fails validation when percentage discount is > 100', () => {
            const invalidData = {
                code: 'SUMMER2026',
                discountType: 'percentage',
                discountValue: 150,
                startDate: futureDate1,
                endDate: futureDate2
            };

            const result = couponValidator.validateCreate(invalidData);
            expect(result.isValid()).toBe(false);
            const errors = result.getErrors();
            expect(errors.some(e => e.field === 'discountValue' && e.message.includes('must be between 0 and 100'))).toBe(true);
        });

        test('passes validation when endDate is after startDate', () => {
            const validData = {
                code: 'SUMMER2026',
                discountType: 'percentage',
                discountValue: 20,
                startDate: futureDate1,
                endDate: futureDate2
            };

            const result = couponValidator.validateCreate(validData);
            expect(result.isValid()).toBe(true);
        });

        test('fails validation when endDate is before startDate', () => {
            const invalidData = {
                code: 'SUMMER2026',
                discountType: 'percentage',
                discountValue: 20,
                startDate: futureDate2,
                endDate: futureDate1
            };

            const result = couponValidator.validateCreate(invalidData);
            expect(result.isValid()).toBe(false);
            const errors = result.getErrors();
            expect(errors.some(e => e.field === 'endDate' && e.message.includes('must be after startDate'))).toBe(true);
        });
    });

    describe('validateUpdate', () => {
        test('passes validation when updating percentage discount within 0-100', () => {
            const validData = {
                discountType: 'percentage',
                discountValue: 50
            };

            const result = couponValidator.validateUpdate(validData);
            expect(result.isValid()).toBe(true);
        });

        test('fails validation when updating percentage discount > 100', () => {
            const invalidData = {
                discountType: 'percentage',
                discountValue: 120
            };

            const result = couponValidator.validateUpdate(invalidData);
            expect(result.isValid()).toBe(false);
            const errors = result.getErrors();
            expect(errors.some(e => e.field === 'discountValue' && e.message.includes('must be between 0 and 100'))).toBe(true);
        });

        test('passes validation when updated endDate is after startDate', () => {
            const validData = {
                startDate: futureDate1,
                endDate: futureDate2
            };

            const result = couponValidator.validateUpdate(validData);
            expect(result.isValid()).toBe(true);
        });

        test('fails validation when updated endDate is before startDate', () => {
            const invalidData = {
                startDate: futureDate2,
                endDate: futureDate1
            };

            const result = couponValidator.validateUpdate(invalidData);
            expect(result.isValid()).toBe(false);
            const errors = result.getErrors();
            expect(errors.some(e => e.field === 'endDate' && e.message.includes('must be after startDate'))).toBe(true);
        });
    });

    describe('BaseValidator dateAfter method', () => {
        test('returns true when value date is after target value date', () => {
            const validator = new BaseValidator();
            const valid = validator.dateAfter(futureDate2, 'endDate', futureDate1, 'startDate');
            expect(valid).toBe(true);
            expect(validator.isValid()).toBe(true);
        });

        test('returns false and adds error when value date is before target value date', () => {
            const validator = new BaseValidator();
            const valid = validator.dateAfter(futureDate1, 'endDate', futureDate2, 'startDate');
            expect(valid).toBe(false);
            expect(validator.isValid()).toBe(false);
            expect(validator.getErrors()[0]).toEqual(expect.objectContaining({
                field: 'endDate',
                message: 'endDate must be after startDate'
            }));
        });
    });
});
