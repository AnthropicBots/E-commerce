// backend/tests/setupEnv.js

// Loaded by Jest before every suite. Auth, database and payment modules all
// validate their configuration when imported, so without these each suite would
// have to declare the same values before its first `require` -- which is how
// several suites ended up setting JWT_SECRET to a different placeholder each.
//
// Every assignment is `||`-guarded so a developer (or CI) can override any of
// them from the real environment without editing this file.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_characters_long';

process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_at_least_32_characters_long';

// --- Database -------------------------------------------------------------
//
// `config/db.js` validates these at require time. No suite talks to a real
// MySQL -- every one of them mocks `config/db` -- but the mock is installed by
// `jest.mock()`, which only runs once the module has been resolved, so the
// validation still fires for any suite that reaches the module through a
// transitive require (e.g. routes/loyaltyRoutes -> middleware/rbacMiddleware ->
// config/db). Placeholders are enough; the pool is never connected because
// `initializeDatabase()` is skipped when NODE_ENV === 'test'.
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '3306';
process.env.DB_USER = process.env.DB_USER || 'test_user';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test_password';
process.env.DB_NAME = process.env.DB_NAME || 'test_ecommerce';

// --- Payments -------------------------------------------------------------
//
// `services/payment.service.js` resolves Stripe lazily and throws when the key
// is absent (#1289). `createPaymentIntent()` catches that throw and returns
// `{ success: false }` without ever reaching the SDK, so tests/currency.test.js
// asserted against a Stripe mock that was never called. The key below is a
// syntactically valid test key; the SDK itself is mocked, so nothing is sent.
process.env.STRIPE_SECRET_KEY =
    process.env.STRIPE_SECRET_KEY || 'sk_test_00000000000000000000000000';
