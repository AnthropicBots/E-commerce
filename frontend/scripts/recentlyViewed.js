// frontend/scripts/recentlyViewed.js
//
// The Recently Viewed carousel on the homepage (#1497).
//
// This file used to be a `type="module"` script that began:
//
//     import { getJSON, setJSON, $, defaultImage, safeText, safePrice,
//              formatPrice, apiRequest, notify } from "./utils.js";
//
// `utils.js` contains no `export` statement at all -- it is a classic script
// that assigns `window.AppUtils` -- and two of those names, `safeText` and
// `safePrice`, do not exist in it under any spelling. So the import failed at
// module-resolution time:
//
//     Uncaught SyntaxError: The requested module './utils.js'
//     does not provide an export named 'getJSON'
//
// The whole module was discarded before a line of it ran. `loadRecentlyViewed`
// never executed, `window.loadRecentlyViewed` was never assigned, and the call
// home-init.js makes to it was guarded by `typeof ... === "function"` so the
// omission was silent. The section on the homepage has never rendered.
//
// It is a classic script now, like every other file in this directory, reading
// helpers off `window.AppUtils`.
//
// The second defect was the shape. It read the key as an array of id strings
// and fetched each one -- `apiRequest('/products/' + id)`. The writers store
// objects, so had the module ever loaded the URL would have been
// `/products/[object Object]`. It reads through window.RecentlyViewed now,
// which owns the key and hands back one shape, and renders from the stored
// fields instead of issuing six requests to recover data it already has.

