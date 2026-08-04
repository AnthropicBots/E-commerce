// backend/tests/navbarSearch.test.js
//
// The navbar search combobox (#1458), driven for real in jsdom.
//
// The widget is on 28 of the 29 pages and had three problems worth testing
// rather than asserting about by grep:
//
//   1. the product name went into `innerHTML` unescaped, so anything that could
//      name a product had script execution against every shopper who searched;
//   2. it was bare `<div>`s with click handlers -- no roles, no keyboard, no
//      announcement;
//   3. it filtered `window.allProducts`, which only `index.html` fills, so on
//      the other 27 pages typing did nothing at all.
//
// (1) in particular cannot be tested by looking at the source: the question is
// what ends up in the DOM, so the DOM is what the tests look at.
//
// `frontend/scripts/components.js` is loaded whole and exposes
// `window.initNavbarSearch`. Nothing in it runs on load beyond function
// declarations -- `initializeComponents()` is behind a DOMContentLoaded
// listener, and the test never fires that event.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COMPONENTS_JS = path.join(REPO_ROOT, 'frontend', 'scripts', 'components.js');
const NAVBAR_HTML = path.join(REPO_ROOT, 'frontend', 'components', 'navbar.html');

const source = fs.readFileSync(COMPONENTS_JS, 'utf8');
const navbarMarkup = fs.readFileSync(NAVBAR_HTML, 'utf8');

/** Give the debounce and the awaited fetch a chance to run. */
const settle = async (dom, ms = 400) => {
    await new Promise((resolve) => dom.window.setTimeout(resolve, ms));
    await new Promise((resolve) => setImmediate(resolve));
};

/**
 * A page with the real navbar markup in it and the widget initialised.
 *
 * @param {object} [options]
 * @param {Function} [options.apiRequest] stand-in for AppUtils.apiRequest.
 * @returns {object} handles onto the pieces the tests poke at.
 */
const mountNavbar = ({ apiRequest } = {}) => {
    const dom = new JSDOM(
        `<!doctype html><html><body>${navbarMarkup}</body></html>`,
        { url: 'https://shop.example/about.html', runScripts: 'outside-only' }
    );

    const { window } = dom;

    const requests = [];
    window.AppUtils = {
        // The real one, copied rather than imported: utils.js is a browser
        // script with its own side effects, and this is the whole of the
        // contract the widget depends on.
        escapeHTML: (value) => {
            if (value === null || value === undefined) return '';
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },
        safeArray: (value) => (Array.isArray(value) ? value : []),
        apiRequest: apiRequest || ((url) => {
            requests.push(url);
            return Promise.resolve([]);
        })
    };

    if (apiRequest) {
        const wrapped = window.AppUtils.apiRequest;
        window.AppUtils.apiRequest = (url, ...rest) => {
            requests.push(url);
            return wrapped(url, ...rest);
        };
    }

    // jsdom refuses to navigate and logs a "Not implemented" error otherwise;
    // the tests want to know where it *would* have gone.
    const navigations = [];
    delete window.location;
    window.location = {
        href: 'https://shop.example/about.html',
        search: ''
    };
    Object.defineProperty(window.location, 'href', {
        get: () => 'https://shop.example/about.html',
        set: (value) => navigations.push(value)
    });

    window.eval(source);
    window.initNavbarSearch();

    const input = window.document.getElementById('searchInput');
    const dropdown = window.document.getElementById('suggestionsDropdown');

    /** Type into the box and fire the input event the widget listens for. */
    const type = (value) => {
        input.value = value;
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
    };

    /** Press a key on the input. */
    const press = (key) => {
        const event = new window.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true
        });
        input.dispatchEvent(event);
        return event;
    };

    const options = () =>
        Array.from(dropdown.querySelectorAll('[role="option"]'));

    return { dom, window, input, dropdown, type, press, options, requests, navigations };
};

describe('escaping', () => {
    test('a product name containing markup is rendered as text, not as markup', async () => {
        // The headline. `sanitizeString` on the backend is a `.trim()`, so
        // whatever is in `products.name` arrives here verbatim.
        const harness = mountNavbar({
            apiRequest: async () => ([
                { id: 'p1', name: 'Blue Hoodie <img src=x onerror="window.__pwned=1">' }
            ])
        });

        harness.type('blue');
        await settle(harness.dom);

        const option = harness.options()[0];
        expect(option).toBeDefined();

        // The name is readable...
        expect(option.textContent).toContain('Blue Hoodie');
        expect(option.textContent).toContain('<img');
        // ...and it is text. No element was created from it.
        expect(option.querySelector('img')).toBeNull();
        expect(option.children.length).toBe(0);
        expect(harness.window.__pwned).toBeUndefined();
    });

    test('quotes and ampersands survive as characters', async () => {
        const harness = mountNavbar({
            apiRequest: async () => ([{ id: 'p1', name: `Ben & Jerry's "Half Baked"` }])
        });

        harness.type('ben');
        await settle(harness.dom);

        expect(harness.options()[0].textContent.trim())
            .toBe(`Ben & Jerry's "Half Baked"`);
    });

    test('the no-results message escapes the query too', async () => {
        // The query is the most attacker-controllable string on the page.
        const harness = mountNavbar({ apiRequest: async () => [] });

        harness.type('<script>window.__pwned=1</script>');
        await settle(harness.dom);

        expect(harness.dropdown.querySelector('script')).toBeNull();
        expect(harness.window.__pwned).toBeUndefined();
    });
});

