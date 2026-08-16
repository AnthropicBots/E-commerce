// backend/tests/cartBulkSelection.test.js
//
// Cart bulk selection, driven for real in jsdom (#1584).
//
// `cart.js` rendered a checkbox on every cart line and ticking one did nothing
// at all. The state (`selectedItems`), the operations (`bulkRemove`,
// `bulkSaveForLater`), the undo integration and the per-item checkbox had all
// shipped. What had not:
//
//   * `#bulk-actions`, `#selected-count`, `#select-all`, `#cart-item-count` and
//     `#saved-for-later-container` were not in cart.html, so every one of them
//     cached as null and `updateBulkActions` -- guarded on
//     `if (bulkActions && selectedCount)` -- was a no-op;
//   * nothing called `toggleSelectItem`, `toggleSelectAll`, `bulkRemove` or
//     `bulkSaveForLater`. The delegated click handler matched `.increase-qty`,
//     `.remove-btn` and four others, and nothing for the checkboxes;
//   * the markup's `onchange="window.toggleSelectItem(...)"` could not have
//     worked either: cart.js is an IIFE and assigns nothing to `window`, and
//     the id was interpolated unquoted, which for a CHAR(36) UUID is not valid
//     syntax;
//   * `toggleSelectAll` did `parseInt(checkbox.dataset.itemId)`, and product
//     ids are UUIDs, so every row collapsed onto a single NaN key.
//
// None of that is visible to grep -- the functions are all there, correctly
// written. The question is whether anything reaches them, so these cases load
// the real cart.html and the real cart.js and click things.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');

const CART_HTML = fs.readFileSync(path.join(FRONTEND, 'cart.html'), 'utf8');
const CART_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'cart.js'), 'utf8');
const CART_CSS = fs.readFileSync(path.join(FRONTEND, 'styles', 'cart.css'), 'utf8');

// UUIDs, because that is what product ids are and it is what broke the
// selection. Integers here would let `parseInt` pass.
const LINES = [
    { id: 'a3f1b2c4-0000-4000-8000-000000000001', name: 'Linen Shirt', price: 1200, qty: 1, img: 'a.png' },
    { id: 'a3f1b2c4-0000-4000-8000-000000000002', name: 'Denim Jacket', price: 3400, qty: 2, img: 'b.png' },
    { id: 'a3f1b2c4-0000-4000-8000-000000000003', name: 'Cotton Hoodie', price: 2100, qty: 1, img: 'c.png' },
];

// The delegated click handler in cart.js reads `decreaseBtn` at a point where
// its `const` is commented out, so every click on the cart page that is not on
// the "+" button throws a ReferenceError. That is #1535, it is assigned, and it
// is not this change's to fix -- the bulk buttons here are bound directly to
// their elements rather than through that handler, so they work regardless.
//
// Filtered out by name rather than by ignoring errors wholesale, so a *new*
// error still fails these cases, and so this stops filtering anything the day
// #1535 lands.
const KNOWN_UNRELATED = [/decreaseBtn is not defined/];

const unexpected = (errors) =>
    errors.filter((message) => !KNOWN_UNRELATED.some((known) => known.test(message)));

const settle = async (dom, ms = 60) => {
    await new Promise((resolve) => dom.window.setTimeout(resolve, ms));
    await new Promise((resolve) => setImmediate(resolve));
};

/**
 * Load the real cart page with a cart in it.
 *
 * @param {object} [options]
 * @param {Array} [options.lines] the cart contents.
 * @param {number} [options.expiresInDays] seeds the expiry key when given.
 * @returns {object} handles onto the page.
 */
