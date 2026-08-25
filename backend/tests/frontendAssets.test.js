// backend/tests/frontendAssets.test.js
//
// Every local asset a page references has to exist (#1580).
//
// signin.html and signup.html each carried four script tags for a Firebase
// integration that had been deleted:
//
//   <script src="scripts/runtime-config.js"></script>   -> 404
//   <script src=".../firebase-app-compat.js"></script>  -> ~180 KB, unused
//   <script src=".../firebase-auth-compat.js"></script> -> ~70 KB, unused
//   <script src="scripts/firebase.js"></script>         -> 404
//
// Nothing in the repository referenced `firebase`, `runtime-config` or any
// Google sign-in handler, and dashboard.html pointed at an avatar
// (assets/images/user.png) that had never been committed at all. All three
// survived because nothing here reads HTML: the syntax gate parses .js, the
// boot gate requires server.js, and neither has any opinion about a <script>
// tag.
//
// scripts/check-assets.js holds the rules; this suite runs it over every page so
// a broken reference fails with the rest of the test output, and pins the
// specific regressions that motivated it.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');

const {
    auditPage,
    extractReferences,
    isExternal,
    resolveReference,
} = require(path.join(REPO_ROOT, 'scripts', 'check-assets.js'));

const pages = fs
    .readdirSync(FRONTEND_DIR)
    .filter((name) => name.endsWith('.html'))
    .sort();

/**
 * Read one page.
 *
 * @param {string} name
 * @returns {string}
 */
function read(name) {
    return fs.readFileSync(path.join(FRONTEND_DIR, name), 'utf8');
}

describe('every frontend page', () => {
    test('there are pages to check', () => {
        // A guard on the glob: an empty list would make every case below pass
        // over nothing.
        expect(pages.length).toBeGreaterThan(20);
    });

    test.each(pages)('%s only references assets that exist', (name) => {
        expect(auditPage(read(name), FRONTEND_DIR)).toEqual([]);
    });

    test.each(pages)('%s references at least one local asset', (name) => {
        // Every page in this project loads at least a stylesheet. A page that
        // suddenly references nothing means the extraction stopped matching,
        // not that the page got simpler -- and a gate that finds nothing to
        // check passes silently.
        expect(extractReferences(read(name)).length).toBeGreaterThan(0);
    });
});

describe('the dead Firebase integration', () => {
    const authPages = ['signin.html', 'signup.html'];

    test.each(authPages)('%s no longer loads the Firebase compat SDK', (name) => {
        expect(read(name)).not.toMatch(/firebasejs/);
    });

    test.each(authPages)('%s no longer loads the deleted local scripts', (name) => {
        const source = read(name);

        expect(source).not.toMatch(/scripts\/firebase\.js/);
        expect(source).not.toMatch(/scripts\/runtime-config\.js/);
    });

    test.each(authPages)('%s still loads the auth client it actually uses', (name) => {
        // The point of the removal is that it changes no behaviour: sign-in on
        // both pages runs through scripts/auth.js against our own /api/auth
        // endpoints, and always did.
        expect(read(name)).toMatch(/src="scripts\/auth\.js"/);
    });

    test('neither file was left behind anywhere else in the frontend', () => {
        expect(fs.existsSync(path.join(FRONTEND_DIR, 'scripts', 'firebase.js'))).toBe(false);
        expect(fs.existsSync(path.join(FRONTEND_DIR, 'scripts', 'runtime-config.js'))).toBe(false);

        const referencing = pages.filter((name) => /firebase|runtime-config/i.test(read(name)));
        expect(referencing).toEqual([]);
    });
});

describe('the dashboard avatar', () => {
    test('resolves to a file that is in the tree', () => {
        const source = read('dashboard.html');
        const match = /<img[^>]*id="profile-avatar"[^>]*>/.exec(source);

        expect(match).not.toBeNull();

        const src = /\bsrc\s*=\s*"([^"]*)"/.exec(match[0]);
        expect(src).not.toBeNull();
        expect(fs.existsSync(resolveReference(src[1], FRONTEND_DIR))).toBe(true);
    });
});

