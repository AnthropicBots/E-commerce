#!/usr/bin/env node
//
// scripts/generate-sitemap.js
//
// Build frontend/sitemap.xml from the pages that actually exist. Addresses
// #1446.
//
// The hand-maintained sitemap drifted, as hand-maintained sitemaps do: fifteen
// entries against twenty-nine pages, with product.html and compare.html -- two
// ordinary shopper-facing pages -- absent, and every <loc> on a host that
// robots.txt did not agree with.
//
// The fix is not a better hand-edit. It is that the file has one source: the
// directory listing, minus an exclusion list that IS the robots.txt disallow
// list. Coupling them in one place is what stops them disagreeing again -- and
// a sitemap that submits a disallowed page for indexing is worse than one that
// omits an allowed one, because it asks a crawler to do the thing the other
// file just told it not to.
//
// Usage:
//   node scripts/generate-sitemap.js           # write frontend/sitemap.xml
//   node scripts/generate-sitemap.js --check   # exit 1 if the page set is stale
//
// `--check` is what CI runs: it regenerates in memory and diffs, so a new page
// added without regenerating fails review rather than quietly never being
// indexed.
//
// It compares everything except <lastmod>, and that is deliberate. lastmod
// comes from each page's last commit, so within the commit that edits a page
// the two can never agree: the generator reads the *previous* commit's date,
// and once the edit lands the date has moved on. Comparing it would make the
// check fail on the next run of every PR that touches a page -- a gate that is
// red however carefully you follow it teaches people to ignore it. What the
// gate is actually for is coverage: that every public page is listed and no
// disallowed one is.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');
const SITEMAP_PATH = path.join(FRONTEND_DIR, 'sitemap.xml');

// The canonical origin, and the only place it is written down.
//
// README.md and thirteen of the fourteen existing <link rel="canonical"> tags
// use this host. robots.txt and 404.html used https://www.bhuvansh.xyz, which
// is what left the two files advertising different sitemaps.
const SITE_ORIGIN = 'https://e-commerce-git-main-bhuvanshs-projects.vercel.app';

// Pages that must never be submitted for indexing.
//
// This list and the `Disallow:` lines in frontend/robots.txt are the same list.
// tests/seoArtifacts.test.js asserts that; if you add a page here, add the
// Disallow there, and the other way round.
const EXCLUDED = new Set([
    // Behind a sign-in, or personal to one shopper.
    'admin.html',
    'dashboard.html',
    'profile.html',
    'cart.html',
    'checkout.html',
    'success.html',
    'order.html',
    'wishlist.html',

    // Not a destination: it is what the router serves for everything else.
    // Submitting it asks a crawler to index the site's own error page.
    '404.html',

    // An internal demo of the AI copywriter, not a shop page.
    'copywriter-demo.html'
]);

// Priority is a hint about relative importance within this site, nothing more.
// Anything not named here gets DEFAULT_PRIORITY; the point of the table is that
// the handful of pages that genuinely rank differently say so, not that every
// page needs a number.
const PRIORITIES = {
    'index.html': '1.0',
    'shop.html': '0.9',
    'product.html': '0.9',
    'mens.html': '0.8',
    'womens.html': '0.8',
    'about.html': '0.8',
    'blog.html': '0.8',
    'compare.html': '0.7',
    'seasonal.html': '0.7',
    'early_summer.html': '0.7',
    'tshirt.html': '0.7',
    'Buy1Get1.html': '0.7',
    'contact.html': '0.7',
    'help.html': '0.6',
    'delivery.html': '0.6',
    'privacy.html': '0.5',
    'terms.html': '0.5',
    'signin.html': '0.3',
    'signup.html': '0.3'
};

const DEFAULT_PRIORITY = '0.5';

/**
 * Every page that belongs in the sitemap, in a stable order.
 *
 * Sorted so regenerating never reshuffles the file: a diff should show the page
 * that changed, not thirty lines that moved.
 *
 * @returns {string[]} File names, e.g. "shop.html".
 */
function collectPages() {
    return fs
        .readdirSync(FRONTEND_DIR)
        .filter((name) => name.endsWith('.html'))
        .filter((name) => !EXCLUDED.has(name))
        .sort();
}

/**
 * The date a page last changed, as YYYY-MM-DD.
 *
 * Taken from git rather than from the filesystem: an mtime is whenever the
 * working copy was written, so it would change on every fresh clone and make
 * `--check` fail for a reason that has nothing to do with the page.
 *
 * @param {string} fileName
 * @returns {string|null} null when git cannot answer (unstaged new file, or no
 *   git at all), in which case the entry is written without a <lastmod>.
 */
function lastModified(fileName) {
    try {
        const output = execFileSync(
            'git',
            ['log', '-1', '--format=%cs', '--', path.join('frontend', fileName)],
            { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim();

        return /^\d{4}-\d{2}-\d{2}$/.test(output) ? output : null;
    } catch {
        return null;
    }
}

/**
 * Render the sitemap document.
 *
 * @param {string[]} pages
 * @returns {string}
 */
function renderSitemap(pages) {
    const entries = pages.map((page) => {
        const lines = [
            '  <url>',
            `    <loc>${SITE_ORIGIN}/${page}</loc>`
        ];

        const lastmod = lastModified(page);
        if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);

        lines.push(`    <priority>${PRIORITIES[page] || DEFAULT_PRIORITY}</priority>`);
        lines.push('  </url>');

        return lines.join('\n');
    });

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!-- Generated by scripts/generate-sitemap.js. Do not edit by hand. -->',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...entries,
        '</urlset>',
        ''
    ].join('\n');
}

/**
 * The document with its <lastmod> lines removed.
 *
 * See the note at the top of this file: lastmod is the one field that cannot
 * agree with itself inside the commit that changes a page, so it is excluded
 * from the comparison rather than from the document.
 *
 * @param {string} xml
 * @returns {string}
 */
function withoutLastmod(xml) {
    return xml.replace(/[ \t]*<lastmod>[^<]*<\/lastmod>\n?/g, '');
}

function main() {
    const check = process.argv.includes('--check');
    const pages = collectPages();
    const generated = renderSitemap(pages);

    if (!check) {
        fs.writeFileSync(SITEMAP_PATH, generated, 'utf8');
        console.log(`✅ wrote frontend/sitemap.xml — ${pages.length} page(s)`);
        return;
    }

    const onDisk = fs.existsSync(SITEMAP_PATH)
        ? fs.readFileSync(SITEMAP_PATH, 'utf8')
        : '';

    if (withoutLastmod(onDisk) === withoutLastmod(generated)) {
        console.log(`✅ frontend/sitemap.xml covers all ${pages.length} public page(s)`);
        return;
    }

    console.error('\n❌ frontend/sitemap.xml does not match the pages on disk.\n');
    console.error('Run `npm run sitemap` and commit the result.\n');
    process.exit(1);
}

module.exports = {
    SITE_ORIGIN,
    EXCLUDED,
    collectPages,
    renderSitemap,
    withoutLastmod
};

if (require.main === module) {
    main();
}