const mountCart = async ({ lines = LINES, expiresInDays = null } = {}) => {
    const dom = new JSDOM(CART_HTML, {
        url: 'http://localhost:5500/cart.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });

    const { window } = dom;
    const errors = [];
    const notices = [];

    window.addEventListener('error', (event) => errors.push(event.message));

    let stored = JSON.parse(JSON.stringify(lines));

    if (expiresInDays !== null) {
        window.localStorage.setItem(
            'cartExpiry',
            new Date(Date.now() + expiresInDays * 86400000).toISOString()
        );
    }

    window.AppUtils = {
        CART_UPDATED_EVENT: 'cart:updated',
        getCart: () => JSON.parse(JSON.stringify(stored)),
        saveCart: (next) => {
            stored = JSON.parse(JSON.stringify(next));
            return JSON.parse(JSON.stringify(stored));
        },
        getJSON: (_key, fallback) => fallback,
        setJSON: () => {},
        escapeHTML: (value) =>
            String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;'),
        formatPrice: (value) => `₹${value}`,
        defaultImage: (value) => value || 'placeholder.png',
        notify: (message) => notices.push(message),
        safeInteger: (value, fallback) =>
            Number.isFinite(Number(value)) ? Number(value) : fallback,
        safeNumber: (value, fallback) => Number(value) || fallback,
        fetchCartQuote: async () => ({
            subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 0,
            freeShipping: {}, currency: { symbol: '₹' },
        }),
        calculateCartTotals: async () => ({
            subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 0, freeShipping: {},
        }),
        formatFreeShippingProgress: () => '',
        validateCoupon: async () => ({ valid: false, message: '' }),
        getWishlist: () => [],
        saveWishlist: () => {},
        getToken: () => null,
    };

    window.eval(CART_JS);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
    await settle(dom);

    const byId = (id) => window.document.getElementById(id);

    return {
        dom,
        window,
        document: window.document,
        errors,
        notices,
        storedCart: () => stored,
        rows: () => window.document.querySelectorAll('.cart-item'),
        boxes: () => [...window.document.querySelectorAll('.cart-item-select')],
        bulkBar: () => byId('bulk-actions'),
        selectedCount: () => byId('selected-count'),
        selectAll: () => byId('select-all'),
        itemCount: () => byId('cart-item-count'),
        expiryWarning: () => byId('cart-expiry-warning'),
        savedContainer: () => byId('saved-for-later-container'),
        tick: async (index, checked = true) => {
            const box = window.document.querySelectorAll('.cart-item-select')[index];
            box.checked = checked;
            box.dispatchEvent(new window.Event('change', { bubbles: true }));
            await settle(dom);
        },
        toggleAll: async (checked = true) => {
            const box = byId('select-all');
            box.checked = checked;
            box.dispatchEvent(new window.Event('change', { bubbles: true }));
            await settle(dom);
        },
        clickBulk: async (id) => {
            byId(id).click();
            await settle(dom);
        },
    };
};

// ---------------------------------------------------------------------------
// The markup that was missing
// ---------------------------------------------------------------------------

describe('cart.html carries the elements cart.js caches', () => {
    test.each([
        'bulk-actions',
        'bulk-remove-btn',
        'bulk-save-later-btn',
        'select-all',
        'selected-count',
        'cart-item-count',
        'saved-for-later-container',
        'cart-expiry-warning',
    ])('#%s is in the page', (id) => {
        expect(CART_HTML).toMatch(new RegExp(`id="${id}"`));
    });

    test('the bulk toolbar and expiry notice start hidden', () => {
        // Both are revealed by script. Shipping them visible would put an empty
        // "0 items selected" bar above every cart.
        expect(CART_HTML).toMatch(/id="bulk-actions"[\s\S]{0,220}style="display: none;"/);
        expect(CART_HTML).toMatch(/id="cart-expiry-warning"[\s\S]{0,220}style="display: none;"/);
    });

    test('cart.css styles them', () => {
        for (const selector of [
            '.bulk-actions', '.bulk-action-btn', '.selected-count',
            '.select-all-label', '.cart-item-count', '.cart-expiry-warning',
            '#saved-for-later-section',
        ]) {
            expect(CART_CSS).toContain(selector);
        }
    });

    test('cart.css does not fight the script for display', () => {
        // updateBulkActions and updateExpiryWarning set `display` inline. A
        // `display` in the rule as well would mean two owners for one property.
        const rule = /\.bulk-actions\s*\{([^}]*)\}/.exec(CART_CSS);

        expect(rule).not.toBeNull();
        expect(rule[1]).not.toMatch(/(^|[;\s])display\s*:/);
    });

    test('there is a dark-theme rule for the new toolbar', () => {
        expect(CART_CSS).toMatch(/body\.dark-theme \.bulk-actions/);
    });
});

// ---------------------------------------------------------------------------
// The wiring
// ---------------------------------------------------------------------------

describe('a cart with three lines', () => {
    test('renders a checkbox per line', async () => {
        const cart = await mountCart();

        expect(cart.rows()).toHaveLength(3);
        expect(cart.boxes()).toHaveLength(3);
    });

    test('loads without throwing', async () => {
        // showUndoToast was called from three places and declared in none of
        // them; it is restored by this change. See KNOWN_UNRELATED above for
        // the one error still expected here.
        const cart = await mountCart();

        expect(unexpected(cart.errors)).toEqual([]);
    });

    test('keeps the whole UUID on the checkbox', async () => {
        // parseInt on this is NaN, which is what collapsed the selection.
        const cart = await mountCart();

        expect(cart.boxes()[0].dataset.itemId)
            .toBe('a3f1b2c4-0000-4000-8000-000000000001');
    });

    test('does not put handlers on the global object', async () => {
        // The markup used to call window.toggleSelectItem, which this file
        // never defined -- cart.js is an IIFE and assigns nothing to window.
        // Asserted against the rendered DOM rather than the source, so a
        // comment mentioning the old form does not fail the case.
        const cart = await mountCart();

        expect(cart.document.querySelector('#cart-items').innerHTML)
            .not.toMatch(/window\./);
        expect(cart.window.toggleSelectItem).toBeUndefined();
        expect(cart.window.updateQuantity).toBeUndefined();
        expect(cart.window.updateItemNote).toBeUndefined();
    });

    test('shows the item count, summed over quantities', async () => {
        const cart = await mountCart();

        // 1 + 2 + 1
        expect(cart.itemCount().textContent).toBe('4 items');
    });

    test('says "1 item" rather than "1 items"', async () => {
        const cart = await mountCart({ lines: [{ ...LINES[0], qty: 1 }] });

        expect(cart.itemCount().textContent).toBe('1 item');
    });

    test('hides the bulk bar until something is selected', async () => {
        const cart = await mountCart();

        expect(cart.bulkBar().style.display).toBe('none');
    });
});

describe('selecting lines', () => {
    test('ticking one reveals the bar with a count', async () => {
        const cart = await mountCart();

        await cart.tick(0);

        expect(cart.bulkBar().style.display).toBe('flex');
        expect(cart.selectedCount().textContent).toBe('1 item selected');
    });

    test('ticking a second updates the count', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.tick(1);

        expect(cart.selectedCount().textContent).toBe('2 items selected');
    });

    test('unticking the last one hides the bar again', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.tick(0, false);

        expect(cart.bulkBar().style.display).toBe('none');
    });

    test('select-all is indeterminate on a partial selection', async () => {
        const cart = await mountCart();

        await cart.tick(0);

        expect(cart.selectAll().indeterminate).toBe(true);
        expect(cart.selectAll().checked).toBe(false);
    });

    test('select-all is checked once every line is picked', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.tick(1);
        await cart.tick(2);

        expect(cart.selectAll().checked).toBe(true);
        expect(cart.selectAll().indeterminate).toBe(false);
    });

    test('select-all ticks every box and counts them all', async () => {
        // This is the case parseInt broke: three UUIDs became one NaN, so the
        // count said 1.
        const cart = await mountCart();

        await cart.toggleAll(true);

        expect(cart.boxes().filter((box) => box.checked)).toHaveLength(3);
        expect(cart.selectedCount().textContent).toBe('3 items selected');
    });

    test('unticking select-all clears the selection', async () => {
        const cart = await mountCart();

        await cart.toggleAll(true);
        await cart.toggleAll(false);

        expect(cart.bulkBar().style.display).toBe('none');
        expect(cart.boxes().filter((box) => box.checked)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

describe('save selected for later', () => {
    test('moves the selected lines out of the cart', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.clickBulk('bulk-save-later-btn');

        expect(cart.rows()).toHaveLength(2);
        expect(cart.storedCart().map((item) => item.name))
            .toEqual(['Denim Jacket', 'Cotton Hoodie']);
    });

    test('renders them into the saved-for-later container', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.clickBulk('bulk-save-later-btn');

        const saved = cart.savedContainer();
        expect(saved.children).toHaveLength(1);
        expect(saved.textContent).toContain('Linen Shirt');
        expect(saved.textContent).toContain('Saved for Later (1)');
    });

    test('says how many, with the right noun', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.clickBulk('bulk-save-later-btn');

        expect(cart.notices).toContain('Saved 1 item for later');
    });

    test('clears the selection and hides the bar', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.clickBulk('bulk-save-later-btn');

        expect(cart.bulkBar().style.display).toBe('none');
    });

    test('emptying the cart this way still renders the saved items', async () => {
        const cart = await mountCart();

        await cart.toggleAll(true);
        await cart.clickBulk('bulk-save-later-btn');

        expect(cart.rows()).toHaveLength(0);
        expect(cart.savedContainer().textContent).toContain('Saved for Later (3)');
        expect(unexpected(cart.errors)).toEqual([]);
    });
});

