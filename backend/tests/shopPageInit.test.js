// backend/tests/shopPageInit.test.js
//
// The shop page, booted for real in jsdom (#1582).
//
// The merge in 341fb57 took one side of frontend/scripts/shop.js whole and lost
// fourteen function declarations from the other, while every call site for them
// survived. The first one reached was `setupProductObserver`, called by
// `fetchProducts` before it touches the network, so:
//
//   * both DOMContentLoaded handlers threw a ReferenceError,
//   * `/api/products` was never requested at all, and
//   * `#product-container` stayed empty on every visit to the shop.
//
// None of that is visible to any gate we have. The file parses, so check:syntax
// passes; it is frontend, so check:boot and check:modules never load it; and a
// ReferenceError inside an event listener is not a page-level failure, so the
// HTML still renders -- just with no products in it.
//
// That is why this suite drives the page rather than grepping the source. It
// loads the real shop.html, the real shop-filter-utils.js and the real shop.js,
// fires DOMContentLoaded, and asks what actually happened: did it fetch, did it
// render, how many times, and does the Clear Filters button follow the filters.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');

const SHOP_HTML = fs.readFileSync(path.join(FRONTEND, 'shop.html'), 'utf8');
const SHOP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'shop.js'), 'utf8');
const FILTER_UTILS_JS = fs.readFileSync(
    path.join(FRONTEND, 'scripts', 'shop-filter-utils.js'),
    'utf8'
);

/**
 * A catalogue page, shaped the way /api/products answers.
 *
 * `category` rather than `category_id`: `ShopFilterUtils.getProductCategory`
 * reads `product.category`, and that is the contract this page filters by.
 */
const catalogue = () => [
    { id: '1', name: 'Linen Shirt', price: 1200, image: 'a.png', category: 'Shirts', stock: 4, rating: 4.5, num_reviews: 12 },
    { id: '2', name: 'Denim Jacket', price: 3400, image: 'b.png', category: 'Jackets', stock: 0, rating: 4.0, num_reviews: 3 },
    { id: '3', name: 'Cotton Hoodie', price: 2100, image: 'c.png', category: 'Hoodies', stock: 9, rating: 3.5, num_reviews: 7 },
    { id: '4', name: 'Oxford Shirt', price: 1800, image: 'd.png', category: 'Shirts', stock: 2, rating: 5.0, num_reviews: 21 },
];

/** Let the debounce, the awaited fetch and the render settle. */
const settle = async (dom, ms = 600) => {
    await new Promise((resolve) => dom.window.setTimeout(resolve, ms));
    await new Promise((resolve) => setImmediate(resolve));
};

/**
 * Load the real shop page and fire DOMContentLoaded.
 *
 * @param {object} [options]
 * @param {Array} [options.products] what /api/products answers with.
 * @returns {object} handles onto the page and what it did.
 */
const mountShop = async ({ products = catalogue() } = {}) => {
    const dom = new JSDOM(SHOP_HTML, {
        url: 'http://localhost:5500/shop.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });

    const { window } = dom;
    const requests = [];
    const errors = [];

    window.addEventListener('error', (event) => errors.push(event.message));

    // utils.js is a browser script with its own load-time side effects, so the
    // slice of it this page depends on is stood in for rather than imported.
    const escapeHTML = (value) =>
        String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

    window.escapeHTML = escapeHTML;
    window.AppUtils = {
        escapeHTML,
        apiRequest: async (url) => {
            requests.push(url);
            return { success: true, products, totalPages: 1, hasNextPage: false };
        },
        safeArray: (value) => (Array.isArray(value) ? value : []),
        safeInteger: (value, fallback) => Number(value) || fallback,
        getJSON: (_key, fallback) => fallback,
        setJSON: () => {},
        formatPrice: (value) => `₹${value}`,
        defaultImage: (value) => value || 'placeholder.png',
        notify: () => {},
        getWishlist: () => [],
        saveWishlist: () => {},
        getToken: () => null,
        getCart: () => [],
        saveCart: () => {},
        renderSkeletonState: () => {},
    };

    window.CONFIG = { API_BASE: 'http://localhost:5000/api', PRODUCTS_PER_PAGE: 12 };

    // The sentinel is watched, never scrolled into view here, so a stub that
    // records nothing is enough -- and its absence would make shop.js skip
    // observer setup entirely, which is the path being tested.
    window.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; }
        observe() {}
        unobserve() {}
        disconnect() {}
    };

    window.eval(FILTER_UTILS_JS);
    window.eval(SHOP_JS);

    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
    await settle(dom);

    const $ = (selector) => window.document.querySelector(selector);

    return {
        dom,
        window,
        document: window.document,
        requests,
        errors,
        $,
        cards: () => window.document.querySelectorAll('#product-container .pro'),
        clearButton: () => window.document.getElementById('clear-filters'),
        search: async (term) => {
            const input = window.document.getElementById('search-input');
            input.value = term;
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
            await settle(dom);
        },
    };
};

