#!/usr/bin/env node
//
// scripts/check-modules.js
//
// Require-time gate for every backend module, not just the ones the server
// happens to reach. Addresses #1474.
//
// We already run two gates before this one and neither could see the failure
// that took `main` down:
//
//   check-syntax.js  parses each file. `max: CONTACT_FORM_MAX` where nothing
//                    declares `CONTACT_FORM_MAX` is a valid identifier in a
//                    valid expression; it parses cleanly and throws when the
//                    line runs.
//   check-boot.js    requires `server.js`, so it covers a module exactly when
//                    something on the require path from `server.js` reaches it.
//                    It did catch this one -- after the merge was already on
//                    `main`, because the merge is what created it.
//
// The gap is the second of those. A module nothing currently imports -- a
// service behind a flag, a route that is written but not yet mounted, a module
// whose only caller was deleted -- is checked by nothing. It parses, so the
// parse gate passes it; it is not reachable, so the boot gate never loads it.
// The first person to import it finds out.
//
// This requires each one on its own and reports what threw. It is the same
// check the boot gate makes, applied to the whole tree instead of one graph,
// and it catches the class the parse gate structurally cannot: undeclared
// identifiers, `require` of a package that is used but not in package.json,
// misspelled relative paths, and top-level throws.
//
// Usage:
//   node scripts/check-modules.js            # check backend/
//   node scripts/check-modules.js --list      # list what would be checked
//
// Exit code 0 when every module loads (or fails only in a way KNOWN_FAILURES
// documents), 1 otherwise.
//

'use strict';

const fs = require('fs');
const path = require('path');

const { applyPlaceholderEnv } = require('./lib/placeholder-env');

// Must run before the first require of application code -- config/db.js and
// config/envValidator.js validate at require time.
applyPlaceholderEnv();

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKEND_ROOT = path.join(REPO_ROOT, 'backend');

// Directories with nothing to load: third-party code, build output, test
// files (Jest owns those), and directories that hold no JavaScript at all.
const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'coverage',
    'dist',
    'build',
    'logs',
    'tests',
    'docs',
    'openapi',
    'sql'
]);

// `server.js` binds a listener and starts a renewal cron. check-boot.js owns
// it, deliberately and on its own.
const IGNORED_FILES = new Set([
    path.join(BACKEND_ROOT, 'server.js')
]);

// ============================================================================
// KNOWN FAILURES
// ============================================================================
//
// A ratchet, in the spirit of the coverage thresholds in backend/jest.config.js.
// These modules do not load today. Failing the build on them would mean this
// gate is red on arrival, which teaches people to ignore it -- the exact
// dynamic that let eight unparsable files reach `main` in #1297.
//
// So each is recorded with the error it currently produces and why it is
// tolerated. The `match` is part of the contract: a module listed here still
// fails the gate if it starts failing for a *different* reason, and a module
// that starts loading correctly also fails the gate, so an entry cannot outlive
// the problem it describes. Fix one, delete its entry.
//
// Every one of these is a real defect. None of them is this PR's.
//
const KNOWN_FAILURES = [
    {
        file: 'middleware/agenticATOMiddleware.js',
        match: /Cannot find module '@tensorflow\/tfjs-node'/,
        reason:
            '@tensorflow/tfjs-node is required but not in backend/package.json. '
            + 'It is a large native-build dependency; adding it is a decision '
            + 'about the deployment, not a build fix.'
    },
    {
        file: 'services/agenticATODetectionService.js',
        match: /Cannot find module '@tensorflow\/tfjs-node'/,
        reason: 'Same missing dependency as middleware/agenticATOMiddleware.js.'
    },
    {
        file: 'middleware/refundFraudMiddleware.js',
        match: /Cannot find module 'multer'/,
        reason:
            'multer is required but not in backend/package.json. Cheap to add, '
            + 'but it changes what the refund upload path does and belongs with '
            + 'a change that exercises it.'
    },
    {
        file: 'routes/puppeteerRoutes.js',
        match: /Cannot find module 'puppeteer'/,
        reason:
            'puppeteer is required but not in backend/package.json. It ships a '
            + 'browser; adding it to the API image is a deployment decision.'
    },
    {
        file: 'services/puppeteerPoolService.js',
        match: /Cannot find module 'puppeteer'/,
        reason: 'Same missing dependency as routes/puppeteerRoutes.js.'
    }
];

function findKnownFailure(relativeFile) {
    return KNOWN_FAILURES.find((entry) => entry.file === relativeFile) || null;
}

/**
 * Recursively collect every `.js` file under `dir`.
 *
 * @param {string} dir - Absolute directory path.
 * @param {string[]} [found] - Accumulator.
 * @returns {string[]} Absolute file paths, sorted for stable output.
 */
function collectModules(dir, found = []) {
    let entries;

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return found;
        throw error;
    }

    for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            collectModules(full, found);
            continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
        if (IGNORED_FILES.has(full)) continue;

        found.push(full);
    }

    return found;
}

