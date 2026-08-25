// backend/tests/recentlyViewedCache.test.js
//
// The recently-viewed cache (#1610).
//
// The service keeps a five-minute in-process map in front of the
// `recently_viewed` table. `addViewed` seeded its list from
// `readCache(userId) || []`, so on a MISS -- a cold worker, a restart, or the
// first view after the TTL lapsed -- it wrote the cache back holding exactly
// one row. `getRecentlyViewed` then served any non-empty cache without
// consulting the database, so the user's whole history disappeared from the
// storefront for five minutes and came back only when the entry expired, at
// which point the next view wiped it again.
//
// Swapping the order of the two calls hides it entirely, which is why it
// survived manual testing: view a product *after* the list has been read into
// cache and everything looks right. So the tests below are written in the
// order that breaks it -- add first, read second -- and the class is
// instantiated fresh each time so no test inherits another's cache.

jest.mock('../config/db', () => {
    const query = jest.fn();
    return { promise: { query }, query };
});

const db = require('../config/db').promise;
const { RecentlyViewedService } = require('../services/recentlyViewedService');

const USER = 'user-1';

/** Seven products, newest first, as the database read returns them. */
const HISTORY = Array.from({ length: 7 }, (unused, index) => ({
    id: `prod-${index}`,
    name: `Product ${index}`,
    price: `${10 + index}.00`,
    imageUrl: `/img/${index}.png`,
    viewedAt: new Date(Date.UTC(2026, 0, 10 - index)),
}));

const PRODUCT_SELECT = /SELECT id, name, price, image, stock FROM products/i;
const HISTORY_SELECT = /FROM recently_viewed rv/i;
const HISTORY_INSERT = /INSERT INTO recently_viewed/i;

/**
 * A service whose database answers a fixed history and a fixed product row.
 *
 * `rows` is mutated by the insert path so the "add then read" sequence sees the
 * same thing the real table would.
 */
