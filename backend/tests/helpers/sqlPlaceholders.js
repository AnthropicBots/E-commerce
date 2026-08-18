// backend/tests/helpers/sqlPlaceholders.js
//
// Does each statement bind as many values as it has placeholders? (#1583)
//
// `configService.persistConfig` listed five columns, gave `updated_at` a
// `NOW()` and the other four a `?`, and passed three values. mysql2 rejects
// that with "Incorrect arguments to mysqld_stmt_execute" before the statement
// reaches the server, so `POST /api/config` was a 500 every time.
//
// It is an easy mistake to make and an almost impossible one to see by reading:
// the placeholders are in a template literal several lines above the array, and
// counting `?` characters by eye across a wrapped INSERT is exactly the kind of
// thing people skip. Nothing else catches it either -- the file parses, the
// module imports, and every suite mocks config/db, so no test has ever executed
// the statement.
//
// This counts both sides of a `.query(sql, [args])` call and reports the ones
// that disagree.
//
// Scope, deliberately narrow. Only calls where **both** sides can be counted
// with certainty are considered:
//
//   * the SQL must be a template literal with no `${...}` in it -- an
//     interpolated fragment can contribute any number of placeholders, and
//     several services legitimately build `WHERE` clauses that way;
//   * the argument list must be an array literal with no spread -- `...values`
//     has no static length.
//
// Anything else is reported as "not statically countable" and skipped rather
// than guessed at. A checker that guesses produces false failures, people learn
// to ignore it, and then it catches nothing.

'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

const SKIP_DIRECTORIES = new Set([
    'node_modules',
    'coverage',
    'tests',
    'logs',
    '.git',
]);

/**
 * Every .js file under the backend, excluding vendored and generated trees.
 *
 * @param {string} [directory]
 * @returns {string[]} Absolute paths.
 */
function backendSources(directory = BACKEND_ROOT) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (SKIP_DIRECTORIES.has(entry.name)) return [];

        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) return backendSources(full);

        return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
    });
}

/**
 * Count top-level commas in an argument list, i.e. how many values it binds.
 *
 * Commas inside nested calls, arrays, objects, strings, template literals and
 * comments do not separate arguments. Getting this wrong in either direction
 * produces a false result, so it is walked character by character rather than
 * split.
 *
 * @param {string} source - The inside of the array literal, without its brackets.
 * @returns {number|null} null when the list cannot be counted (a spread).
 */
function countArguments(source) {
    const text = source.trim();

    if (text === '') return 0;

    let depth = 0;
    let count = 1;
    let index = 0;

    while (index < text.length) {
        const character = text[index];
        const pair = text.slice(index, index + 2);

        // Comments: a `//` line comment often contains prose with commas in it,
        // which is what made an earlier version of this miscount.
        if (pair === '//') {
            const end = text.indexOf('\n', index);
            index = end === -1 ? text.length : end;
            continue;
        }

        if (pair === '/*') {
            const end = text.indexOf('*/', index + 2);
            index = end === -1 ? text.length : end + 2;
            continue;
        }

        // Strings and template literals, skipped whole. Escapes are honoured so
        // a quote inside a string does not end it early.
        if (character === '"' || character === "'" || character === '`') {
            index += 1;
            while (index < text.length && text[index] !== character) {
                index += text[index] === '\\' ? 2 : 1;
            }
            index += 1;
            continue;
        }

        if (character === '(' || character === '[' || character === '{') depth += 1;
        if (character === ')' || character === ']' || character === '}') depth -= 1;

        if (character === ',' && depth === 0) {
            // A trailing comma does not introduce another argument.
            if (text.slice(index + 1).trim() !== '') count += 1;
        }

        if (text.startsWith('...', index) && depth === 0) return null;

        index += 1;
    }

    return count;
}

/**
 * Count `?` placeholders in a statement.
 *
 * `?` inside a string literal within the SQL is not a placeholder, but SQL
 * string literals in this codebase are single-quoted status values and none of
 * them contain a question mark, so a plain count is honest here.
 *
 * @param {string} sql
 * @returns {number}
 */
function countPlaceholders(sql) {
    return (sql.match(/\?/g) || []).length;
}

/**
 * The contents of the array literal that starts at `open`.
 *
 * Bracket-matched rather than matched with `\[([\s\S]*?)\]`, which stops at the
 * first `]` in the list -- and argument lists are full of them, as in
 * `result.agentStates.find((state) => state[0] === 'x')[1]`. A non-greedy regex
 * truncates that after `state[0`, counts two arguments where there are nine,
 * and reports a mismatch that is not there.
 *
 * @param {string} source
 * @param {number} open - Index of the `[`.
 * @returns {string|null} The inside of the array, or null if it never closes.
 */
function readArrayLiteral(source, open) {
    let depth = 0;
    let index = open;

    while (index < source.length) {
        const character = source[index];
        const pair = source.slice(index, index + 2);

        if (pair === '//') {
            const end = source.indexOf('\n', index);
            index = end === -1 ? source.length : end;
            continue;
        }

        if (pair === '/*') {
            const end = source.indexOf('*/', index + 2);
            index = end === -1 ? source.length : end + 2;
            continue;
        }

        if (character === '"' || character === "'" || character === '`') {
            index += 1;
            while (index < source.length && source[index] !== character) {
                index += source[index] === '\\' ? 2 : 1;
            }
            index += 1;
            continue;
        }

        if (character === '[' || character === '(' || character === '{') depth += 1;

        if (character === ']' || character === ')' || character === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open + 1, index);
        }

        index += 1;
    }

    return null;
}

/**
 * Every statically countable `.query(sql, [args])` call in one file.
 *
 * @param {string} source - File contents.
 * @param {string} label - How to name the file in a result.
 * @returns {Array<{file: string, line: number, placeholders: number, args: number}>}
 */
function countableCalls(source, label) {
    const calls = [];

    // `.query(` or `.execute(` followed by a template literal, then an array.
    // The array is located rather than matched, for the reason above.
    const pattern = /\.(?:query|execute)\(\s*`([^`]*)`\s*,\s*(?=\[)/g;

    for (const match of source.matchAll(pattern)) {
        const sql = match[1];

        // An interpolated fragment can carry any number of placeholders.
        if (sql.includes('${')) continue;

        const body = readArrayLiteral(source, match.index + match[0].length);
        if (body === null) continue;

        const args = countArguments(body);
        if (args === null) continue;

        calls.push({
            file: label,
            line: source.slice(0, match.index).split('\n').length,
            placeholders: countPlaceholders(sql),
            args,
        });
    }

    return calls;
}

/**
 * Every statement in the backend whose two sides disagree.
 *
 * @returns {string[]} e.g. `['services/configService.js:320 4 placeholders, 3 arguments']`
 */
function mismatchedStatements() {
    const mismatches = [];

    for (const file of backendSources()) {
        const label = path.relative(BACKEND_ROOT, file);
        const source = fs.readFileSync(file, 'utf8');

        for (const call of countableCalls(source, label)) {
            if (call.placeholders !== call.args) {
                mismatches.push(
                    `${call.file}:${call.line} `
                    + `${call.placeholders} placeholder(s), ${call.args} argument(s)`
                );
            }
        }
    }

    return mismatches.sort();
}

module.exports = {
    readArrayLiteral,
    backendSources,
    countArguments,
    countPlaceholders,
    countableCalls,
    mismatchedStatements,
};