describe('remove selected', () => {
    test('takes the selected lines out immediately', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.tick(1);
        await cart.clickBulk('bulk-remove-btn');

        expect(cart.rows()).toHaveLength(1);
    });

    test('offers an undo', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.clickBulk('bulk-remove-btn');

        const toast = cart.document.getElementById('undo-toast');
        expect(toast).not.toBeNull();
        expect(toast.textContent).toContain('Removing 1 item from cart');
    });

    test('undo puts them back', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.clickBulk('bulk-remove-btn');
        expect(cart.rows()).toHaveLength(2);

        cart.document.querySelector('#undo-toast .undo-btn').click();
        await settle(cart.dom);

        expect(cart.rows()).toHaveLength(3);
    });

    test('clears the selection so the bar goes away', async () => {
        const cart = await mountCart();

        await cart.tick(0);
        await cart.clickBulk('bulk-remove-btn');

        expect(cart.bulkBar().style.display).toBe('none');
    });
});

// ---------------------------------------------------------------------------
// The rest of the markup that had nowhere to render
// ---------------------------------------------------------------------------

describe('the expiry notice', () => {
    test('warns when the cart is nearly out of time', async () => {
        const cart = await mountCart({ expiresInDays: 2 });

        expect(cart.expiryWarning().style.display).toBe('block');
        expect(cart.expiryWarning().textContent).toContain('expire in 2 days');
        expect(cart.expiryWarning().className).toContain('urgent');
    });

    test('is softer when there is more time left', async () => {
        const cart = await mountCart({ expiresInDays: 4 });

        expect(cart.expiryWarning().className).toContain('warning');
        expect(cart.expiryWarning().className).not.toContain('urgent');
    });

    test('stays hidden when the cart has plenty of time', async () => {
        const cart = await mountCart({ expiresInDays: 6 });

        expect(cart.expiryWarning().style.display).toBe('none');
    });

    test('stays hidden when no expiry has been set', async () => {
        const cart = await mountCart();

        expect(cart.expiryWarning().style.display).toBe('none');
    });
});
