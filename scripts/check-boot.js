#!/usr/bin/env node
//
// scripts/check-boot.js
//
// Boot gate for the backend. Addresses #1341.
//hrows
//     `ReferenceError: Cannot access 'app' before initialization` at require.
//   * `require('@socket.io/redis-adapter')` for a package that was never added
//     to package.json -- parses fine, throws MODULE_NOT_FOUND on a clean
//     `npm ci`.
//   * `require('../services/auditTrialService')` and friends -- a misspelled
//     path is a perfectly valid string literal.
//
// This script requires server.js the way `npm start` does and asserts that what
// comes back is a mounted Express application. It needs no database, no Redis
// and no network: NODE_ENV=test makes config/db.js skip its background connect,
// and every placeholder below exists only to satisfy the require-time
// validation in config/db.js and config/envValidator.js.
//
// Usage:
//   node scripts/check-boot.js
//
// Exit code 0 when the app loads, 1 otherwise.

'use strict';

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(REPO_ROOT, 'backend', 'server.js');

// Placeholders, not secrets: nothing here is used to reach a real service.
// Each is `||`-guarded so a caller that has a real value keeps it.
const PLACEHOLDER_ENV = {
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USER: 'boot_check',
    DB_PASSWORD: 'boot_check',
    DB_NAME: 'boot_check',
    JWT_SECRET: 'boot_check_jwt_secret_at_least_32_characters_long',
    JWT_REFRESH_SECRET: 'boot_check_jwt_refresh_secret_at_least_32_characters',
    PORT: '5099',
    FRONTEND_URL: 'http://localhost:5500',
    STRIPE_SECRET_KEY: 'sk_test_00000000000000000000000000'
};

for (const [key, value] of Object.entries(PLACEHOLDER_ENV)) {
    process.env[key] = process.env[key] || value;
}

function fail(message, error) {
    console.error(`\n❌ backend/server.js failed to boot: ${message}\n`);

    if (error) {
        console.error(error.stack || error.message || String(error));

        if (error.code === 'MODULE_NOT_FOUND') {
            console.error(
                '\nA module could not be resolved. Either the path is misspelled, ' +
                'the file is missing, or the package is used but not listed in ' +
                'backend/package.json.'
            );
        }
    }

    console.error('\nRun `node scripts/check-boot.js` locally to reproduce.\n');
    process.exit(1);
}

let app;

try {
    app = require(SERVER_PATH);
} catch (error) {
    fail('requiring the module threw', error);
}

// server.js exports the Express app. An Express app is a function with a
// `use` method and a router stack; anything else means the export changed and
// the smoke checks below would be meaningless.
if (typeof app !== 'function' || typeof app.use !== 'function') {
    fail(
        `the module loaded but did not export an Express app (got ${typeof app}). ` +
        'server.js must end with `module.exports = app`.'
    );
}

// A bare `express()` with nothing mounted would satisfy the check above, which
// would let a server.js that lost its entire routing section pass. Requiring a
// non-trivial middleware stack rules that out.
const stackSize = app._router && Array.isArray(app._router.stack)
    ? app._router.stack.length
    : (app.router && Array.isArray(app.router.stack) ? app.router.stack.length : 0);

if (stackSize < 10) {
    fail(
        `the app loaded but has only ${stackSize} middleware/route layers mounted. ` +
        'That is far below the expected stack size and suggests the routing ' +
        'section did not run.'
    );
}

console.log(`✅ boot check passed — backend/server.js loaded with ${stackSize} mounted layers`);

// Requiring server.js calls `server.listen()` and starts interval timers, so
// the process would otherwise hang here with nothing left to do.
process.exit(0);
