const {
    isValidUUID,
    validateUUID,
    validateOrderId,
    validateUserId,
    validateProductId,
    BaseValidator,
    OrderValidator
} = require('../validators');

describe('UUID Validator Helper and Route Validators', () => {
    const VALID_UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';
    const VALID_UUID_LETTER = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const VALID_UUID_UPPERCASE = 'F47AC10B-58CC-4372-A567-0E02B2C3D479';

    describe('isValidUUID helper', () => {
        test('returns true for valid canonical 36-char UUIDs', () => {
            expect(isValidUUID(VALID_UUID_V4)).toBe(true);
            expect(isValidUUID(VALID_UUID_LETTER)).toBe(true);
            expect(isValidUUID(VALID_UUID_UPPERCASE)).toBe(true);
        });

        test('returns false for invalid UUID strings', () => {
            expect(isValidUUID('not-a-uuid')).toBe(false);
            expect(isValidUUID('12345')).toBe(false);
            expect(isValidUUID('550e8400-e29b-41d4-a716-44665544000z')).toBe(false); // invalid char z
            expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false); // truncated
            expect(isValidUUID("1' OR '1'='1")).toBe(false); // SQL injection attempt
        });

        test('returns false for non-string values', () => {
            expect(isValidUUID(12345)).toBe(false);
            expect(isValidUUID(null)).toBe(false);
            expect(isValidUUID(undefined)).toBe(false);
            expect(isValidUUID({})).toBe(false);
            expect(isValidUUID([])).toBe(false);
        });
    });

    describe('validateUUID helper', () => {
        test('returns { success: true } for valid UUID', () => {
            expect(validateUUID(VALID_UUID_V4)).toEqual({ success: true });
        });

        test('returns { success: false, message: "Invalid UUID" } for invalid UUID', () => {
            expect(validateUUID('invalid-uuid')).toEqual({
                success: false,
                message: 'Invalid UUID'
            });
            expect(validateUUID(12345)).toEqual({
                success: false,
                message: 'Invalid UUID'
            });
        });
    });

    describe('validateOrderId, validateUserId, validateProductId helpers', () => {
        test('validateOrderId returns success for valid UUID and failure for invalid', () => {
            expect(validateOrderId(VALID_UUID_V4)).toEqual({ success: true });
            expect(validateOrderId('bad-order-id')).toEqual({
                success: false,
                message: 'Invalid UUID'
            });
        });

        test('validateUserId returns success for valid UUID and failure for invalid', () => {
            expect(validateUserId(VALID_UUID_LETTER)).toEqual({ success: true });
            expect(validateUserId('bad-user-id')).toEqual({
                success: false,
                message: 'Invalid UUID'
            });
        });

        test('validateProductId returns success for valid UUID and failure for invalid', () => {
            expect(validateProductId(VALID_UUID_UPPERCASE)).toEqual({ success: true });
            expect(validateProductId('bad-product-id')).toEqual({
                success: false,
                message: 'Invalid UUID'
            });
        });
    });

    describe('BaseValidator uuid method', () => {
        test('adds error when UUID is invalid', () => {
            const validator = new BaseValidator();
            validator.validate({ id: 'invalid-uuid-string' });
            validator.uuid(validator.data.id, 'id');

            expect(validator.isValid()).toBe(false);
            expect(validator.getErrors()[0]).toEqual(expect.objectContaining({
                field: 'id',
                message: 'Invalid UUID'
            }));
        });

        test('passes validation when UUID is valid', () => {
            const validator = new BaseValidator();
            validator.validate({ id: VALID_UUID_V4 });
            validator.uuid(validator.data.id, 'id');

            expect(validator.isValid()).toBe(true);
        });
    });
});
