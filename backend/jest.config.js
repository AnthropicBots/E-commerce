// backend/jest.config.js
module.exports = {
    testEnvironment: 'node',

    // Transpile the ESM-only packages that Jest's CommonJS runtime cannot load.
    //
    // controllers/authController.js requires `otplib` for 2FA (#1026). otplib
    // ships a CommonJS build, but that build requires `@scure/base`, which is
    // pure ESM -- `"type": "module"`, no CJS entry point at all.
    //
    // Node itself copes: `require()` of a synchronous ES module graph landed in
    // Node 20.19 / 22.12, which is why `node -e "require('./server')"` starts
    // the app cleanly. Jest implements its own `require`, and jest-runtime has
    // no equivalent support at any Node version -- so requiring server.js threw
    // `SyntaxError: Unexpected token 'export'` and took the entire
    // serverBootstrap suite down with it.
    //
    // The same applies to `uuid`, which is ESM-only from v9 and is required
    // across the whole codebase.
    //
    // node_modules is not transformed by default; this re-includes only the
    // packages that ship ESM with no CommonJS entry point. Everything else
    // stays untransformed, so the suite does not pay a Babel cost it does not
    // need. If a new ESM-only dependency is added later it will surface as
    // `SyntaxError: Unexpected token 'export'` naming the package, and belongs
    // in this list.
    transformIgnorePatterns: [
        '/node_modules/(?!(uuid|@scure|@noble|otplib|@otplib|chai|color|color-string|@ungap)/)'
    ],

    collectCoverage: true,
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    coverageReporters: ['text', 'lcov', 'html'],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/tests/'
    ],
    testMatch: [
        '**/tests/**/*.test.js'
    ]
};