/**
 * Require one module and report what happened.
 *
 * Requiring is not free of side effects -- several services open pools and
 * start intervals on import -- but that is the point. A module that cannot be
 * imported without throwing is a module that cannot be used, and the only way
 * to find out is to import it.
 *
 * @param {string} filePath - Absolute path.
 * @returns {Error|null} null when it loads.
 */
function loadModule(filePath) {
    try {
        require(filePath);
        return null;
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
}

/**
 * The first stack frame that points inside the repository.
 *
 * Node's own loader frames dominate a MODULE_NOT_FOUND stack, and the frame
 * that matters is the one naming the file that did the requiring.
 *
 * @param {Error} error
 * @returns {string|null}
 */
function originFrame(error) {
    const frames = String(error.stack || '').split('\n').slice(1);

    for (const frame of frames) {
        if (!frame.includes(REPO_ROOT)) continue;
        if (frame.includes(`${path.sep}node_modules${path.sep}`)) continue;

        // Anchor on the repo root rather than on whitespace. A frame reads
        // `at Object.<anonymous> (/abs/path/file.js:12:3)`, and a checkout
        // directory is allowed to contain spaces -- so neither "everything
        // after the last space" nor a space-intolerant character class gets the
        // path right. Slicing from the known prefix does.
        const start = frame.indexOf(REPO_ROOT);
        const location = frame.slice(start).replace(/\)\s*$/, '');

        const match = /^(.+):(\d+):(\d+)$/.exec(location);
        if (!match) continue;

        return `${path.relative(REPO_ROOT, match[1])}:${match[2]}`;
    }

    return null;
}

function explain(error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        return 'a require could not be resolved. Either the relative path is '
            + 'misspelled, the file is missing, or the package is used but not '
            + 'listed in backend/package.json.';
    }

    if (error instanceof ReferenceError) {
        return 'the module body referenced a name nothing declares. This is the '
            + 'shape a conflict resolution leaves behind when it keeps a use and '
            + 'drops its declaration -- it parses, so the syntax gate passes it.';
    }

    if (error instanceof TypeError) {
        return 'the module body threw while evaluating. Commonly a destructure '
            + 'of something a require did not return, or a call on a value that '
            + 'is not what it is expected to be.';
    }

    return 'the module body threw on import.';
}

// ============================================================================
// RUN
// ============================================================================

function main() {
    const modules = collectModules(BACKEND_ROOT).sort();

    if (process.argv.includes('--list')) {
        for (const file of modules) {
            console.log(path.relative(REPO_ROOT, file));
        }
        process.exit(0);
    }

    const failures = [];
    const tolerated = [];
    const fixed = [];

    for (const file of modules) {
        const relativeToBackend = path.relative(BACKEND_ROOT, file);
        const known = findKnownFailure(relativeToBackend);
        const error = loadModule(file);

        if (!error) {
            // A module that used to fail and now loads means KNOWN_FAILURES is
            // stale. Left alone, the list quietly grows into a permanent
            // exemption for problems that no longer exist.
            if (known) fixed.push(relativeToBackend);
            continue;
        }

        const errorMessage = (error.message || '').replace(/\\/g, '/');

        if (known && known.match.test(errorMessage)) {
            tolerated.push({ file: relativeToBackend, reason: known.reason });
            continue;
        }

        failures.push({ file, error, wasKnown: Boolean(known) });
    }

    // ---- report ------------------------------------------------------------

    console.log('');

    if (tolerated.length > 0) {
        console.log(`ℹ️  ${tolerated.length} known failure(s) tolerated:\n`);
        for (const entry of tolerated) {
            console.log(`   backend/${entry.file}`);
            console.log(`      ${entry.reason}\n`);
        }
    }

    for (const { file, error, wasKnown } of failures) {
        const relative = path.relative(REPO_ROOT, file);
        const origin = originFrame(error);

        console.error(`❌ ${relative}`);
        console.error(`   ${error.name}: ${(error.message || '').split('\n')[0]}`);
        if (origin && origin !== relative) console.error(`   thrown from ${origin}`);
        console.error(`   ${explain(error)}`);
        if (wasKnown) {
            console.error(
                '   NOTE: this file is in KNOWN_FAILURES but is failing for a '
                + 'different reason than the one recorded there.'
            );
        }
        console.error('');
    }

    for (const file of fixed) {
        console.error(`❌ backend/${file}`);
        console.error(
            '   This module now loads, but it is still listed in KNOWN_FAILURES '
            + 'in scripts/check-modules.js. Delete its entry.\n'
        );
    }

    const failed = failures.length + fixed.length;

    if (failed > 0) {
        console.error(
            `${failed} of ${modules.length} backend module(s) could not be `
            + 'imported.\n\nRun `node scripts/check-modules.js` locally to '
            + 'reproduce.\n'
        );
        process.exit(1);
    }

    console.log(
        `✅ module check passed — ${modules.length} backend modules imported `
        + `cleanly (${tolerated.length} known failure(s) tolerated)\n`
    );

    // Imported modules hold pools, sockets and interval timers, so the process
    // would otherwise sit here with nothing left to do.
    process.exit(0);
}

main();