describe('where the suggestions come from', () => {
    test('asks the API instead of filtering a global', async () => {
        // window.allProducts is only populated on index.html, which is why the
        // dropdown was dead on the other 27 pages.
        const harness = mountNavbar();

        harness.type('shirt');
        await settle(harness.dom);

        expect(harness.requests).toEqual(
            ['/products/search-suggestions?q=shirt']
        );
    });

    test('works with no window.allProducts at all', async () => {
        const harness = mountNavbar({
            apiRequest: async () => ([{ id: 'p1', name: 'Linen Shirt' }])
        });

        expect(harness.window.allProducts).toBeUndefined();

        harness.type('shirt');
        await settle(harness.dom);

        expect(harness.options()).toHaveLength(1);
    });

    test('encodes the query', async () => {
        const harness = mountNavbar();

        harness.type('a&b=c d');
        await settle(harness.dom);

        expect(harness.requests[0]).toBe(
            '/products/search-suggestions?q=a%26b%3Dc%20d'
        );
    });

    test('debounces, so typing a word is one request and not five', async () => {
        const harness = mountNavbar();

        for (const value of ['s', 'sh', 'shi', 'shir', 'shirt']) {
            harness.type(value);
        }
        await settle(harness.dom);

        expect(harness.requests).toHaveLength(1);
        expect(harness.requests[0]).toContain('q=shirt');
    });

    test('a one-character query is not worth a round trip', async () => {
        const harness = mountNavbar();

        harness.type('s');
        await settle(harness.dom);

        expect(harness.requests).toHaveLength(0);
        expect(harness.dropdown.style.display).toBe('none');
    });

    test('clearing the box closes the list', async () => {
        const harness = mountNavbar({
            apiRequest: async () => ([{ id: 'p1', name: 'Linen Shirt' }])
        });

        harness.type('shirt');
        await settle(harness.dom);
        expect(harness.dropdown.style.display).toBe('block');

        harness.type('');
        await settle(harness.dom);

        expect(harness.dropdown.style.display).toBe('none');
        expect(harness.input.getAttribute('aria-expanded')).toBe('false');
    });

    test('a slow reply for an old query cannot overwrite a newer one', async () => {
        // Without the sequence guard the user sees results for something they
        // stopped typing two words ago.
        const harness = mountNavbar({
            // `endsWith`, not `includes`: "q=shirt" contains "q=sh".
            apiRequest: (url) => new Promise((resolve) => {
                if (url.endsWith('q=sh')) {
                    setTimeout(() => resolve([{ id: 'old', name: 'Stale Result' }]), 300);
                } else {
                    resolve([{ id: 'new', name: 'Fresh Result' }]);
                }
            })
        });

        harness.type('sh');
        await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 300));
        harness.type('shirt');
        await settle(harness.dom, 700);

        const names = harness.options().map((o) => o.textContent.trim());
        expect(names).toEqual(['Fresh Result']);
    });

    test('a failed lookup closes the list rather than leaving a stale one up', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const harness = mountNavbar({
            apiRequest: async () => { throw new Error('offline'); }
        });

        harness.type('shirt');
        await settle(harness.dom);

        expect(harness.dropdown.style.display).toBe('none');

        console.error.mockRestore();
    });

    test('accepts the enveloped shape as well as the bare array', async () => {
        // The endpoint answers with a bare array today. The widget should not
        // break if it is ever standardised onto { success, products }.
        const harness = mountNavbar({
            apiRequest: async () => ({ success: true, products: [{ id: 'p1', name: 'Cap' }] })
        });

        harness.type('cap');
        await settle(harness.dom);

        expect(harness.options()).toHaveLength(1);
    });
});

