// backend/tests/recentlyViewed.test.js
//
// Recently Viewed (#1497), driven for real in jsdom.
//
// The defects here cannot be asserted by reading the source, so they are not:
// what matters is what ends up in localStorage and what ends up in the DOM.
//
//   1. `frontend/scripts/recentlyViewed.js` was a `type="module"` script that
//      imported nine named bindings from `utils.js`. utils.js has no `export`
//      statement anywhere -- it is a classic script assigning
//      `window.AppUtils` -- and two of the nine, `safeText` and `safePrice`,
//      do not exist in it under any spelling. The import failed at module
//      resolution, so the file never ran and the homepage section never
//      rendered. home-init.js calls `loadRecentlyViewed` behind a
//      `typeof === "function"` guard, which is why it was silent.
//   2. Three writers, two shapes. The reader expected a third.
//   3. Both object writers deduplicated with `Number(item.id) !==
//      Number(product.id)`. `products.id` is a UUID, `Number(uuid)` is NaN,
//      `NaN !== NaN` is true -- so the filter never removed anything, for any
//      product. Combined with product.js calling its writer twice from
//      adjacent lines and product-render.js writing on render, one page view
//      stored three copies.
//
// (3) is the one worth reading the tests for. It is not "sometimes wrong": no
// UUID converts to a number, so deduplication was off for 100% of products.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'frontend', 'scripts');

const STORE_JS = fs.readFileSync(
    path.join(SCRIPTS, 'recently-viewed-store.js'),
    'utf8'
);

const UUID_A = '3f2a4c10-1111-4b22-8c33-0123456789ab';
const UUID_B = 'a1b2c3d4-2222-4e55-9f66-fedcba987654';
const UUID_C = 'deadbeef-3333-4777-8888-0f0f0f0f0f0f';

/**
 * A page with the store loaded and nothing else.
 *
 * @param {object} [options]
 * @param {*} [options.seed] - what is already in localStorage
 * @param {string|null} [options.token] - a signed-in shopper's token
 * @param {Function} [options.apiRequest]
 * @returns {object}
 */