(function () {
    "use strict";

    const CONTAINER_ID = "recently-viewed-container";
    const MAX_CARDS = 6;

    /** Helpers, off the global the rest of the frontend uses. */
    function utils() {
        return window.AppUtils || {};
    }

    function safeText(value, fallback = "") {
        const text = value === undefined || value === null ? "" : String(value);
        const resolved = text.trim() || fallback;

        return utils().escapeHTML ? utils().escapeHTML(resolved) : resolved;
    }

    function safePrice(value) {
        const price = Number(value);
        return Number.isFinite(price) && price >= 0 ? price : 0;
    }

    function formatPrice(value) {
        return utils().formatPrice ? utils().formatPrice(value) : `₹${value}`;
    }

    function defaultImage(value) {
        return utils().defaultImage ? utils().defaultImage(value) : value || "";
    }

    // ========================================
    // STOCK STATUS HELPERS (Issue #1123)
    // ========================================

    function getStockBadgeHTML(stock) {
        const stockNum = Number(stock) || 0;

        if (stockNum === 0) {
            return `<span class="stock-badge out-of-stock">Out of Stock</span>`;
        }
        if (stockNum <= 5) {
            return `<span class="stock-badge low-stock">Only ${stockNum} left</span>`;
        }
        return `<span class="stock-badge in-stock">In Stock</span>`;
    }

    function getOutOfStockOverlayHTML(stock) {
        // Via isOutOfStock, not `Number(stock) === 0`: `Number(null)` and
        // `Number(undefined && "")` are 0, so a stored entry with no stock
        // figure was rendered as sold out.
        return isOutOfStock(stock)
            ? `<div class="out-of-stock-overlay">Sold Out</div>`
            : "";
    }

    function getLowStockTextHTML(stock) {
        const stockNum = Number(stock) || 0;

        if (stockNum > 0 && stockNum <= 5) {
            return `<span class="low-stock-text">⚡ Hurry! Only ${stockNum} left</span>`;
        }
        return "";
    }

    /**
     * Whether a product is known to be out of stock.
     *
     * A stored entry may carry no stock figure at all, and "unknown" is not
     * "sold out" -- the old check was `Number(stock) === 0`, which reads
     * `undefined` as in stock and `null` as sold out.
     */
    function isOutOfStock(stock) {
        if (stock === null || stock === undefined || stock === "") {
            return false;
        }
        return Number(stock) === 0;
    }

    // ========================================
    // RECENTLY VIEWED PRODUCT CARD
    // ========================================

    function renderRecentlyViewedCard(product) {
        if (!product) return "";

        const stock = product.stock;
        const outOfStock = isOutOfStock(stock);
        const outOfStockClass = outOfStock ? "out-of-stock" : "";
        const productId = safeText(product.id);

        const rating = Math.min(5, Math.max(0, Number(product.rating || 4)));
        const stars = Array.from({ length: 5 }, (_, index) =>
            `<i class="fas fa-star${index < rating ? "" : "-o"}"></i>`
        ).join("");

        return `
        <div class="pro ${outOfStockClass}" data-id="${productId}">
            <div style="position: relative;">
                <img
                    src="${defaultImage(product.image)}"
                    alt="${safeText(product.name, "Product")}"
                    loading="lazy"
                >
                ${stock === null || stock === undefined ? "" : getStockBadgeHTML(stock)}
                ${getOutOfStockOverlayHTML(stock)}
                <span class="product-badge" style="background: #6c3bff;">Recently Viewed</span>
            </div>
            <div class="des">
                <span>${safeText(product.category, "Fashion")}</span>
                <h5>${safeText(product.name, "Product")}</h5>
                <div class="star">${stars}</div>
                <h4>${formatPrice(safePrice(product.price))}</h4>
                ${getLowStockTextHTML(stock)}
            </div>
            ${!outOfStock
                ? `<a href="product.html?id=${encodeURIComponent(product.id)}" class="cart"><i class="fas fa-shopping-cart"></i></a>`
                : ""}
        </div>
    `;
    }

    function emptyState(message, hint, icon) {
        return `
            <div class="empty-recent" style="width:100%; padding:60px 20px; text-align:center; color:#888; font-size:16px; background:#f9f9f9; border-radius:12px;">
                <i class="fas ${icon}" style="font-size:48px; color:#ccc; display:block; margin-bottom:15px;"></i>
                <p>${message}</p>
                ${hint ? `<p style="font-size:14px; margin-top:8px; opacity:0.7;">${hint}</p>` : ""}
            </div>
        `;
    }

    // ========================================
    // LOAD RECENTLY VIEWED PRODUCTS
    // ========================================

    async function loadRecentlyViewed() {
        const container = document.getElementById(CONTAINER_ID);
        if (!container) return;

        const store = window.RecentlyViewed;

        if (!store) {
            console.warn(
                "recently-viewed-store.js is not loaded; skipping Recently Viewed"
            );
            return;
        }

        // Seed from the account before reading, so history follows a signed-in
        // shopper from another device. A no-op when signed out, and it never
        // rejects.
        await store.hydrate();

        let entries = store.list().slice(0, MAX_CARDS);

        if (!entries.length) {
            container.innerHTML = emptyState(
                "No recently viewed products yet.",
                "Start browsing to see products you've viewed here!",
                "fa-eye-slash"
            );
            return;
        }

        // Entries stored by an older build hold only an id, so they have no
        // name or price to render. Those -- and only those -- are fetched.
        const partial = entries.filter((entry) => entry.partial);

        if (partial.length) {
            if (utils().renderSkeletonState) {
                utils().renderSkeletonState(container, entries.length);
            }

            entries = await fillIn(entries, partial);
        }

        const renderable = entries.filter((entry) => !entry.partial);

        if (!renderable.length) {
            container.innerHTML = emptyState(
                "No recently viewed products available.",
                "",
                "fa-exclamation-circle"
            );
            return;
        }

        container.innerHTML = renderable.map(renderRecentlyViewedCard).join("");

        if (typeof window.initializeScrollAnimations === "function") {
            window.initializeScrollAnimations();
        }
    }

    /**
     * Fetch the products behind id-only entries.
     *
     * One request each, and only for entries that need one. The previous
     * implementation issued a request for every entry on every homepage load,
     * to recover fields the writers had already stored.
     *
     * @param {Array<object>} entries
     * @param {Array<object>} partial
     * @returns {Promise<Array<object>>}
     */
    async function fillIn(entries, partial) {
        if (!utils().apiRequest) {
            return entries;
        }

        const fetched = await Promise.all(
            partial.map((entry) =>
                utils()
                    .apiRequest(`/products/${encodeURIComponent(entry.id)}`)
                    .then((response) => response && response.product)
                    .catch(() => null)
            )
        );

        const byId = new Map();

        fetched.filter(Boolean).forEach((product) => {
            byId.set(String(product.id), product);
        });

        return entries.map((entry) => {
            const product = byId.get(entry.id);

            if (!product) return entry;

            return {
                ...entry,
                name: product.name,
                category: product.category,
                price: product.price,
                image: product.image,
                stock: product.stock,
                rating: product.rating,
                partial: false
            };
        });
    }

    // ========================================
    // EXPOSE GLOBALLY
    // ========================================

    window.loadRecentlyViewed = loadRecentlyViewed;
    window.renderRecentlyViewedCard = renderRecentlyViewedCard;

    // Auto-load when DOM is ready. home-init.js also calls this behind a
    // `typeof === "function"` guard -- which is how the module never loading
    // stayed silent -- and loadRecentlyViewed is safe to call twice.
    document.addEventListener("DOMContentLoaded", function () {
        setTimeout(() => {
            loadRecentlyViewed().catch((error) => {
                console.error("Error loading recently viewed:", error);
            });
        }, 500);
    });
})();
