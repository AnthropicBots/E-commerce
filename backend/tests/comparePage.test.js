// backend/tests/comparePage.test.js
//
// The comparison matrix (#1611), driven for real in jsdom.
//
// `products.id` is a CHAR(36) UUID and `frontend/scripts/compare.js` identified
// products with `Number()`:
//
//     const removeId = Number(btn.dataset.removeId);              // NaN
//     compareProductIds.filter((id) => Number(id) !== removeId);  // keeps all
//
//     const prodId = Number(btn.dataset.productId);               // NaN
//     loadedProducts.find((p) => Number(p.id) === prodId);        // matches none
//
// NaN is not equal to itself, so the remove filter kept every element and the
// cart lookup matched nothing -- for every product, not some of them. Add to
// Cart fell out of `if (targetProd)` and produced no toast, no error and no
// change: the button was dead and said nothing about it.
//
// Reading the source cannot show that. What can is clicking the buttons and
// looking at localStorage and the cart, which is what these tests do.
//
// Same class of defect as #1497 in recentlyViewed.js; compare.js was not part
// of that change.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COMPARE_JS = path.join(REPO_ROOT, 'frontend', 'scripts', 'compare.js');

const source = fs.readFileSync(COMPARE_JS, 'utf8');

/** Real UUIDs, because that is the whole point. */
const IDS = [
    'f3a0d99c-5509-4619-9634-7ceeb3615921',
    '0b1e2d3c-4a5b-6c7d-8e9f-a0b1c2d3e4f5',
    'aa11bb22-cc33-dd44-ee55-ff6677889900'
];

const PRODUCTS = IDS.map((id, index) => ({
    id,
    name: `Product ${index}`,
    price: 100 + index,
    rating: 4 - index * 0.5,
    brand: `Brand ${index}`,
    category: 'Shirts',
    num_reviews: 10 * (index + 1),
    stock: 5,
    image: `/img/${index}.png`
}));

const PAGE = `<!doctype html><html><body>
    <select id="compare-sort-select"><option value="">Default</option></select>
    <input type="checkbox" id="toggle-diff-checkbox">
    <button id="clear-compare-btn">Clear</button>
    <div id="compare-matrix-content"></div>
</body></html>`;

/** Let the awaited Promise.allSettled and the render settle. */
const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
};

/**
 * A compare page with the real script running on it.
 *
 * By default the Web Worker is absent so the main-thread matrix path runs;
 * jsdom has no Worker and loading `scripts/compare-worker.js` over a file URL
 * would not work anyway. Pass `worker` to install a stand-in and exercise the
 * path a real browser takes instead.
 *
 * @param {object} [options]
 * @param {object} [options.storage] initial localStorage contents
 * @param {string[]} [options.knownIds] ids the fake API will resolve
 * @param {{messages: Array, reply: Function}} [options.worker] fake worker
 */
const mountCompare = async ({ storage = {}, knownIds = IDS, worker = null, brokenWorker = false } = {}) => {
    const dom = new JSDOM(PAGE, {
        url: 'https://shop.example/compare.html',
        runScripts: 'outside-only'
    });

    const { window } = dom;

    Object.entries(storage).forEach(([key, value]) => {
        window.localStorage.setItem(key, JSON.stringify(value));
    });

    const cart = [];
    const notices = [];
    const requested = [];

    window.AppUtils = {
        getJSON: (key, fallback = null) => {
            try {
                const raw = window.localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch (error) {
                return fallback;
            }
        },
        setJSON: (key, value) => {
            window.localStorage.setItem(key, JSON.stringify(value));
            return true;
        },
        escapeHTML: (value) => {
            if (value === null || value === undefined) return '';
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },
        formatPrice: (value) => `INR ${(Number(value) || 0).toFixed(2)}`,
        notify: (message, level) => notices.push({ message, level }),
        addCartItem: (product) => cart.push(product),
        apiRequest: async (url) => {
            requested.push(url);
            const id = decodeURIComponent(url.split('/').pop());
            const product = PRODUCTS.find((candidate) => candidate.id === id);
            if (!product || !knownIds.includes(id)) {
                throw new Error('404');
            }
            return { product };
        }
    };

    if (brokenWorker) {
        // A Worker constructor that throws, the way a blocked or missing worker
        // script behaves. compare.js catches it and uses the main thread.
        window.Worker = function BrokenWorker() {
            throw new Error('worker script blocked');
        };
    } else if (worker) {
        // A stand-in for the real Web Worker. jsdom has none, and the browsers
        // that shoppers actually use do -- so the worker path is the one most
        // of them take, and the buttons are bound from the render it drives.
        window.Worker = function FakeWorker() {
            worker.instance = this;
            this.postMessage = (payload) => {
                worker.messages.push(payload);
                // The real worker replies asynchronously; so does this.
                Promise.resolve().then(() => {
                    if (typeof this.onmessage === 'function') {
                        this.onmessage({ data: worker.reply(payload) });
                    }
                });
            };
            this.terminate = () => {};
        };
    } else {
        // No Worker: exercise the main-thread matrix path.
        window.Worker = undefined;
    }

    window.confirm = () => true;

    window.eval(source);
    await settle();

    const readStored = (key) => JSON.parse(window.localStorage.getItem(key) || 'null');

    return {
        window,
        document: window.document,
        cart,
        notices,
        requested,
        worker,
        readStored,
        removeButtons: () => [...window.document.querySelectorAll('.compare-remove-btn')],
        addButtons: () => [...window.document.querySelectorAll('.add-to-cart-btn')],
        headerTitles: () =>
            [...window.document.querySelectorAll('.compare-product-title')].map((el) => el.textContent.trim())
    };
};

describe('the matrix renders', () => {
    it('shows one column per compared product', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS } });

        expect(page.headerTitles()).toEqual(['Product 0', 'Product 1', 'Product 2']);
        expect(page.removeButtons()).toHaveLength(3);
        expect(page.addButtons()).toHaveLength(3);
    });

    it('carries the UUID through to the button, unconverted', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS } });

        expect(page.removeButtons().map((btn) => btn.dataset.removeId)).toEqual(IDS);
        expect(page.addButtons().map((btn) => btn.dataset.productId)).toEqual(IDS);
    });
});

