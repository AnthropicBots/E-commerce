// backend/tests/setupEnv.js

// Loaded by Jest before every suite. Auth modules validate their configuration
// when imported, so without these each suite would have to declare the same
// secrets before its first `require` -- which is how several suites ended up
// setting JWT_SECRET to a different placeholder each.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_characters_long';

process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_at_least_32_characters_long';