// ---------------------------------------------------------------------------
// The page boots
// ---------------------------------------------------------------------------

describe('booting the shop page', () => {
    test('throws nothing', async () => {
        // This is the whole bug in one assertion. Before the fix this was
        // ["setupProductObserver is not defined", "showSearchSuggestions is
        // not defined"] and everything below followed from it.
        const shop = await mountShop();

        expect(shop.errors).toEqual([]);
    });

    test('requests the catalogue', async () => {
        const shop = await mountShop();

        expect(shop.requests.length).toBeGreaterThan(0);
        expect(shop.requests[0]).toMatch(/^\/products\?/);
    });

    test('requests it exactly once', async () => {
        // Two DOMContentLoaded handlers each called fetchProducts(). Had they
        // not thrown first, every visit would have fetched and rendered twice.
        const shop = await mountShop();

        expect(shop.requests).toHaveLength(1);
    });

    test('renders a card per product', async () => {
        const shop = await mountShop();

        expect(shop.cards()).toHaveLength(4);
    });

    test('builds the category filter list from what came back', async () => {
        const shop = await mountShop();

        const values = Array.from(
            shop.document.querySelectorAll('input[name="category-filter"]')
        ).map((input) => input.value).sort();

        expect(values).toEqual(['Hoodies', 'Jackets', 'Shirts']);
    });

    test('puts a sentinel in the page for infinite scroll', async () => {
        const shop = await mountShop();

        expect(shop.document.getElementById('product-scroll-sentinel')).not.toBeNull();
    });

    test('falls back to the bundled catalogue when the API returns nothing', async () => {
        const shop = await mountShop({ products: [] });

        expect(shop.errors).toEqual([]);
        expect(shop.cards().length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe('filtering the catalogue', () => {
    test('a search narrows the grid', async () => {
        const shop = await mountShop();
        expect(shop.cards()).toHaveLength(4);

        await shop.search('Oxford');

        expect(shop.cards()).toHaveLength(1);
        expect(shop.errors).toEqual([]);
    });

    test('clearing the search restores the grid', async () => {
        const shop = await mountShop();

        await shop.search('Oxford');
        await shop.search('');

        expect(shop.cards()).toHaveLength(4);
    });

    test('a search that matches nothing renders the empty state, not a crash', async () => {
        const shop = await mountShop();

        await shop.search('there is no such product');

        expect(shop.cards()).toHaveLength(0);
        expect(shop.errors).toEqual([]);
    });

    test('ticking a category narrows the grid', async () => {
        const shop = await mountShop();

        const shirts = Array.from(
            shop.document.querySelectorAll('input[name="category-filter"]')
        ).find((input) => input.value === 'Shirts');

        shirts.checked = true;
        shirts.dispatchEvent(new shop.window.Event('change', { bubbles: true }));
        await settle(shop.dom);

        expect(shop.cards()).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// The Clear Filters button (#1124)
// ---------------------------------------------------------------------------

describe('the Clear Filters button', () => {
    test('is in the page under the id the script looks for', () => {
        // It used to be resolved as `#clear-filters-btn`, which is the button's
        // class. Pinning both halves so they cannot drift apart again.
        expect(SHOP_HTML).toMatch(/id="clear-filters"/);
        expect(SHOP_JS).not.toMatch(/getElementById\(['"]clear-filters-btn['"]\)/);
    });

    test('the sort select is resolved by the id the page actually uses', () => {
        expect(SHOP_HTML).toMatch(/id="product-sort"/);
        expect(SHOP_JS).not.toMatch(/getElementById\(['"]sort-select['"]\)/);
    });

    test('is hidden on a page with no filters applied', async () => {
        const shop = await mountShop();

        expect(shop.clearButton().style.display).toBe('none');
        expect(shop.clearButton().classList.contains('show')).toBe(false);
    });

    test('appears once a search is active', async () => {
        const shop = await mountShop();

        await shop.search('Shirt');

        expect(shop.clearButton().style.display).toBe('inline-flex');
        expect(shop.clearButton().classList.contains('show')).toBe(true);
    });

    test('goes away again when the search is cleared', async () => {
        const shop = await mountShop();

        await shop.search('Shirt');
        await shop.search('');

        expect(shop.clearButton().style.display).toBe('none');
    });

    test('clicking it empties the search and restores the grid', async () => {
        const shop = await mountShop();

        await shop.search('Oxford');
        expect(shop.cards()).toHaveLength(1);

        shop.clearButton().click();
        await settle(shop.dom);

        expect(shop.document.getElementById('search-input').value).toBe('');
        expect(shop.cards()).toHaveLength(4);
        expect(shop.clearButton().style.display).toBe('none');
    });

    test('does not treat the default sort as an active filter', async () => {
        // The old check compared the sort against 'default', which is not one
        // of the select's options -- so on a page with nothing filtered it
        // reported a filter active.
        const shop = await mountShop();

        expect(shop.document.getElementById('product-sort').value).toBe('newest');
        expect(shop.clearButton().style.display).toBe('none');
    });
});

// ---------------------------------------------------------------------------
// The shape of the file, so the merge cannot reoccur quietly
// ---------------------------------------------------------------------------

describe('shop.js has one of each', () => {
    test('one DOMContentLoaded initialiser', () => {
        const handlers = SHOP_JS.match(/addEventListener\(\s*\n?\s*["']DOMContentLoaded["']/g) || [];

        expect(handlers).toHaveLength(1);
    });

    test('no function is declared twice', () => {
        // `setupSearch` was declared twice, ~250 lines apart. Declarations
        // hoist, so the second silently replaced the first and the first
        // became unreachable -- no error, no warning, no way to see it except
        // by counting.
        const counts = new Map();

        for (const match of SHOP_JS.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) {
            counts.set(match[1], (counts.get(match[1]) || 0) + 1);
        }

        const duplicated = [...counts.entries()]
            .filter(([, count]) => count > 1)
            .map(([name]) => name);

        expect(duplicated).toEqual([]);
    });

    test('every function it calls is a function it declares', () => {
        // The general form of the bug. Anything called and not declared here
        // has to be either a browser global or one of the guarded cross-script
        // helpers below, and those are checked with `typeof` at the call site.
        const declared = new Set();

        for (const match of SHOP_JS.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) {
            declared.add(match[1]);
        }
        for (const match of SHOP_JS.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
            declared.add(match[1]);
        }

        const ambient = new Set([
            // Language and browser
            'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
            'new', 'else', 'do', 'await', 'async', 'of', 'in', 'this', 'try', 'class',
            'Number', 'String', 'Boolean', 'Array', 'Object', 'Math', 'JSON', 'Set',
            'Map', 'Date', 'Promise', 'Error', 'RegExp', 'parseInt', 'parseFloat',
            'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'URLSearchParams',
            'IntersectionObserver', 'requestAnimationFrame', 'setTimeout',
            'clearTimeout', 'console', 'document', 'window', 'globalThis', 'fetch',
            'localStorage', 'Event', 'CustomEvent',
            // utils.js, loaded before this script on every page that uses it
            'escapeHTML', 'addToCompare',
            // Guarded with `typeof x === "function"` at each call site
            'addToCartFromProduct', 'updateCartCount', 'renderCartDrawer',
        ]);

        // Words inside comments and template strings can look like calls, so
        // only identifiers that are also plausible function names are checked.
        const called = new Set(
            [...SHOP_JS.matchAll(/(?<![.\w$])([a-z][\w$]*)\s*\(/g)].map((match) => match[1])
        );

        const missing = [...called].filter(
            (name) => !declared.has(name) && !ambient.has(name)
        );

        // Anything left is either a genuinely missing function or a word in a
        // comment; either way it wants looking at, so the assertion names them.
        const genuine = missing.filter((name) =>
            new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(
                SHOP_JS.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
            )
        );

        expect(genuine).toEqual([]);
    });
});