describe('reference extraction', () => {
    test('picks up scripts, stylesheets, images and sources', () => {
        const found = extractReferences(`
            <link rel="stylesheet" href="styles/base.css">
            <script src="scripts/utils.js"></script>
            <img src="assets/images/1.png" alt="">
            <source src="assets/videos/hero.mp4" type="video/mp4">
        `);

        expect(found.map((entry) => entry.kind).sort()).toEqual([
            'image',
            'link',
            'script',
            'source',
        ]);
    });

    test('ignores links that carry a URL rather than a file', () => {
        // preconnect and canonical both use href and neither names anything on
        // disk. Checking them would report the whole of the internet missing.
        const found = extractReferences(`
            <link rel="preconnect" href="https://fonts.gstatic.com">
            <link rel="canonical" href="/shop.html">
            <link rel="dns-prefetch" href="//cdn.example.com">
        `);

        expect(found).toEqual([]);
    });

    test('ignores inline scripts, which have no src to resolve', () => {
        expect(extractReferences('<script>console.log(1)</script>')).toEqual([]);
    });
});

describe('what counts as external', () => {
    test.each([
        'https://cdn.example.com/a.js',
        'http://cdn.example.com/a.js',
        '//cdn.example.com/a.js',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        'mailto:support@example.com',
        '#main-content',
        '${product.image}',
        '{{ product.image }}',
        '',
    ])('%s is not checked against the filesystem', (reference) => {
        expect(isExternal(reference)).toBe(true);
    });

    test.each([
        'scripts/utils.js',
        './scripts/utils.js',
        '../styles/base.css',
        '/assets/images/1.png',
        'styles/base.css?v=3',
    ])('%s is checked against the filesystem', (reference) => {
        expect(isExternal(reference)).toBe(false);
    });
});

describe('reference resolution', () => {
    test('treats a leading slash as the deployment root', () => {
        // vercel.json serves frontend/ as the root, so /styles/base.css is
        // frontend/styles/base.css regardless of which page asked for it.
        expect(resolveReference('/styles/base.css', path.join(FRONTEND_DIR, 'anywhere')))
            .toBe(path.join(FRONTEND_DIR, 'styles', 'base.css'));
    });

    test('resolves a relative reference against the referencing page', () => {
        expect(resolveReference('scripts/utils.js', FRONTEND_DIR))
            .toBe(path.join(FRONTEND_DIR, 'scripts', 'utils.js'));
    });

    test('strips a cache-busting query before resolving', () => {
        expect(resolveReference('styles/base.css?v=3', FRONTEND_DIR))
            .toBe(path.join(FRONTEND_DIR, 'styles', 'base.css'));
    });

    test('strips an SVG sprite fragment before resolving', () => {
        expect(resolveReference('assets/sprite.svg#cart', FRONTEND_DIR))
            .toBe(path.join(FRONTEND_DIR, 'assets', 'sprite.svg'));
    });
});

describe('the gate itself', () => {
    test('reports a reference that does not resolve', () => {
        const problems = auditPage(
            '<script src="scripts/definitely-not-here.js"></script>',
            FRONTEND_DIR
        );

        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('definitely-not-here.js');
        expect(problems[0]).toContain('no such file');
    });

    test('reports every broken reference on a page, not just the first', () => {
        const problems = auditPage(
            `<script src="scripts/gone-a.js"></script>
             <link rel="stylesheet" href="styles/gone-b.css">
             <img src="assets/images/gone-c.png" alt="">`,
            FRONTEND_DIR
        );

        expect(problems).toHaveLength(3);
    });

    test('passes a page whose references all resolve', () => {
        expect(
            auditPage('<script src="scripts/utils.js"></script>', FRONTEND_DIR)
        ).toEqual([]);
    });
});