describe('the combobox contract', () => {
    const threeResults = async () => ([
        { id: 'p1', name: 'Linen Shirt' },
        { id: 'p2', name: 'Denim Shirt' },
        { id: 'p3', name: 'Flannel Shirt' }
    ]);

    test('the input is a combobox pointing at the listbox', () => {
        const harness = mountNavbar();

        expect(harness.input.getAttribute('role')).toBe('combobox');
        expect(harness.input.getAttribute('aria-autocomplete')).toBe('list');
        expect(harness.input.getAttribute('aria-expanded')).toBe('false');
        expect(harness.input.getAttribute('aria-controls'))
            .toBe(harness.dropdown.id);
        expect(harness.dropdown.getAttribute('role')).toBe('listbox');
    });

    test('the input has an accessible name that is not just a placeholder', () => {
        const harness = mountNavbar();

        expect(harness.input.getAttribute('aria-label')).toBeTruthy();
    });

    test('rows are options, not anonymous divs', async () => {
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        expect(harness.options()).toHaveLength(3);
        for (const option of harness.options()) {
            expect(option.id).toBeTruthy();
            expect(option.getAttribute('aria-selected')).toBe('false');
        }
        expect(harness.input.getAttribute('aria-expanded')).toBe('true');
    });

    test('arrow keys move the active option', async () => {
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        harness.press('ArrowDown');
        expect(harness.options()[0].getAttribute('aria-selected')).toBe('true');
        expect(harness.input.getAttribute('aria-activedescendant'))
            .toBe(harness.options()[0].id);

        harness.press('ArrowDown');
        expect(harness.options()[1].getAttribute('aria-selected')).toBe('true');
        expect(harness.options()[0].getAttribute('aria-selected')).toBe('false');
    });

    test('the active option wraps at both ends', async () => {
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        harness.press('ArrowUp');
        expect(harness.options()[2].getAttribute('aria-selected')).toBe('true');

        harness.press('ArrowDown');
        expect(harness.options()[0].getAttribute('aria-selected')).toBe('true');
    });

    test('arrow keys do not also scroll the page', async () => {
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        expect(harness.press('ArrowDown').defaultPrevented).toBe(true);
    });

    test('Enter on a highlighted option opens that product', async () => {
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        harness.press('ArrowDown');
        harness.press('ArrowDown');
        harness.press('Enter');

        // The product, not a search for its name -- the user already picked it.
        expect(harness.navigations).toEqual(['product.html?id=p2']);
    });

    test('Enter with nothing highlighted still runs the full search', async () => {
        // Typing a query and pressing Enter must not stop working just because
        // a dropdown happens to be open.
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        harness.press('Enter');

        expect(harness.navigations).toEqual(['shop.html?search=shirt']);
    });

    test('Escape closes the list and leaves the text alone', async () => {
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        harness.press('Escape');

        expect(harness.dropdown.style.display).toBe('none');
        expect(harness.input.getAttribute('aria-expanded')).toBe('false');
        expect(harness.input.value).toBe('shirt');
    });

    test('Tab closes the list so it cannot hang over the next control', async () => {
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        harness.press('Tab');

        expect(harness.dropdown.style.display).toBe('none');
    });

    test('Home and End jump to the ends', async () => {
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        harness.press('End');
        expect(harness.options()[2].getAttribute('aria-selected')).toBe('true');

        harness.press('Home');
        expect(harness.options()[0].getAttribute('aria-selected')).toBe('true');
    });

    test('clicking an option opens that product', async () => {
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        harness.options()[2].dispatchEvent(
            new harness.window.MouseEvent('click', { bubbles: true })
        );

        expect(harness.navigations).toEqual(['product.html?id=p3']);
    });

    test('the result count is announced', async () => {
        // A div appearing tells a screen reader nothing on its own.
        const harness = mountNavbar({ apiRequest: threeResults });

        harness.type('shirt');
        await settle(harness.dom);

        const status = harness.window.document.querySelector('[role="status"]');
        expect(status).not.toBeNull();
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.textContent).toContain('3 products found');
    });

    test('no results says so rather than closing silently', async () => {
        // "Nothing happened" is indistinguishable from "this feature is
        // broken", which is what the old version looked like almost everywhere.
        const harness = mountNavbar({ apiRequest: async () => [] });

        harness.type('zzzz');
        await settle(harness.dom);

        expect(harness.dropdown.style.display).toBe('block');
        expect(harness.dropdown.textContent).toMatch(/No products match/i);
        expect(harness.window.document.querySelector('[role="status"]').textContent)
            .toMatch(/No matching products/i);
    });
});

describe('the markup it is applied to', () => {
    test('navbar.html still has the two elements the widget binds to', () => {
        expect(navbarMarkup).toContain('id="searchInput"');
        expect(navbarMarkup).toContain('id="suggestionsDropdown"');
    });

    test('components.js no longer reads window.allProducts for search', () => {
        // The specific line that made the widget dead on 27 pages.
        expect(source).not.toContain('const allProducts = window.allProducts');
    });
});
