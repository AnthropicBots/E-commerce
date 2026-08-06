#!/usr/bin/env node
//
// scripts/check-a11y-landmarks.js
//
// Three structural accessibility requirements, checked on every page. Addresses
// #1447.
//
// Before this, across all twenty-nine pages in frontend/:
//
//   <main> landmark      0 / 29
//   skip link            0 / 29
//   <h1>                 4 / 29
//
// None of these is a judgement call, which is what makes them worth automating.
// A page either has a main region or it does not; a screen reader either has
// something to jump to or it does not. The checks that need human judgement --
// is the alt text useful, is the contrast right, does the tab order make sense
// -- are deliberately not here, because a linter that mixes the two teaches
// people to ignore all of it.
//
// What is checked, and why:
//
//   skip link   WCAG 2.4.1 Bypass Blocks (A). The header and nav are injected
//               into every page, so without it a keyboard user tabs through
//               the whole navigation before reaching content, every time.
//   <main>      WCAG 1.3.1 Info and Relationships (A). Landmark navigation
//               (D in NVDA, the rotor in VoiceOver) has nothing to offer
//               without one, and the skip link has nothing to point at.
//   one <h1>    WCAG 2.4.6 Headings and Labels (AA). "What page am I on?"
//               should be answerable from the heading structure. Exactly one,
//               because two top-level headings describe two documents.
//
// Usage:
//   node scripts/check-a11y-landmarks.js
//
// Exit code 0 when every page passes, 1 otherwise.

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');

/**
 * Count non-overlapping matches.
 *
 * @param {string} source
 * @param {RegExp} regex - Must be global.
 * @returns {number}
 */
function count(source, regex) {
    return (source.match(regex) || []).length;
}

/**
 * Everything wrong with one page, as a list of short strings.
 *
 * @param {string} source - The page's HTML.
 * @returns {string[]} Empty when the page passes.
 */
function auditPage(source) {
    const problems = [];

    // The link itself. `href="#main-content"` rather than any anchor, because
    // the target below is what makes it work.
    if (!/<a[^>]*class="[^"]*\bskip-link\b[^"]*"[^>]*href="#main-content"/.test(source)) {
        problems.push('no skip link to #main-content');
    }

    const mains = count(source, /<main\b/g);
    if (mains === 0) {
        problems.push('no <main> landmark');
    } else if (mains > 1) {
        problems.push(`${mains} <main> elements (expected 1)`);
    }

    // Without tabindex the jump moves the viewport but not focus, so the next
    // Tab press resumes inside the navigation the user just skipped.
    if (mains > 0 && !/<main[^>]*id="main-content"[^>]*tabindex="-1"/.test(source)) {
        problems.push('<main> is not id="main-content" tabindex="-1"');
    }

    const headings = count(source, /<h1\b/g);
    if (headings === 0) {
        problems.push('no <h1>');
    } else if (headings > 1) {
        problems.push(`${headings} <h1> elements (expected 1)`);
    }

    // The skip link has to be reachable on the first Tab, so nothing focusable
    // may precede it. Measured from the end of the <body> tag to the start of
    // the skip link's own <a>, not to the word "skip-link", which would put the
    // anchor itself inside the range being searched.
    const body = /<body[^>]*>/.exec(source);
    const link = /<a[^>]*class="[^"]*\bskip-link\b/.exec(source);

    if (body && link) {
        const beforeLink = source.slice(body.index + body[0].length, link.index);
        if (/<(a|button|input|select|textarea)\b/.test(beforeLink)) {
            problems.push('a focusable element precedes the skip link');
        }
    }

    if (!/<html[^>]*\blang=/.test(source)) {
        problems.push('no lang on <html>');
    }

    return problems;
}

function main() {
    const pages = fs
        .readdirSync(FRONTEND_DIR)
        .filter((name) => name.endsWith('.html'))
        .sort();

    const failures = [];

    for (const name of pages) {
        const source = fs.readFileSync(path.join(FRONTEND_DIR, name), 'utf8');
        const problems = auditPage(source);
        if (problems.length > 0) failures.push({ name, problems });
    }

    if (failures.length === 0) {
        console.log(
            `✅ landmark check passed — ${pages.length} page(s) have a skip link, a main landmark and one h1`
        );
        process.exit(0);
    }

    console.error(`\n❌ ${failures.length} of ${pages.length} page(s) failed the landmark check:\n`);
    for (const failure of failures) {
        console.error(`  frontend/${failure.name}`);
        for (const problem of failure.problems) {
            console.error(`      ${problem}`);
        }
        console.error('');
    }
    console.error('Run `npm run check:a11y` locally to reproduce.\n');

    process.exit(1);
}

module.exports = { auditPage };

if (require.main === module) {
    main();
}
