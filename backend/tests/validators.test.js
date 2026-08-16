// backend/tests/validators.test.js
const authSchemas = require('../validators/authSchemas');
const orderSchemas = require('../validators/orderSchemas');
const validate = require('../middleware/validate');

describe('authSchemas', () => {
    describe('login schema', () => {
        test('validates correct email and password', () => {
            const result = authSchemas.login.validate({
                email: 'user@example.com',
                password: 'secretPassword123'
            });
            expect(result.error).toBeUndefined();
        });

        test('fails when email is missing', () => {
            const result = authSchemas.login.validate({
                password: 'secretPassword123'
            });
            expect(result.error).toBeDefined();
            expect(result.error.details[0].message).toMatch(/email/i);
        });

        test('fails when email is invalid format', () => {
            const result = authSchemas.login.validate({
                email: 'not-an-email',
                password: 'secretPassword123'
            });
            expect(result.error).toBeDefined();
        });

        test('fails when password is missing', () => {
            const result = authSchemas.login.validate({
                email: 'user@example.com'
            });
            expect(result.error).toBeDefined();
            expect(result.error.details[0].message).toMatch(/password/i);
        });
    });

    describe('signup schema', () => {
        test('validates correct signup payload', () => {
            const result = authSchemas.signup.validate({
                name: 'Jane Doe',
                email: 'jane@example.com',
                password: 'password123',
                age: 25
            });
            expect(result.error).toBeUndefined();
        });

        test('fails when name is less than 2 characters', () => {
            const result = authSchemas.signup.validate({
                name: 'J',
                email: 'jane@example.com',
                password: 'password123'
            });
            expect(result.error).toBeDefined();
        });

        test('fails when age is under 18', () => {
            const result = authSchemas.signup.validate({
                name: 'Jane Doe',
                email: 'jane@example.com',
                password: 'password123',
                age: 16
            });
            expect(result.error).toBeDefined();
        });
    });

    describe('forgotPassword schema', () => {
        test('validates correct email', () => {
            const result = authSchemas.forgotPassword.validate({
                email: 'user@example.com'
            });
            expect(result.error).toBeUndefined();
        });

        test('fails for invalid email', () => {
            const result = authSchemas.forgotPassword.validate({
                email: 'bad-email'
            });
            expect(result.error).toBeDefined();
        });
    });

    describe('resetPassword schema', () => {
        test('validates correct reset password payload', () => {
            const result = authSchemas.resetPassword.validate({
                userId: 123,
                otp: '123456',
                newPassword: 'newPassword123'
            });
            expect(result.error).toBeUndefined();
        });

        test('fails when OTP is not 6 digits', () => {
            const result = authSchemas.resetPassword.validate({
                userId: 123,
                otp: '123',
                newPassword: 'newPassword123'
            });
            expect(result.error).toBeDefined();
        });
    });
});

describe('orderSchemas', () => {
    describe('createOrder schema', () => {
        test('validates valid createOrder payload', () => {
            const result = orderSchemas.createOrder.validate({
                items: [
                    { productId: 'prod-1', quantity: 2, price: 29.99 }
                ],
                shippingAddress: {
                    street: '123 Main St',
                    city: 'Metropolis'
                },
                paymentMethod: 'credit_card'
            });
            expect(result.error).toBeUndefined();
        });

        test('fails when items list is empty', () => {
            const result = orderSchemas.createOrder.validate({
                items: []
            });
            expect(result.error).toBeDefined();
        });

        test('fails when item quantity is zero or negative', () => {
            const result = orderSchemas.createOrder.validate({
                items: [
                    { productId: 'prod-1', quantity: 0 }
                ]
            });
            expect(result.error).toBeDefined();
        });
    });
});

describe('generic validate middleware', () => {
    test('calls next() for valid payload', () => {
        const req = { body: { email: 'user@example.com', password: 'password123' } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        const middleware = validate(authSchemas.login);
        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('returns 400 response for invalid payload', () => {
        const req = { body: { email: 'invalid-email' } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        const middleware = validate(authSchemas.login);
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false
        }));
        expect(next).not.toHaveBeenCalled();
    });
});
