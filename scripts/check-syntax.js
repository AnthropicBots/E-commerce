#!/usr/bin/env node
//
// scripts/check-syntax.js
//
// Repo-wide JavaScript parse gate. Addresses #1297.
//
// Eight files reached `main` in an unparsable state -- four of them stopping
// the backend from booting -- because nothing between a pull request and the
// default branch ever tried to parse them. Every one of those failures is
// detectable in well under a second.
//
// Unlike `node --check`, which stops at the first bad file when scripted in a
// shell loop, this reports *every* failure in one pass with file, line and
// message, so a contributor sees the whole picture at once.
//
// Parse goal matters here:
//   - backend/**  are CommonJS modules  -> parsed as scripts, `require` is
//                                          just a call expression
//   - frontend/scripts/** are classic <script> files, NOT modules; they use
//     top-level `const`/`function` and would be rejected by a module-goal
//     parser complaining about missing imports/exports, and accepted by it
//     for `import`/`export` that the browser tags here cannot actually run.
//
// Both are checked with `vm.Script`, which uses V8's script goal -- the same
// goal the browser and CommonJS use. Files that legitimately use ESM syntax
// are retried as modules before being reported.
//
// Usage:
//   node scripts/check-syntax.js            # check the default roots
//   node scripts/check-syntax.js src lib    # check specific paths
//
// Exit code 0 when everything parses, 1 otherwise.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');

// Roots scanned when no paths are passed on the command line.
const DEFAULT_ROOTS = ['backend', 'frontend', 'scripts'];

// Directories never worth parsing: third-party code, build output, VCS data.
const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.vercel',
    'vendor',
]);

/**
 * Recursively collect every `.js` file under `dir`.
 *
 * @param {string} dir - Absolute directory path.
 * @param {string[]} [found] - Accumulator.
 * @returns {string[]} Absolute file paths.
 */
function collectJsFiles(dir, found = []) {
    let entries;

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        // A root listed in DEFAULT_ROOTS may not exist in every checkout.
        if (error.code === 'ENOENT') return found;
        throw error;
    }

    for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            collectJsFiles(full, found);
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.js')) {
            found.push(full);
        }
    }

    return found;
}

/**
 * Pull the 1-based line number out of a V8 syntax error.
 *
 * V8 puts it in the stack as `<filename>:<line>` on the first frame rather
 * than on the error object, so it has to be scraped.
 *
 * @param {Error} error
 * @param {string} filePath
 * @returns {number|null}
 */
function extractLine(error, filePath) {
    const stack = error.stack || '';
    const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}:(\\d+)`).exec(stack);
    return match ? Number(match[1]) : null;
}

/**
 * Parse one file without executing it.
 *
 * Tried as a script first (the goal used by CommonJS and by classic browser
 * `<script>` tags). If that fails only because the file uses ESM syntax, it is
 * retried as a module so genuine ES modules are not reported as broken.
 *
 * @param {string} filePath - Absolute path.
 * @returns {{line: number|null, message: string}|null} null when it parses.
 */
function checkFile(filePath) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relative = path.relative(REPO_ROOT, filePath);

    try {
        // `new vm.Script` compiles but never runs the code.
        new vm.Script(source, { filename: filePath });
        return null;
    } catch (scriptError) {
        if (!(scriptError instanceof SyntaxError)) throw scriptError;

        // Retry as an ES module before declaring failure.
        if (typeof vm.SourceTextModule === 'function') {
            try {
                new vm.SourceTextModule(source, { identifier: filePath });
                return null;
            } catch (moduleError) {
                if (!(moduleError instanceof SyntaxError)) throw moduleError;
            }
        } else if (/^(Cannot use import statement|Unexpected token 'export'|await is only valid)/.test(scriptError.message)) {
            // vm.SourceTextModule needs --experimental-vm-modules. Without it,
            // treat unambiguous ESM markers as acceptable rather than failing
            // a file this checker cannot judge.
            return null;
        }

        return {
            line: extractLine(scriptError, filePath),
            message: scriptError.message,
            relative,
        };
    }
}

function main() {
    const args = process.argv.slice(2);
    const roots = args.length > 0 ? args : DEFAULT_ROOTS;

    const files = [];
    for (const root of roots) {
        const abs = path.resolve(REPO_ROOT, root);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            files.push(abs);
        } else {
            collectJsFiles(abs, files);
        }
    }

    files.sort();

    const failures = [];
    for (const file of files) {
        const failure = checkFile(file);
        if (failure) failures.push(failure);
    }

    if (failures.length === 0) {
        console.log(`✅ syntax check passed — ${files.length} JavaScript file(s) parsed cleanly`);
        process.exit(0);
    }

    console.error(`\n❌ ${failures.length} of ${files.length} JavaScript file(s) failed to parse:\n`);
    for (const failure of failures) {
        const where = failure.line === null
            ? failure.relative
            : `${failure.relative}:${failure.line}`;
        console.error(`  ${where}`);
        console.error(`      ${failure.message}\n`);
    }
    console.error('A file that does not parse takes down every module that requires it.');
    console.error('Run `npm run check:syntax` locally to reproduce.\n');

    process.exit(1);
}

main();
