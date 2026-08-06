// backend/tests/a11yLandmarks.test.js
//
// Structural accessibility, held page by page (#1447).
//
// Before this, across all twenty-nine pages in frontend/:
//
//   <main> landmark      0 / 29
//   skip link            0 / 29
//   <h1>                 4 / 29
//
// The header and its navigation are injected into every page by
// scripts/components.js, so a keyboard or screen reader user had no way past
// them: no bypass link (WCAG 2.4.1), no landmark to jump to (1.3.1), and on
// twenty-five pages no heading saying which page they were on (2.4.6).
//
// scripts/check-a11y-landmarks.js holds the rules; this suite runs it over
// every page so the failure arrives with the rest of the test output, and adds
// the checks that are about *this* codebase rather than about HTML in general.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');
const STYLES_DIR = path.join(FRONTEND_DIR, 'styles');

const { auditPage } = require(
    path.join(REPO_ROOT, 'scripts', 'check-a11y-landmarks.js')
);

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

    test.each(pages)('%s passes the landmark check', (name) => {
        expect(auditPage(read(name))).toEqual([]);
    });

    test.each(pages)('%s puts the skip link before the navigation', (name) => {
        const source = read(name);

        const link = source.indexOf('skip-link');
        const navbar = source.indexOf('id="navbar"');

        // copywriter-demo.html has no shared navbar; the link still has to be
        // there, which the landmark check above already asserts.
        if (navbar === -1) return;

        expect(link).toBeGreaterThan(-1);
        expect(link).toBeLessThan(navbar);
    });

    test.each(pages)('%s puts its content inside the main landmark', (name) => {
        const source = read(name);

        const main = source.indexOf('<main');
        const closing = source.indexOf('</main>');

        expect(main).toBeGreaterThan(-1);
        expect(closing).toBeGreaterThan(main);

        // Something has to be in there. A landmark wrapping nothing satisfies
        // a regex and helps no one.
        const content = source.slice(source.indexOf('>', main) + 1, closing).trim();
        expect(content.length).toBeGreaterThan(50);
    });

    test.each(pages)('%s puts its h1 inside the main landmark', (name) => {
        const source = read(name);

        const heading = source.indexOf('<h1');
        const main = source.indexOf('<main');
        const closing = source.indexOf('</main>');

        expect(heading).toBeGreaterThan(main);
        expect(heading).toBeLessThan(closing);
    });
});

describe('skip link styling', () => {
    const base = fs.readFileSync(path.join(STYLES_DIR, 'base.css'), 'utf8');

    test('is defined in base.css', () => {
        expect(base).toMatch(/\.skip-link\s*\{/);
        expect(base).toMatch(/\.skip-link:focus/);
    });

    test('is hidden by position, not by display or visibility', () => {
        // display:none and visibility:hidden both remove an element from the
        // tab order, which is the one thing a skip link must stay in.
        const rule = /\.skip-link\s*\{([^}]*)\}/.exec(base);

        expect(rule).not.toBeNull();
        expect(rule[1]).not.toMatch(/display\s*:\s*none/);
        expect(rule[1]).not.toMatch(/visibility\s*:\s*hidden/);
        expect(rule[1]).toMatch(/position\s*:\s*absolute/);
    });

    test('the focus target has its outline suppressed', () => {
        // <main> is a focus destination, not a control. Every real control
        // still gets a ring from the :focus-visible rule.
        expect(base).toMatch(/#main-content:focus\s*\{[^}]*outline\s*:\s*none/);
    });

    test('base.css defines the visually-hidden helper the headings use', () => {
        const usesHelper = pages.filter((name) =>
            /<h1[^>]*class="[^"]*\bvisually-hidden\b/.test(read(name))
        );

        expect(usesHelper.length).toBeGreaterThan(0);
        expect(base).toMatch(/\.visually-hidden\s*\{/);
        expect(base).toMatch(/clip-path\s*:\s*inset\(50%\)/);
    });

    test('every page that uses the helper also loads base.css', () => {
        const missing = pages.filter((name) => {
            const source = read(name);
            const needsHelper = /class="[^"]*\bvisually-hidden\b/.test(source);
            return needsHelper && !source.includes('base.css');
        });

        expect(missing).toEqual([]);
    });

    test('the one page without base.css carries its own skip-link rule', () => {
        // copywriter-demo.html does not use the shared shell, so its skip link
        // would otherwise render as a visible link at the top of the page.
        const standalone = pages.filter((name) => !read(name).includes('base.css'));

        for (const name of standalone) {
            expect(read(name)).toMatch(/\.skip-link\s*\{/);
        }
    });
});