function mountStore({ seed, token = null, apiRequest } = {}) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'https://shop.example/index.html',
        runScripts: 'outside-only'
    });

    const { window } = dom;

    if (seed !== undefined) {
        window.localStorage.setItem('recentlyViewed', JSON.stringify(seed));
    }

    const requests = [];

    window.AppUtils = {
        getJSON: (key, fallback) => {
            try {
                const raw = window.localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (error) {
                return fallback;
            }
        },
        setJSON: (key, value) => {
            window.localStorage.setItem(key, JSON.stringify(value));
        },
        getToken: () => token,
        apiRequest: (url, options) => {
            requests.push({ url, options });
            return apiRequest
                ? apiRequest(url, options)
                : Promise.resolve({ success: true, data: [] });
        }
    };

    window.eval(STORE_JS);

    return {
        window,
        store: window.RecentlyViewed,
        requests,
        stored: () => JSON.parse(window.localStorage.getItem('recentlyViewed') || '[]')
    };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe('the dedupe that never fired', () => {
    test('Number() on a UUID is why', () => {
        // Not a claim about the store -- a claim about the predicate the two
        // writers used. It is here so the reason is pinned, not only the fix.
        expect(Number(UUID_A)).toBeNaN();
        expect(Number(UUID_A) !== Number(UUID_A)).toBe(true);
    });

    test('recording the same product twice leaves one entry', () => {
        const { store, stored } = mountStore();

        store.record({ id: UUID_A, name: 'Classic Tee', price: 799 });
        store.record({ id: UUID_A, name: 'Classic Tee', price: 799 });

        expect(stored()).toHaveLength(1);
    });

    test('recording it three times still leaves one', () => {
        // product.js called its writer twice from adjacent lines and
        // product-render.js wrote again during render, so this was the real
        // sequence for one page view.
        const { store, stored } = mountStore();

        store.record({ id: UUID_A, name: 'Classic Tee' });
        store.record({ id: UUID_A, name: 'Classic Tee' });
        store.record({ id: UUID_A, name: 'Classic Tee' });

        expect(stored()).toHaveLength(1);
    });

    test('a repeat view moves the product to the front', () => {
        const { store, stored } = mountStore();

        store.record({ id: UUID_A, name: 'A' });
        store.record({ id: UUID_B, name: 'B' });
        store.record({ id: UUID_A, name: 'A' });

        expect(stored().map((entry) => entry.id)).toEqual([UUID_A, UUID_B]);
    });

    test('ids are compared as strings, so a numeric id still dedupes', () => {
        const { store, stored } = mountStore();

        store.record({ id: 42, name: 'A' });
        store.record({ id: '42', name: 'A' });

        expect(stored()).toHaveLength(1);
    });

    test('three views of three products keep all three', () => {
        // With the broken dedupe and three writes per view, the list held
        // three copies of the most recent product and nothing else.
        const { store, stored } = mountStore();

        store.record({ id: UUID_A, name: 'A' });
        store.record({ id: UUID_B, name: 'B' });
        store.record({ id: UUID_C, name: 'C' });

        expect(stored().map((entry) => entry.id)).toEqual([UUID_C, UUID_B, UUID_A]);
    });
});

// ---------------------------------------------------------------------------
// One shape, whatever is already there
// ---------------------------------------------------------------------------

describe('reading what older builds left behind', () => {
    test('bare id strings are kept rather than discarded', () => {
        // That is what trackRecentlyViewed wrote and what the homepage reader
        // expected. A browser may still hold it, and a bare id is still a
        // product somebody looked at -- it just cannot render a card on its
        // own, so it is marked partial and the reader fills it in.
        const { store } = mountStore({ seed: [UUID_A, UUID_B] });

        const entries = store.list();

        expect(entries).toHaveLength(2);
        expect(entries[0].id).toBe(UUID_A);
        expect(entries[0].partial).toBe(true);
    });

    test('a mixed array is normalised, not rejected', () => {
        const { store } = mountStore({
            seed: [UUID_A, { id: UUID_B, name: 'B', price: 10 }]
        });

        const entries = store.list();

        expect(entries.map((entry) => entry.id)).toEqual([UUID_A, UUID_B]);
        expect(entries[1].partial).toBe(false);
    });

    test('duplicates left by the broken dedupe are collapsed on read', () => {
        const { store } = mountStore({
            seed: [
                { id: UUID_A, name: 'A' },
                { id: UUID_A, name: 'A' },
                { id: UUID_A, name: 'A' }
            ]
        });

        expect(store.list()).toHaveLength(1);
    });

    test('junk in the key reads as empty rather than throwing', () => {
        const { window, store } = mountStore();

        window.localStorage.setItem('recentlyViewed', 'not json');

        expect(store.list()).toEqual([]);
    });

    test('a non-array value reads as empty', () => {
        const { store } = mountStore({ seed: { id: UUID_A } });

        expect(store.list()).toEqual([]);
    });

    test('entries with no usable id are dropped', () => {
        const { store } = mountStore({
            seed: [{ name: 'no id' }, null, '', { id: '   ' }, { id: UUID_A, name: 'A' }]
        });

        expect(store.list().map((entry) => entry.id)).toEqual([UUID_A]);
    });
});

// ---------------------------------------------------------------------------
// One cap
// ---------------------------------------------------------------------------

describe('the cap', () => {
    test('is one number, not 8 in one file and 10 in another', () => {
        const { store, stored } = mountStore();

        for (let i = 0; i < 20; i += 1) {
            store.record({ id: `${UUID_A.slice(0, -2)}${String(i).padStart(2, '0')}`, name: `P${i}` });
        }

        expect(stored()).toHaveLength(store.MAX_ENTRIES);
    });

    test('keeps the most recent', () => {
        const { store } = mountStore();

        for (let i = 0; i < 12; i += 1) {
            store.record({ id: `id-${i}`, name: `P${i}` });
        }

        expect(store.list()[0].id).toBe('id-11');
    });
});

// ---------------------------------------------------------------------------
// The server side that had no caller
// ---------------------------------------------------------------------------

describe('syncing to the account', () => {
    test('a signed-out shopper touches no endpoint', () => {
        const { store, requests } = mountStore({ token: null });

        store.record({ id: UUID_A, name: 'A' });

        expect(requests).toEqual([]);
    });

    test('a signed-in shopper records the view server-side', () => {
        const { store, requests } = mountStore({ token: 'jwt' });

        store.record({ id: UUID_A, name: 'A' });

        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe('/recently-viewed');
        expect(JSON.parse(requests[0].options.body)).toEqual({ productId: UUID_A });
    });

    test('a failed sync does not lose the local entry', () => {
        // Recently-viewed is a convenience. A sync failure must never surface
        // to a shopper or undo what the browser already knows.
        const { store, stored } = mountStore({
            token: 'jwt',
            apiRequest: () => Promise.reject(new Error('offline'))
        });

        store.record({ id: UUID_A, name: 'A' });

        expect(stored()).toHaveLength(1);
    });

    test('hydrate merges the account history with what this browser has', async () => {
        const now = Date.now();

        const { store } = mountStore({
            token: 'jwt',
            seed: [{ id: UUID_A, name: 'Local', viewedAt: now - 1000 }],
            apiRequest: () =>
                Promise.resolve({
                    success: true,
                    data: [{ id: UUID_B, name: 'Remote', viewedAt: now - 5000 }]
                })
        });

        const merged = await store.hydrate();

        // A shopper who browsed signed out and then signed in should not lose
        // what they were looking at, so this merges rather than replacing.
        expect(merged.map((entry) => entry.id)).toEqual([UUID_A, UUID_B]);
    });

    test('an entry older than the retention window is dropped on read', async () => {
        // Thirty days. A product somebody looked at last spring is not
        // "recently viewed", and without this the list is only ever trimmed by
        // the cap.
        const { store } = mountStore({
            seed: [
                { id: UUID_A, name: 'Old', viewedAt: 1000 },
                { id: UUID_B, name: 'New', viewedAt: Date.now() }
            ]
        });

        expect(store.list().map((entry) => entry.id)).toEqual([UUID_B]);
    });

    test('hydrate does nothing when signed out', async () => {
        const { store, requests } = mountStore({
            token: null,
            seed: [{ id: UUID_A, name: 'Local' }]
        });

        const result = await store.hydrate();

        expect(requests).toEqual([]);
        expect(result).toHaveLength(1);
    });

    test('hydrate survives a failing endpoint', async () => {
        const { store } = mountStore({
            token: 'jwt',
            seed: [{ id: UUID_A, name: 'Local' }],
            apiRequest: () => Promise.reject(new Error('500'))
        });

        await expect(store.hydrate()).resolves.toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

describe('the homepage carousel', () => {
    const RECENTLY_VIEWED_JS = fs.readFileSync(
        path.join(SCRIPTS, 'recentlyViewed.js'),
        'utf8'
    );

    /**
     * The homepage section, with the store and the renderer loaded.
     */
    function mountCarousel({ seed, token = null, apiRequest } = {}) {
        const harness = mountStore({ seed, token, apiRequest });

        harness.window.document.body.innerHTML =
            '<div id="recently-viewed-container"></div>';

        harness.window.AppUtils.escapeHTML = (value) =>
            String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        harness.window.AppUtils.formatPrice = (value) => `₹${value}`;
        harness.window.AppUtils.defaultImage = (value) => value || '/placeholder.png';
        harness.window.AppUtils.renderSkeletonState = () => {};

        harness.window.eval(RECENTLY_VIEWED_JS);

        harness.container = harness.window.document.getElementById(
            'recently-viewed-container'
        );

        return harness;
    }

    test('it loads at all', () => {
        // The regression. As a module importing from a file with no exports,
        // this script never executed and never assigned the global -- and the
        // only caller checks `typeof === "function"` first, so nothing failed
        // loudly.
        const { window } = mountCarousel();

        expect(typeof window.loadRecentlyViewed).toBe('function');
    });

    test('it renders the products the writers stored', async () => {
        const { window, container } = mountCarousel({
            seed: [
                { id: UUID_A, name: 'Classic Tee', price: 799, image: '/a.png' },
                { id: UUID_B, name: 'Denim Jacket', price: 2499, image: '/b.png' }
            ]
        });

        await window.loadRecentlyViewed();

        expect(container.querySelectorAll('.pro')).toHaveLength(2);
        expect(container.textContent).toContain('Classic Tee');
        expect(container.textContent).toContain('Denim Jacket');
    });

    test('it issues no request when the entries already carry their fields', async () => {
        // It used to fetch every entry by id on every homepage load, to
        // recover data the writers had already stored.
        const { window, requests } = mountCarousel({
            seed: [{ id: UUID_A, name: 'Classic Tee', price: 799 }]
        });

        await window.loadRecentlyViewed();

        expect(requests).toEqual([]);
    });

    test('it fetches only the id-only entries an older build left', async () => {
        const { window, requests, container } = mountCarousel({
            seed: [UUID_A, { id: UUID_B, name: 'Denim Jacket', price: 2499 }],
            apiRequest: (url) =>
                Promise.resolve({
                    success: true,
                    product: { id: UUID_A, name: 'Fetched Tee', price: 799 }
                })
        });

        await window.loadRecentlyViewed();

        const productRequests = requests.filter((request) =>
            request.url.startsWith('/products/')
        );

        expect(productRequests).toHaveLength(1);
        expect(productRequests[0].url).toContain(UUID_A);
        expect(container.textContent).toContain('Fetched Tee');
        expect(container.textContent).toContain('Denim Jacket');
    });

    test('an object in the key never reaches a URL', async () => {
        // The reader read the key as ids and interpolated each into
        // `/products/${id}`. With objects in there that was
        // `/products/[object Object]`, which the uuid guard answers 400 to --
        // so every card failed and the section said "No recently viewed
        // products available."
        const { window, requests } = mountCarousel({
            seed: [{ id: UUID_A, name: 'Classic Tee', price: 799 }]
        });

        await window.loadRecentlyViewed();

        for (const request of requests) {
            expect(request.url).not.toContain('[object');
        }
    });

    test('it says so when there is nothing to show', async () => {
        const { window, container } = mountCarousel({ seed: [] });

        await window.loadRecentlyViewed();

        expect(container.textContent).toContain('No recently viewed products yet');
    });

    test('a product name is escaped before it reaches the DOM', async () => {
        const { window, container } = mountCarousel({
            seed: [{ id: UUID_A, name: '<img src=x onerror=alert(1)>', price: 1 }]
        });

        await window.loadRecentlyViewed();

        expect(container.querySelector('img[onerror]')).toBeNull();
    });

    test('an entry with no stock figure is not rendered as sold out', async () => {
        // The old check was `Number(stock) === 0`, which reads a missing
        // figure as in stock and a null one as sold out. A stored entry may
        // carry no stock at all, and unknown is not sold out.
        const { window, container } = mountCarousel({
            seed: [{ id: UUID_A, name: 'Classic Tee', price: 799 }]
        });

        await window.loadRecentlyViewed();

        expect(container.querySelector('.out-of-stock-overlay')).toBeNull();
        expect(container.querySelector('.stock-badge')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// One writer
// ---------------------------------------------------------------------------

describe('the key has one owner', () => {
    const WRITERS = [
        'product.js',
        'product-render.js',
        'related-products.js',
        'recentlyViewed.js'
    ];

    test.each(WRITERS)('%s does not write the key directly', (name) => {
        const source = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');

        // Comments in these files quote the old code while explaining it.
        const code = source
            .split('\n')
            .map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? '' : line))
            .join('\n');

        expect(code).not.toMatch(/setJSON\(\s*["']recentlyViewed["']/);
        expect(code).not.toMatch(/localStorage\.setItem\(\s*["']recentlyViewed["']/);
    });

    test.each(WRITERS)('%s compares no id with Number()', (name) => {
        const source = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');

        const code = source
            .split('\n')
            .map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? '' : line))
            .join('\n')
            // Collapse whitespace: product-render.js puts every argument on
            // its own line, so the comparison spans eight of them.
            .replace(/\s+/g, ' ');

        expect(code).not.toMatch(/Number\(\s*item\.id\s*\)/);
    });

    test('no page loads recentlyViewed.js as a module', () => {
        // utils.js has no exports, so a module importing from it is discarded
        // before it runs.
        const pages = fs
            .readdirSync(path.join(REPO_ROOT, 'frontend'))
            .filter((name) => name.endsWith('.html'));

        const offenders = [];

        for (const page of pages) {
            const html = fs.readFileSync(path.join(REPO_ROOT, 'frontend', page), 'utf8');

            for (const tag of html.match(/<script[^>]*>/g) || []) {
                if (/type\s*=\s*["']module["']/.test(tag) && /scripts\//.test(tag)) {
                    offenders.push(`${page}: ${tag.replace(/\s+/g, ' ')}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    test('every page that reads or writes the key loads the store first', () => {
        const pages = ['index.html', 'product.html'];

        for (const page of pages) {
            const html = fs.readFileSync(path.join(REPO_ROOT, 'frontend', page), 'utf8');

            const storeAt = html.indexOf('recently-viewed-store.js');
            expect(storeAt).toBeGreaterThan(-1);

            for (const consumer of ['recentlyViewed.js', 'product-render.js', 'product.js']) {
                const at = html.indexOf(`scripts/${consumer}`);
                if (at === -1) continue;

                expect(storeAt).toBeLessThan(at);
            }
        }
    });
});