describe('removing a product', () => {
    it('takes it out of storage and out of the matrix', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS } });

        page.removeButtons()[1].click();
        await settle();

        expect(page.readStored('compareProducts')).toEqual([IDS[0], IDS[2]]);
        expect(page.headerTitles()).toEqual(['Product 0', 'Product 2']);
    });

    it('keeps both storage keys in step', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS, comparisonList: IDS } });

        page.removeButtons()[0].click();
        await settle();

        expect(page.readStored('compareProducts')).toEqual([IDS[1], IDS[2]]);
        expect(page.readStored('comparisonList')).toEqual([IDS[1], IDS[2]]);
    });

    it('falls back to the empty state once the last one goes', async () => {
        const page = await mountCompare({ storage: { compareProducts: [IDS[0]] } });

        page.removeButtons()[0].click();
        await settle();

        expect(page.readStored('compareProducts')).toEqual([]);
        expect(page.document.body.textContent).toContain('No Products Selected for Comparison');
    });

    it('does not re-fetch the surviving products', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS } });
        const before = page.requested.length;

        page.removeButtons()[2].click();
        await settle();

        expect(page.requested).toHaveLength(before);
        expect(page.headerTitles()).toHaveLength(2);
    });
});

describe('add to cart', () => {
    it('adds the product the button belongs to', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS } });

        page.addButtons()[2].click();
        await settle();

        expect(page.cart).toHaveLength(1);
        expect(page.cart[0].id).toBe(IDS[2]);
        expect(page.notices.map((n) => n.message)).toContain('Added Product 2 to cart');
    });

    it('adds each product independently', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS } });

        page.addButtons()[0].click();
        page.addButtons()[1].click();
        await settle();

        expect(page.cart.map((item) => item.id)).toEqual([IDS[0], IDS[1]]);
    });
});

describe('reading the stored list', () => {
    it('falls back to comparisonList when compareProducts is empty', async () => {
        // `[]` is truthy, so the old `getJSON(a, []) || getJSON(b, [])` could
        // never reach the second key and this visitor saw the empty state.
        const page = await mountCompare({ storage: { comparisonList: IDS } });

        expect(page.headerTitles()).toEqual(['Product 0', 'Product 1', 'Product 2']);
    });

    it('prefers compareProducts when both hold something', async () => {
        const page = await mountCompare({
            storage: { compareProducts: [IDS[0]], comparisonList: IDS }
        });

        expect(page.headerTitles()).toEqual(['Product 0']);
    });

    it('renders the empty state when neither key holds anything', async () => {
        const page = await mountCompare({ storage: {} });

        expect(page.document.body.textContent).toContain('No Products Selected for Comparison');
        expect(page.requested).toHaveLength(0);
    });

    it('survives a corrupt stored value', async () => {
        const page = await mountCompare({ storage: { compareProducts: 'not-an-array' } });

        expect(page.document.body.textContent).toContain('No Products Selected for Comparison');
    });

    it('drops blanks and duplicates without losing order', async () => {
        const page = await mountCompare({
            storage: { compareProducts: [IDS[1], '', IDS[1], null, IDS[0], '  '] }
        });

        expect(page.headerTitles()).toEqual(['Product 1', 'Product 0']);
    });

    it('prunes an id the catalogue no longer resolves', async () => {
        const page = await mountCompare({
            storage: { compareProducts: [...IDS, 'deadbeef-0000-0000-0000-000000000000'] },
            knownIds: IDS
        });

        // Otherwise a withdrawn product sits in the list forever, retried on
        // every visit and counting against the three-product cap.
        expect(page.readStored('compareProducts')).toEqual(IDS);
    });
});

