// frontend/scripts/recently-viewed-store.js
//
// The single owner of the `recentlyViewed` localStorage key (#1497).
//
// There were three writers and two readers, in two incompatible shapes:
//
//   product.js       trackRecentlyViewed()  array of id strings, cap 10 -- and
//                                           never called by anything
//   product.js       saveRecentlyViewed()   array of objects, cap 10
//   product-render.js updateRecentlyViewed() array of objects, cap 8
//   recentlyViewed.js loadRecentlyViewed()  read as id strings
//   related-products.js                     read as objects
//
// product.html loads two of the writers and one of the readers; index.html
// loads the other reader. So the page that writes and the page that reads did
// not agree on what was in the key.
//
// Both object writers deduplicated with `Number(item.id) !== Number(product.id)`.
// `products.id` is a CHAR(36) UUID, `Number(uuid)` is NaN, and `NaN !== NaN` is
// true -- so the predicate held for every element and the filter removed
// nothing, ever, for any product. Combined with saveRecentlyViewed being called
// twice from adjacent lines plus updateRecentlyViewed on render, one page view
// wrote three copies of the same product.
//
// One module, one shape, one cap, dedupe on the id as a string.

(function () {
    "use strict";

    const STORAGE_KEY =
        (window.CONFIG && window.CONFIG.STORAGE_KEYS
            && window.CONFIG.STORAGE_KEYS.RECENTLY_VIEWED)
        || "recentlyViewed";

    /**
     * How many products are kept.
     *
     * One number. It was 10 in one writer and 8 in another, on the same key in
     * the same page load, so the length depended on which ran last.
     */
    const MAX_ENTRIES = 8;

    /** Entries older than this are dropped on read. */
    const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

    /**
     * Read the key, tolerating whatever is in it.
     *
     * Existing browsers hold the old mixed contents: bare id strings from one
     * writer, objects from the others, duplicates from the broken dedupe. This
     * migrates what it can and drops what it cannot rather than making
     * everyone clear their storage -- a bare id is still a product somebody
     * looked at, it just has no name or price to render, so it is kept with
     * `partial: true` and the reader fills it in.
     *
     * @returns {Array<object>}
     */
    function read() {
        const raw = window.AppUtils && window.AppUtils.getJSON
            ? window.AppUtils.getJSON(STORAGE_KEY, [])
            : safeParse(window.localStorage.getItem(STORAGE_KEY));

        if (!Array.isArray(raw)) {
            return [];
        }

        const now = Date.now();
        const seen = new Set();
        const entries = [];

        for (const item of raw) {
            const entry = normalise(item);

            if (!entry) continue;
            // The dedupe that never fired. On strings this time.
            if (seen.has(entry.id)) continue;
            if (entry.viewedAt && now - entry.viewedAt > MAX_AGE_MS) continue;

            seen.add(entry.id);
            entries.push(entry);
        }

        return entries.slice(0, MAX_ENTRIES);
    }

    /**
     * Coerce one stored item into the canonical shape, or null.
     *
     * @param {*} item
     * @returns {object|null}
     */
    function normalise(item) {
        if (typeof item === "string") {
            // The shape trackRecentlyViewed wrote and loadRecentlyViewed
            // expected. Nothing calls that writer, but a browser may still be
            // holding what an older build left.
            const id = item.trim();
            return id ? { id, partial: true, viewedAt: null } : null;
        }

        if (!item || typeof item !== "object") {
            return null;
        }

        // String, always. An id compared as a number is the bug this module
        // exists for.
        const id = item.id === undefined || item.id === null
            ? ""
            : String(item.id).trim();

        if (!id) return null;

        return {
            id,
            name: item.name || null,
            brand: item.brand || null,
            category: item.category || null,
            price: item.price === undefined ? null : item.price,
            image: item.image || null,
            stock: item.stock === undefined ? null : item.stock,
            rating: item.rating === undefined ? null : item.rating,
            viewedAt: Number(item.viewedAt) || null,
            // An entry with no name cannot render a card on its own.
            partial: !item.name
        };
    }

    /**
     * @param {Array<object>} entries
     */
    function write(entries) {
        const capped = entries.slice(0, MAX_ENTRIES);

        if (window.AppUtils && window.AppUtils.setJSON) {
            window.AppUtils.setJSON(STORAGE_KEY, capped);
            return;
        }

        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
        } catch (error) {
            // A full or blocked localStorage must not take the product page
            // down over a nice-to-have carousel.
            console.warn("Could not store recently viewed:", error);
        }
    }

    /**
     * Record a product view.
     *
     * Idempotent for one product: calling it twice in a row moves the entry to
     * the front and leaves one of it. That matters because product.js calls
     * its writer twice from adjacent lines today.
     *
     * @param {object|string} product - a product object, or just its id
     * @returns {Array<object>} the list as it now stands
     */
    function record(product) {
        const entry = normalise(
            typeof product === "string" ? product : product || null
        );

        if (!entry) {
            return read();
        }

        entry.viewedAt = Date.now();

        const rest = read().filter((item) => item.id !== entry.id);
        const next = [entry, ...rest];

        write(next);
        syncToServer(entry.id);

        return next;
    }

    /**
     * @returns {Array<object>} most recent first
     */
    function list() {
        return read();
    }

    /**
     * Remove one product.
     *
     * @param {string} productId
     */
    function forget(productId) {
        const id = String(productId || "").trim();
        write(read().filter((item) => item.id !== id));
    }

    /** Drop everything. */
    function clear() {
        write([]);
    }

    // -----------------------------------------------------------------------
    // The server side
    // -----------------------------------------------------------------------
    //
    // `GET/POST /api/recently-viewed`, `services/recentlyViewedService.js` (453
    // lines) and the `recently_viewed` table have existed the whole time and no
    // frontend file has ever referenced the path. So a signed-in shopper's
    // history is per-browser, is lost when they clear site data, and does not
    // follow them to another device, while the store built for exactly that
    // sits empty.
    //
    // Both calls are best-effort. Recently-viewed is a convenience, and a
    // failed sync must never surface to a shopper or block a render.

    /** Whether there is an account to sync against. */
    function isSignedIn() {
        return Boolean(
            window.AppUtils
            && window.AppUtils.getToken
            && window.AppUtils.getToken()
        );
    }

    /**
     * @param {string} productId
     */
    function syncToServer(productId) {
        if (!isSignedIn() || !window.AppUtils || !window.AppUtils.apiRequest) {
            return;
        }

        window.AppUtils
            .apiRequest("/recently-viewed", {
                method: "POST",
                body: JSON.stringify({ productId })
            })
            .catch(() => {});
    }

    /**
     * Seed the local list from the account's history.
     *
     * Merged rather than replacing: what this browser has is real, and a
     * shopper who browsed signed out and then signed in should not lose it.
     *
     * @returns {Promise<Array<object>>}
     */
    async function hydrate() {
        if (!isSignedIn() || !window.AppUtils || !window.AppUtils.apiRequest) {
            return read();
        }

        try {
            const response = await window.AppUtils.apiRequest("/recently-viewed");
            const remote = Array.isArray(response && response.data)
                ? response.data
                : [];

            if (!remote.length) {
                return read();
            }

            const local = read();
            const seen = new Set(local.map((item) => item.id));
            const merged = local.slice();

            for (const item of remote) {
                const entry = normalise(item);
                if (!entry || seen.has(entry.id)) continue;

                seen.add(entry.id);
                merged.push(entry);
            }

            merged.sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0));
            write(merged);

            return merged.slice(0, MAX_ENTRIES);
        } catch (error) {
            return read();
        }
    }

    /**
     * @param {string|null} value
     * @returns {*}
     */
    function safeParse(value) {
        if (!value) return [];
        try {
            return JSON.parse(value);
        } catch (error) {
            return [];
        }
    }

    window.RecentlyViewed = {
        STORAGE_KEY,
        MAX_ENTRIES,
        MAX_AGE_MS,
        record,
        list,
        forget,
        clear,
        hydrate,
        normalise
    };
})();
