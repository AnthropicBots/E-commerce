//
// scripts/lib/placeholder-env.js
//
// The environment the require-time gates run under.
//
// `config/db.js` and `config/envValidator.js` both validate at require time, so
// a gate that loads application code has to have these set before the first
// `require` or it fails on configuration rather than on the thing it is
// checking. Nothing here reaches a real service: `NODE_ENV=test` makes
// `config/db.js` skip its background connect, and every value below exists only
// to get past a presence check.
//
// It lives in its own module because two gates need the identical set and they
// have to agree. When they were separate copies, a value added to one was a
// value the other tripped over -- which is a gate failing for a reason that has
// nothing to do with the code under test, and the fastest way to teach people
// to ignore it.
//

'use strict';

// Placeholders, not secrets. Each is applied only when the variable is unset,
// so a caller with a real value keeps it.
const PLACEHOLDER_ENV = Object.freeze({
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USER: 'gate_check',
    DB_PASSWORD: 'gate_check',
    DB_NAME: 'gate_check',
    JWT_SECRET: 'gate_check_jwt_secret_at_least_32_characters_long',
    JWT_REFRESH_SECRET: 'gate_check_jwt_refresh_secret_at_least_32_characters',
    PORT: '5099',
    FRONTEND_URL: 'http://localhost:5500',
    STRIPE_SECRET_KEY: 'sk_test_00000000000000000000000000'
});

/**
 * Apply the placeholders to `process.env`, leaving anything already set alone.
 *
 * Must be called before the first `require` of application code.
 *
 * @returns {string[]} The names of the variables this call actually set,
 *   so a caller can report what it had to invent.
 */
function applyPlaceholderEnv() {
    const applied = [];

    for (const [key, value] of Object.entries(PLACEHOLDER_ENV)) {
        if (!process.env[key]) {
            process.env[key] = value;
            applied.push(key);
        }
    }

    return applied;
}

module.exports = {
    PLACEHOLDER_ENV,
    applyPlaceholderEnv
};
