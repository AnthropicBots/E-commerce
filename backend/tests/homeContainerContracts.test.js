'use strict';

/**
 * A script that reaches for a container id no page defines fails silently:
 * getElementById returns null, the render function returns early, and the
 * section renders as a heading above blank space. Nothing throws and nothing
 * logs, so the breakage reads as "we have no data" rather than as a defect.
 *
 * These tests pin the container contract between each page and the scripts it
 * loads, so a renamed id fails here instead of quietly emptying a section.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const SCRIPTS = path.join(FRONTEND, 'scripts');

function readPage(name) {
    return fs.readFileSync(path.join(FRONTEND, name), 'utf8');
}

function readScript(name) {
    return fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
}

/** Ids declared by `id="..."` in a chunk of markup. */
function declaredIds(html) {
    return new Set([...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
}

/** Ids a script looks up via getElementById("...") or querySelector("#..."). */
function referencedIds(source) {
    const ids = new Set();

    for (const match of source.matchAll(/getElementById\(\s*["']([\w-]+)["']/g)) {
        ids.add(match[1]);
    }

    for (const match of source.matchAll(/querySelector(?:All)?\(\s*["']#([\w-]+)["']/g)) {
        ids.add(match[1]);
    }

    return ids;
}

/** `<script src="scripts/x.js">` filenames a page loads. */
function loadedScripts(html) {
    return [...html.matchAll(/src\s*=\s*["']scripts\/([\w.-]+\.js)["']/g)].map((m) => m[1]);
}

describe('product page - recently viewed container', () => {
    const productHtml = readPage('product.html');
    const relatedProducts = readScript('related-products.js');
    const productScript = readScript('product.js');

    it('defines the container the recently-viewed renderer writes into', () => {
        expect(declaredIds(productHtml).has('recently-viewed-products')).toBe(true);
    });

    it('still loads the script that renders it', () => {
        expect(loadedScripts(productHtml)).toContain('related-products.js');
    });

    it('still loads the store that records the history', () => {
        expect(loadedScripts(productHtml)).toContain('recently-viewed-store.js');
    });

    it('still calls the renderer from the product page script', () => {
        expect(productScript).toMatch(/loadRecentlyViewedRecommendations\(\)/);
    });

    it('renders into the id the page declares', () => {
        expect(relatedProducts).toMatch(/getElementById\(\s*\n?\s*"recently-viewed-products"/);
    });

    it('places the section before the recommended strip', () => {
        const recentlyViewed = productHtml.indexOf('id="recently-viewed-products"');
        const recommended = productHtml.indexOf('id="recommended-products-container"');

        expect(recentlyViewed).toBeGreaterThan(-1);
        expect(recommended).toBeGreaterThan(-1);
        expect(recentlyViewed).toBeLessThan(recommended);
    });
});

describe('home-init - new arrivals container', () => {
    const homeInit = readScript('home-init.js');
    const indexHtml = readPage('index.html');

    it('no longer reaches for the stale new-arrivals-products id', () => {
        expect(homeInit).not.toMatch(/new-arrivals-products/);
    });

    it('uses the id index.html actually declares', () => {
        expect(homeInit).toMatch(/new-arrivals-container/);
        expect(declaredIds(indexHtml).has('new-arrivals-container')).toBe(true);
    });

    it('agrees with the renderer that owns the section', () => {
        expect(readScript('product-cards-home.js')).toMatch(/new-arrivals-container/);
    });

    it('keeps the featured container it shares the page with', () => {
        expect(homeInit).toMatch(/featured-products/);
        expect(declaredIds(indexHtml).has('featured-products')).toBe(true);
    });
});

describe('container contract across the pages under test', () => {
    // Ids a page legitimately creates at runtime rather than declaring in
    // markup, and ids belonging to sibling pages a shared script also serves.
    const RUNTIME_IDS = new Set([
        'navbar',
        'footer',
        'site-header',
        'toast',
        'toast-container'
    ]);

    const PAGES = ['product.html', 'index.html'];

    for (const page of PAGES) {
        it(`${page}: every id its own render scripts target is declared somewhere reachable`, () => {
            const html = readPage(page);
            const declared = declaredIds(html);

            // Ids injected by the shared components, which the page pulls in
            // at runtime rather than declaring inline.
            for (const component of ['navbar.html', 'footer.html', 'header.html']) {
                const componentPath = path.join(FRONTEND, 'components', component);
                if (fs.existsSync(componentPath)) {
                    for (const id of declaredIds(fs.readFileSync(componentPath, 'utf8'))) {
                        declared.add(id);
                    }
                }
            }

            // Limited to the scripts this issue covers. Widening the sweep
            // would fail on unrelated pre-existing gaps and bury the guard.
            const watched = loadedScripts(html).filter((name) =>
                ['related-products.js', 'product-cards-home.js', 'home-init.js'].includes(name)
            );

            for (const scriptName of watched) {
                for (const id of referencedIds(readScript(scriptName))) {
                    if (RUNTIME_IDS.has(id)) {
                        continue;
                    }

                    expect({ page, script: scriptName, id, declared: declared.has(id) }).toEqual({
                        page,
                        script: scriptName,
                        id,
                        declared: true
                    });
                }
            }
        });
    }
});
