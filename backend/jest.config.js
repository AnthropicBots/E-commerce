// backend/jest.config.js
module.exports = {
    testEnvironment: 'node',

    setupFiles: ['<rootDir>/tests/setupEnv.js'],

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

    // A ratchet, not an aspiration.
    //
    // These were all set to 80 while the suite actually covers roughly a fifth
    // of the backend, so `npm test` exited non-zero even with every one of the
    // 391 tests green (#1341). A gate that is red no matter what you do teaches
    // contributors to ignore it -- which is precisely how eight failing suites
    // reached `main` unnoticed in the first place.
    //
    // The numbers below sit just under the currently measured coverage. Raise
    // them as coverage grows; they exist to stop it *falling*, and 80 remains
    // the target worth ratcheting towards.
    coverageThreshold: {
        global: {
            branches: 12,
            functions: 13,
            lines: 22,
            statements: 22
        }
    },
    coverageReporters: ['text', 'lcov', 'html'],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/tests/'
    ],
    testMatch: [
        '**/tests/**/*.test.js'
    ],

    // Requiring server.js binds a listener and starts a renewal cron, and
    // several services hold interval timers. Those handles outlive the tests,
    // so without this the run hangs after the last assertion instead of exiting.
    forceExit: true
};