#!/usr/bin/env node
//
// scripts/check-assets.js
//
// Every local asset a page references has to exist. Addresses #1580.
//
// The three gates that already run -- syntax, boot, modules -- are all backend
// or parse-level. None of them can see this:
//
//   <script src="scripts/firebase.js"></script>
//
// pointing at a file that was deleted eight commits ago. The tag parses (it is
// HTML, nothing parses it at all), the server boots fine (it is frontend), and
// the page still renders, so nothing goes red. The only symptom is a 404 in a
// console nobody has open, and it survived on signin.html and signup.html --
// the two pages every visitor passes through -- until someone happened to look.
//
// A missing stylesheet is worse than a missing script, because the page renders
// unstyled rather than not at all, and a missing image is a broken icon on a
// product card. All three are the same mistake: a reference that outlived what
// it referenced.
//
// What is checked:
//
//   <script src>   local paths only
//   <link href>    only where the link is a stylesheet or an icon; preconnect,
//                  dns-prefetch and canonical carry URLs, not files
//   <img src>      local paths only
//   <source src>   local paths only, for <picture> and <video>
//
// What is deliberately not checked:
//
//   * absolute URLs (http://, https://, //cdn...) -- resolving those means a
//     network call, and a gate that needs the network is a gate that fails on
//     a train
//   * data: and blob: URIs, which are the content
//   * fragment-only hrefs (#main-content), which are anchors
//   * template placeholders (${...}, {{...}}) in pages that build a src at
//     runtime -- there is nothing on disk to compare them against
//   * runtime-injected assets: components.js writes the header and footer into
//     every page, so anything it references is invisible here. That is a real
//     hole and a JSDOM-level check is the way to close it; this gate covers
//     what is written in the markup, which is where the dead references were.
//
// Query strings and fragments are stripped before resolving, so
// `styles/main.css?v=3` and `sprite.svg#cart` both resolve to the file.
//
// Usage:
//   node scripts/check-assets.js
//
// Exit code 0 when every reference resolves, 1 otherwise.

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');

// A `rel` that names a file on disk. Anything else on a <link> -- preconnect,
// dns-prefetch, canonical, manifest pointing at a route -- is a URL or a hint,
// and checking it against the filesystem would produce noise, not findings.
const FILE_BEARING_REL = new Set([
    'stylesheet',
    'icon',
    'shortcut icon',
    'apple-touch-icon',
    'mask-icon',
    'preload',
]);

/**
 * References this gate cannot or should not resolve against the filesystem.
 *
 * @param {string} reference - The raw attribute value.
 * @returns {boolean}
 */
function isExternal(reference) {
    const value = reference.trim();

    if (value === '') return true;

    return (
        /^[a-z][a-z0-9+.-]*:/i.test(value) // http:, https:, data:, blob:, mailto:
        || value.startsWith('//') // protocol-relative
        || value.startsWith('#') // in-page anchor
        || value.includes('${') // template literal built at runtime
        || value.includes('{{') // handlebars-style placeholder
    );
}

/**
 * Turn a reference into the path on disk it should resolve to.
 *
 * A leading slash means the deployment root, which for this project is
 * `frontend/` -- that is what vercel.json serves and what Live Server opens.
 * Anything else is relative to the page that carries it.
 *
 * @param {string} reference
 * @param {string} pageDir - Absolute directory of the referencing page.
 * @returns {string} Absolute path.
 */
function resolveReference(reference, pageDir) {
    const withoutQuery = reference.split('?')[0].split('#')[0];

    return withoutQuery.startsWith('/')
        ? path.join(FRONTEND_DIR, withoutQuery.slice(1))
        : path.resolve(pageDir, withoutQuery);
}

/**
 * Read the value of one attribute out of a tag.
 *
 * @param {string} tag - The full tag text, e.g. `<link rel="icon" href="a.png">`.
 * @param {string} name
 * @returns {string|null}
 */
function attribute(tag, name) {
    const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
    return match ? match[1] : null;
}

/**
 * Every local asset one page references, as `{ kind, reference }` pairs.
 *
 * Exported so the tests can exercise the extraction without touching disk.
 *
 * @param {string} source - The page's HTML.
 * @returns {Array<{kind: string, reference: string}>}
 */
function extractReferences(source) {
    const found = [];

    const collect = (tagPattern, attributeName, kind, filter) => {
        for (const match of source.matchAll(tagPattern)) {
            const tag = match[0];
            if (filter && !filter(tag)) continue;

            const reference = attribute(tag, attributeName);
            if (reference === null || isExternal(reference)) continue;

            found.push({ kind, reference });
        }
    };

    collect(/<script\b[^>]*>/gi, 'src', 'script');
    collect(/<img\b[^>]*>/gi, 'src', 'image');
    collect(/<source\b[^>]*>/gi, 'src', 'source');
    collect(/<link\b[^>]*>/gi, 'href', 'link', (tag) => {
        const rel = attribute(tag, 'rel');
        return rel !== null && FILE_BEARING_REL.has(rel.trim().toLowerCase());
    });

    return found;
}

/**
 * Everything one page references that is not there.
 *
 * @param {string} source - The page's HTML.
 * @param {string} pageDir - Absolute directory of the page.
 * @returns {string[]} Empty when every reference resolves.
 */
function auditPage(source, pageDir) {
    const problems = [];

    for (const { kind, reference } of extractReferences(source)) {
        const target = resolveReference(reference, pageDir);

        if (!fs.existsSync(target)) {
            problems.push(`${kind} ${reference} -> no such file`);
        }
    }

    return problems;
}

function main() {
    const pages = fs
        .readdirSync(FRONTEND_DIR)
        .filter((name) => name.endsWith('.html'))
        .sort();

    const failures = [];
    let checked = 0;

    for (const name of pages) {
        const file = path.join(FRONTEND_DIR, name);
        const source = fs.readFileSync(file, 'utf8');

        checked += extractReferences(source).length;

        const problems = auditPage(source, path.dirname(file));
        if (problems.length > 0) failures.push({ name, problems });
    }

    if (failures.length === 0) {
        console.log(
            `✅ asset check passed — ${checked} local reference(s) across ${pages.length} page(s) resolve`
        );
        process.exit(0);
    }

    const broken = failures.reduce((sum, failure) => sum + failure.problems.length, 0);

    console.error(
        `\n❌ ${broken} broken reference(s) across ${failures.length} of ${pages.length} page(s):\n`
    );
    for (const failure of failures) {
        console.error(`  frontend/${failure.name}`);
        for (const problem of failure.problems) {
            console.error(`      ${problem}`);
        }
        console.error('');
    }
    console.error(
        'Either restore the file or remove the reference. '
        + 'Run `npm run check:assets` locally to reproduce.\n'
    );

    process.exit(1);
}

module.exports = { extractReferences, isExternal, resolveReference, auditPage };

if (require.main === module) {
    main();
}
