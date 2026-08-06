// backend/tests/seoArtifacts.test.js
//
// robots.txt, sitemap.xml, vercel.json and the canonical tags have to agree
// with each other (#1446).
//
// They did not. robots.txt was two complete copies of itself, so Googlebot had
// two groups and three Sitemap lines named two hosts. sitemap.xml was
// hand-maintained and had drifted to fifteen entries against twenty-nine pages,
// missing product.html and compare.html, on the host robots.txt did not
// advertise. Nothing anywhere said which host was canonical.
//
// The generator (scripts/generate-sitemap.js) is what stops the sitemap
// drifting again; these tests are what stop the four files drifting apart from
// each other.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');

const {
    SITE_ORIGIN,
    EXCLUDED,
    collectPages,
    renderSitemap,
    withoutLastmod
} = require(path.join(REPO_ROOT, 'scripts', 'generate-sitemap.js'));

const robots = fs.readFileSync(path.join(FRONTEND_DIR, 'robots.txt'), 'utf8');
const sitemap = fs.readFileSync(path.join(FRONTEND_DIR, 'sitemap.xml'), 'utf8');

const htmlFiles = fs
    .readdirSync(FRONTEND_DIR)
    .filter((name) => name.endsWith('.html'))
    .sort();

/** Every `<loc>` value in the sitemap. */
const locations = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (m) => m[1]);

/** The page name at the end of each `<loc>`. */
const sitemapPages = locations.map((loc) => loc.split('/').pop());

/** Every `Disallow:` path in robots.txt, deduplicated. */
const disallowed = new Set(
    Array.from(robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm), (m) => m[1])
);

describe('robots.txt', () => {
    test('declares each user agent exactly once', () => {
        const agents = Array.from(
            robots.matchAll(/^User-agent:\s*(\S+)\s*$/gm),
            (m) => m[1]
        );

        // A crawler applies the first group matching its name and ignores every
        // later one, so a second group is not additive -- it is dead.
        expect(agents.length).toBe(new Set(agents).size);
    });

    test('advertises exactly one sitemap', () => {
        const sitemaps = Array.from(
            robots.matchAll(/^Sitemap:\s*(\S+)\s*$/gm),
            (m) => m[1]
        );

        expect(sitemaps).toEqual([`${SITE_ORIGIN}/sitemap.xml`]);
    });

    test('is not a duplicate of itself', () => {
        // The whole file was concatenated with a second copy. The header
        // comment appearing twice is the cheapest way to say "this happened
        // again".
        const headers = robots.match(/^# frontend\/robots\.txt$/gm) || [];
        expect(headers.length).toBe(1);
    });

    test('disallows every page the sitemap generator excludes', () => {
        const missing = Array.from(EXCLUDED).filter(
            (page) => !disallowed.has(`/${page}`)
        );

        expect(missing).toEqual([]);
    });
});

describe('sitemap.xml', () => {
    test('is what the generator produces', () => {
        // Same comparison `node scripts/generate-sitemap.js --check` makes, so
        // a page added without regenerating fails here as well as in CI.
        //
        // <lastmod> is excluded on both sides: it comes from each page's last
        // commit, so inside the commit that edits a page the file on disk and
        // the generator can never agree. See the note in the generator.
        expect(withoutLastmod(sitemap)).toBe(
            withoutLastmod(renderSitemap(collectPages()))
        );
    });

    test('lists every public page', () => {
        const expected = htmlFiles.filter((name) => !EXCLUDED.has(name));

        expect(sitemapPages.sort()).toEqual(expected.sort());
    });

    test('includes the product and compare pages', () => {
        // The two ordinary shopper-facing pages the hand-written file had lost.
        expect(sitemapPages).toContain('product.html');
        expect(sitemapPages).toContain('compare.html');
    });

    test('lists nothing robots.txt disallows', () => {
        const contradictions = sitemapPages.filter((page) =>
            disallowed.has(`/${page}`)
        );

        expect(contradictions).toEqual([]);
    });

    test('uses one host, the canonical one', () => {
        const hosts = new Set(locations.map((loc) => new URL(loc).origin));

        expect(Array.from(hosts)).toEqual([SITE_ORIGIN]);
    });

    test('gives every entry a lastmod and a priority', () => {
        const entries = sitemap.match(/<url>[\s\S]*?<\/url>/g) || [];

        expect(entries.length).toBe(locations.length);

        for (const entry of entries) {
            expect(entry).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
            expect(entry).toMatch(/<priority>\d\.\d<\/priority>/);
        }
    });
});

describe('canonical tags', () => {
    const withCanonical = htmlFiles.filter((name) =>
        fs.readFileSync(path.join(FRONTEND_DIR, name), 'utf8').includes('rel="canonical"')
    );

    test('every page in the sitemap has one', () => {
        const missing = sitemapPages.filter((page) => !withCanonical.includes(page));

        expect(missing).toEqual([]);
    });

    test('every canonical points at the one host', () => {
        const wrongHost = [];

        for (const name of withCanonical) {
            const source = fs.readFileSync(path.join(FRONTEND_DIR, name), 'utf8');

            for (const match of source.matchAll(/rel="canonical"\s+href="([^"]+)"/g)) {
                if (!match[1].startsWith(`${SITE_ORIGIN}/`)) {
                    wrongHost.push(`${name}: ${match[1]}`);
                }
            }
        }

        // 404.html pointed at https://www.bhuvansh.xyz while everything else
        // pointed here.
        expect(wrongHost).toEqual([]);
    });

    test('each canonical names its own page', () => {
        const mismatched = [];

        for (const name of withCanonical) {
            const source = fs.readFileSync(path.join(FRONTEND_DIR, name), 'utf8');
            const match = /rel="canonical"\s+href="([^"]+)"/.exec(source);

            if (match && match[1].split('/').pop() !== name) {
                mismatched.push(`${name}: ${match[1]}`);
            }
        }

        expect(mismatched).toEqual([]);
    });
});

describe('vercel.json robots headers', () => {
    const config = JSON.parse(
        fs.readFileSync(path.join(FRONTEND_DIR, 'vercel.json'), 'utf8')
    );

    /** Every header rule that sets x-robots-tag, as [source, value] pairs. */
    const robotsRules = config.headers
        .map((rule) => [
            rule.source,
            (rule.headers.find((h) => h.key === 'x-robots-tag') || {}).value
        ])
        .filter(([, value]) => value !== undefined);

    test('does not set a blanket index directive', () => {
        // Vercel applies every matching rule, so a catch-all `index, follow`
        // was served alongside the per-page `noindex` on the private pages.
        // Crawlers happen to resolve that to the more restrictive value, but
        // the config should say what it means rather than rely on the
        // tie-break.
        const catchAll = robotsRules.filter(([source]) => source === '/(.*)');

        expect(catchAll).toEqual([]);
    });

    test('marks every excluded page noindex', () => {
        const marked = new Set(
            robotsRules
                .filter(([, value]) => value.includes('noindex'))
                .map(([source]) => source.replace(/^\//, ''))
        );

        const missing = Array.from(EXCLUDED).filter((page) => !marked.has(page));

        expect(missing).toEqual([]);
    });

    test('marks nothing the sitemap submits', () => {
        const marked = robotsRules
            .filter(([, value]) => value.includes('noindex'))
            .map(([source]) => source.replace(/^\//, ''));

        const contradictions = marked.filter((page) => sitemapPages.includes(page));

        expect(contradictions).toEqual([]);
    });
});