function mount({ history = HISTORY, product = null } = {}) {
    const rows = [...history];

    db.query.mockImplementation(async (sql, params = []) => {
        if (PRODUCT_SELECT.test(sql)) {
            return [product ? [product] : []];
        }
        if (HISTORY_SELECT.test(sql)) {
            const limit = params[params.length - 1];
            return [rows.slice(0, limit)];
        }
        if (HISTORY_INSERT.test(sql)) {
            const [, productId] = params;
            const existing = rows.findIndex((row) => row.id === productId);
            if (existing >= 0) rows.splice(existing, 1);
            rows.unshift({
                id: productId,
                name: product ? product.name : 'Unknown',
                price: product ? product.price : 0,
                imageUrl: product && product.image ? product.image : '/assets/images/placeholder.png',
                viewedAt: new Date(Date.UTC(2026, 0, 20)),
            });
            return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
    });

    // Constructed rather than taking the module singleton: the singleton calls
    // initialize() at require time and would carry cache state between tests.
    return { service: new RecentlyViewedService(), rows };
}

function historyReads() {
    return db.query.mock.calls.filter(([sql]) => HISTORY_SELECT.test(sql));
}

afterEach(() => {
    db.query.mockReset();
});

describe('a view on a cold cache does not hide the history', () => {
    const NEW_PRODUCT = { id: 'prod-new', name: 'Just viewed', price: '99.00', image: '/img/new.png', stock: 4 };

    test('the list read straight after a view still holds everything', async () => {
        const { service } = mount({ product: NEW_PRODUCT });

        // Cold cache. This is the exact sequence that used to collapse the
        // list to one row for five minutes.
        await service.addViewed(USER, 'prod-new');
        const viewed = await service.getRecentlyViewed(USER, 10);

        expect(viewed).toHaveLength(8);
        expect(viewed[0].id).toBe('prod-new');
        expect(viewed.map((item) => item.id)).toEqual(
            expect.arrayContaining(HISTORY.map((item) => item.id))
        );
    });

    test('addViewed itself returns the whole list, not just the new row', async () => {
        const { service } = mount({ product: NEW_PRODUCT });

        // The route hands this straight back to the client as `data`.
        const returned = await service.addViewed(USER, 'prod-new');

        expect(returned).toHaveLength(8);
        expect(returned[0].id).toBe('prod-new');
    });

    test('the entry a cold view leaves behind is not served as complete', async () => {
        const { service } = mount({ product: NEW_PRODUCT });

        await service.addViewed(USER, 'prod-new');

        const entry = service.readCacheEntry(USER);
        expect(entry.complete).toBe(true);
        expect(entry.data).toHaveLength(8);
    });
});

describe('a view on a warm cache is served from it', () => {
    const NEW_PRODUCT = { id: 'prod-new', name: 'Just viewed', price: '99.00', image: '/img/new.png', stock: 4 };

    test('no extra database read is needed once the list is complete', async () => {
        const { service } = mount({ product: NEW_PRODUCT });

        await service.getRecentlyViewed(USER, 10);
        const readsAfterFirst = historyReads().length;

        await service.addViewed(USER, 'prod-new');
        const viewed = await service.getRecentlyViewed(USER, 10);

        // The insert happened, the list was extended in place, and neither the
        // add nor the read went back for the history.
        expect(historyReads()).toHaveLength(readsAfterFirst);
        expect(viewed[0].id).toBe('prod-new');
        expect(viewed).toHaveLength(8);
    });

    test('re-viewing a product moves it to the front instead of duplicating it', async () => {
        const { service } = mount({
            product: { id: 'prod-3', name: 'Product 3', price: '13.00', image: '/img/3.png', stock: 2 },
        });

        await service.getRecentlyViewed(USER, 10);
        await service.addViewed(USER, 'prod-3');
        const viewed = await service.getRecentlyViewed(USER, 10);

        expect(viewed[0].id).toBe('prod-3');
        expect(viewed.filter((item) => item.id === 'prod-3')).toHaveLength(1);
        expect(viewed).toHaveLength(7);
    });

    test('the in-place list is capped at maxItems', async () => {
        const full = Array.from({ length: 20 }, (unused, index) => ({
            id: `p-${index}`,
            name: `P${index}`,
            price: '1.00',
            imageUrl: '/x.png',
            viewedAt: new Date(Date.UTC(2026, 0, 1)),
        }));

        const { service } = mount({
            history: full,
            product: { id: 'p-fresh', name: 'Fresh', price: '2.00', image: null, stock: 1 },
        });

        await service.getRecentlyViewed(USER, 20);
        const returned = await service.addViewed(USER, 'p-fresh');

        expect(returned).toHaveLength(service.maxItems);
        expect(returned[0].id).toBe('p-fresh');
    });
});

describe('the read path', () => {
    test('caches the full window regardless of the limit asked for', async () => {
        const { service } = mount();

        // A limit-2 read must not leave a two-row entry claiming to be the
        // whole history: the next limit-10 read would then under-serve.
        const small = await service.getRecentlyViewed(USER, 2);
        expect(small).toHaveLength(2);

        const large = await service.getRecentlyViewed(USER, 10);
        expect(large).toHaveLength(7);
        expect(historyReads()).toHaveLength(1);
    });

    test('caches an empty history rather than re-querying for it', async () => {
        const { service } = mount({ history: [] });

        expect(await service.getRecentlyViewed(USER, 10)).toEqual([]);
        expect(await service.getRecentlyViewed(USER, 10)).toEqual([]);

        expect(historyReads()).toHaveLength(1);
        expect(service.readCacheEntry(USER).complete).toBe(true);
    });

    test('a database failure yields an empty list and no poisoned cache', async () => {
        const { service } = mount();
        db.query.mockRejectedValue(new Error('connection lost'));

        expect(await service.getRecentlyViewed(USER, 10)).toEqual([]);
        expect(service.readCacheEntry(USER)).toBeNull();
    });

    test('an unknown product is not recorded and the cache is untouched', async () => {
        const { service } = mount({ product: null });

        await service.getRecentlyViewed(USER, 10);
        const before = service.readCacheEntry(USER).data;

        expect(await service.addViewed(USER, 'nope')).toEqual([]);
        expect(service.readCacheEntry(USER).data).toEqual(before);
        expect(db.query.mock.calls.filter(([sql]) => HISTORY_INSERT.test(sql))).toHaveLength(0);
    });

    test('an out-of-stock product is not recorded', async () => {
        const { service } = mount({
            product: { id: 'oos', name: 'Sold out', price: '5.00', image: null, stock: 0 },
        });

        expect(await service.addViewed(USER, 'oos')).toEqual([]);
        expect(db.query.mock.calls.filter(([sql]) => HISTORY_INSERT.test(sql))).toHaveLength(0);
    });
});

describe('row shape', () => {
    test('viewedAt is an ISO string whichever path filled the cache', async () => {
        const { service } = mount({
            product: { id: 'prod-new', name: 'Just viewed', price: '99.00', image: '/img/new.png', stock: 4 },
        });

        const fromDatabase = await service.getRecentlyViewed(USER, 10);
        const fromWrite = await service.addViewed(USER, 'prod-new');

        [...fromDatabase, ...fromWrite].forEach((item) => {
            expect(typeof item.viewedAt).toBe('string');
            expect(Number.isNaN(Date.parse(item.viewedAt))).toBe(false);
            expect(typeof item.price).toBe('number');
        });
    });
});

describe('cache housekeeping', () => {
    test('an expired entry is a miss, not a stale answer', async () => {
        const { service } = mount();

        await service.getRecentlyViewed(USER, 10);
        expect(historyReads()).toHaveLength(1);

        // Age the entry past the TTL without waiting five minutes.
        const entry = service.cache.get(service.getCacheKey(USER));
        entry.timestamp -= service.cacheTTL + 1;

        await service.getRecentlyViewed(USER, 10);
        expect(historyReads()).toHaveLength(2);
    });

    test('removeFromViewed keeps the completeness of the entry it edits', async () => {
        const { service } = mount();

        await service.getRecentlyViewed(USER, 10);
        await service.removeFromViewed(USER, 'prod-3');

        const entry = service.readCacheEntry(USER);
        expect(entry.complete).toBe(true);
        expect(entry.data.map((item) => item.id)).not.toContain('prod-3');
    });

    test('clearRecentlyViewed drops the entry entirely', async () => {
        const { service } = mount();

        await service.getRecentlyViewed(USER, 10);
        await service.clearRecentlyViewed(USER);

        expect(service.readCacheEntry(USER)).toBeNull();
    });

    test('getCacheStats reports partial entries', async () => {
        const { service } = mount();

        await service.getRecentlyViewed(USER, 10);
        service.writeCache('user-2', [{ id: 'x', name: 'x', price: 1 }], { complete: false });

        const stats = service.getCacheStats();
        expect(stats.totalEntries).toBe(2);
        expect(stats.partialEntries).toBe(1);
    });
});