describe('clearing', () => {
    it('empties both keys and shows the empty state', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS, comparisonList: IDS } });

        page.document.getElementById('clear-compare-btn').click();
        await settle();

        expect(page.readStored('compareProducts')).toEqual([]);
        expect(page.readStored('comparisonList')).toEqual([]);
        expect(page.document.body.textContent).toContain('No Products Selected for Comparison');
    });
});

describe('sameId', () => {
    it('compares UUIDs as strings, never as numbers', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS } });
        const { sameId, normalizeIds } = page.window.__compareInternals;

        expect(sameId(IDS[0], IDS[0])).toBe(true);
        expect(sameId(IDS[0], IDS[1])).toBe(false);

        // The regression itself: Number() of either side is NaN, and NaN
        // compared to NaN is false in every direction.
        expect(Number(IDS[0])).toBeNaN();

        // Integer ids from older builds still work.
        expect(sameId(7, '7')).toBe(true);
        expect(sameId(' 7 ', 7)).toBe(true);

        expect(normalizeIds([1, '1', 2])).toEqual(['1', '2']);
        expect(normalizeIds(null)).toEqual([]);
    });
});

describe('the Web Worker path', () => {
    // Everything above runs the main-thread fallback, but a real browser has a
    // Worker and takes this branch -- so the buttons shoppers actually click
    // are bound from the render the worker drives. The fake below answers the
    // shape `compare-worker.js` posts back.

    /** A worker double that sorts and builds a matrix the way the real one does. */
    const fakeWorker = () => ({
        messages: [],
        instance: null,
        reply: ({ products, sortBy }) => {
            const sorted = [...products];
            if (sortBy === 'price-desc') {
                sorted.sort((a, b) => Number(b.price) - Number(a.price));
            }

            return {
                action: 'PROCESS_COMPARISON_RESULT',
                products: sorted,
                specMatrix: [
                    {
                        key: 'price',
                        label: 'Price',
                        type: 'currency',
                        values: sorted.map((p) => p.price),
                        isDifferent: true,
                        bestValue: Math.min(...sorted.map((p) => Number(p.price)))
                    }
                ]
            };
        }
    });

    it('renders from the worker reply', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS }, worker: fakeWorker() });

        expect(page.worker.messages).toHaveLength(1);
        expect(page.worker.messages[0].action).toBe('PROCESS_COMPARISON');
        expect(page.headerTitles()).toEqual(['Product 0', 'Product 1', 'Product 2']);
    });

    it('removes the product the button belongs to', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS }, worker: fakeWorker() });

        page.removeButtons()[1].click();
        await settle();

        expect(page.readStored('compareProducts')).toEqual([IDS[0], IDS[2]]);
        expect(page.headerTitles()).toEqual(['Product 0', 'Product 2']);
    });

    it('adds the product the button belongs to', async () => {
        const page = await mountCompare({ storage: { compareProducts: IDS }, worker: fakeWorker() });

        page.addButtons()[1].click();
        await settle();

        expect(page.cart.map((item) => item.id)).toEqual([IDS[1]]);
    });

    it('binds against the order the worker returned, not the order stored', async () => {
        // The worker sorts; the ids on the buttons come from its reply. If the
        // handlers had closed over an index rather than reading the id back,
        // sorting would silently rewire every button.
        const page = await mountCompare({ storage: { compareProducts: IDS }, worker: fakeWorker() });

        page.document.getElementById('compare-sort-select').innerHTML =
            '<option value="price-desc" selected>Price high to low</option>';
        page.document.getElementById('compare-sort-select').dispatchEvent(
            new page.window.Event('change')
        );
        await settle();

        expect(page.headerTitles()).toEqual(['Product 2', 'Product 1', 'Product 0']);

        page.addButtons()[0].click();
        await settle();

        expect(page.cart.map((item) => item.id)).toEqual([IDS[2]]);
    });

    it('falls back to the main thread when the worker cannot be created', async () => {
        // A blocked or missing worker script must not take the page with it --
        // and the buttons have to work on the fallback render too.
        const page = await mountCompare({ storage: { compareProducts: IDS }, brokenWorker: true });

        expect(page.headerTitles()).toEqual(['Product 0', 'Product 1', 'Product 2']);

        page.addButtons()[0].click();
        page.removeButtons()[2].click();
        await settle();

        expect(page.cart.map((item) => item.id)).toEqual([IDS[0]]);
        expect(page.readStored('compareProducts')).toEqual([IDS[0], IDS[1]]);
    });
});
