// frontend/scripts/compare.js
//
// The side-by-side comparison matrix (#1611).
//
// WHY EVERY ID IS A STRING HERE
//
// `products.id` is a CHAR(36) UUID. This file used to identify products with
// `Number()`:
//
//     const removeId = Number(btn.dataset.removeId);                    // NaN
//     compareProductIds.filter((id) => Number(id) !== removeId);        // keeps all
//
//     const prodId = Number(btn.dataset.productId);                     // NaN
//     loadedProducts.find((p) => Number(p.id) === prodId);              // matches none
//
// `Number("f3a0d99c-…")` is NaN and NaN is not equal to itself, so the remove
// filter kept every element and the cart lookup matched nothing -- for 100% of
// products, not some of them. Add to Cart failed into `if (targetProd)` and so
// produced no toast, no console error and no change: the button was simply
// dead. `recentlyViewed.js` had the identical defect and was fixed in #1497;
// this file was not part of that change.
//
// Ids are therefore compared through `sameId` and normalised to strings on the
// way in and out of storage. There is no path here that turns one into a
// number.
//
// WHY THE STORAGE READ IS NOT AN `||`
//
//     getJSON("compareProducts", []) || getJSON("comparisonList", [])
//
// `getJSON(key, [])` returns the default `[]` when the key is absent, and `[]`
// is truthy -- so the right-hand side was unreachable and a visitor whose list
// lived under `comparisonList` got the empty state. The fallback is on
// emptiness now, which is what it was always meant to be.

(() => {
    const compareMatrixContent = document.getElementById("compare-matrix-content");
    const sortSelect = document.getElementById("compare-sort-select");
    const toggleDiffCheckbox = document.getElementById("toggle-diff-checkbox");
    const clearCompareBtn = document.getElementById("clear-compare-btn");

    // Both keys are written on every mutation so either can be the source of
    // truth for a page that only knows about one of them.
    const STORAGE_KEYS = ["compareProducts", "comparisonList"];

    /**
     * Are these two ids the same product?
     *
     * The one comparison in this file, so no call site can reintroduce a
     * numeric coercion. String, because that is what a UUID is.
     *
     * @param {unknown} a
     * @param {unknown} b
     * @returns {boolean}
     */
    const sameId = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();

    /**
     * Clean a stored list into ids we can actually use.
     *
     * Trims, drops blanks and de-duplicates while preserving order. Numbers are
     * accepted and stringified: older builds stored integer ids, and those
     * lists should keep working rather than silently emptying.
     *
     * @param {unknown} value
     * @returns {string[]}
     */
    const normalizeIds = (value) => {
        if (!Array.isArray(value)) return [];

        const seen = new Set();

        return value.reduce((ids, entry) => {
            const id = String(entry ?? "").trim();
            if (!id || seen.has(id)) return ids;
            seen.add(id);
            ids.push(id);
            return ids;
        }, []);
    };

    /**
     * The comparison list as stored.
     *
     * Tries each key in turn and takes the first that actually holds
     * something, rather than the first that returns a truthy value -- an empty
     * array is truthy, which is what made the second key unreachable.
     *
     * @returns {string[]}
     */
    const readStoredIds = () => {
        for (const key of STORAGE_KEYS) {
            const ids = normalizeIds(AppUtils.getJSON(key, []));
            if (ids.length) return ids;
        }
        return [];
    };

    /**
     * Persist the list under every key the storefront reads.
     *
     * @param {string[]} ids
     */
    const writeStoredIds = (ids) => {
        const normalized = normalizeIds(ids);
        STORAGE_KEYS.forEach((key) => AppUtils.setJSON(key, normalized));
        return normalized;
    };

    let compareProductIds = readStoredIds();
    let loadedProducts = [];
    let compareWorker = null;

    // Initialize Web Worker if available
    try {
        if (window.Worker) {
            compareWorker = new Worker("scripts/compare-worker.js");
            compareWorker.onmessage = (e) => {
                const { action, products, specMatrix } = e.data;
                if (action === "PROCESS_COMPARISON_RESULT") {
                    renderMatrixUI(products, specMatrix);
                }
            };
        }
    } catch (err) {
        console.warn("Web Worker initialization failed, falling back to main thread:", err);
    }

    async function loadProducts() {
        if (!compareProductIds || !compareProductIds.length) {
            renderEmptyState();
            return;
        }

        if (compareMatrixContent) {
            compareMatrixContent.innerHTML = `
                <div style="text-align: center; padding: 40px 0;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #088178;"></i>
                    <p style="margin-top: 12px;">Processing comparison matrix...</p>
                </div>
            `;
        }

        try {
            const results = await Promise.allSettled(
                compareProductIds.map((id) => AppUtils.apiRequest(`/products/${encodeURIComponent(id)}`))
            );

            loadedProducts = results
                .filter((res) => res.status === "fulfilled" && res.value && res.value.product)
                .map((res) => res.value.product);

            // A product that no longer resolves -- withdrawn, deleted, or an id
            // left over from an older build -- is dropped from the stored list
            // rather than being retried on every visit and counting against the
            // three-product cap forever.
            const resolved = normalizeIds(loadedProducts.map((product) => product.id));
            if (resolved.length !== compareProductIds.length) {
                compareProductIds = writeStoredIds(
                    compareProductIds.filter((id) => resolved.some((found) => sameId(found, id)))
                );
            }

            if (!loadedProducts.length) {
                renderEmptyState();
                return;
            }

            processMatrix();
        } catch (error) {
            console.error("COMPARE LOAD ERROR:", error);
            if (compareMatrixContent) {
                compareMatrixContent.innerHTML = `<h3 style="text-align: center; padding: 40px; color: #ef4444;">Failed to load comparison data.</h3>`;
            }
        }
    }

    function processMatrix() {
        const sortBy = sortSelect ? sortSelect.value : "";
        const highlightDifferencesOnly = toggleDiffCheckbox ? toggleDiffCheckbox.checked : false;

        if (compareWorker) {
            compareWorker.postMessage({
                action: "PROCESS_COMPARISON",
                products: loadedProducts,
                sortBy,
                highlightDifferencesOnly
            });
        } else {
            // Main-thread fallback logic
            const specKeys = [
                { key: "price", label: "Price", type: "currency" },
                { key: "rating", label: "Customer Rating", type: "rating" },
                { key: "category", label: "Category", type: "text" },
                { key: "brand", label: "Brand / Maker", type: "text" },
                { key: "num_reviews", label: "Total Reviews", type: "number" },
                { key: "stock", label: "Stock Availability", type: "stock" }
            ];

            let sorted = [...loadedProducts];
            if (sortBy === "price-asc") sorted.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
            if (sortBy === "price-desc") sorted.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
            if (sortBy === "rating-desc") sorted.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
            if (sortBy === "name-asc") sorted.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

            const specMatrix = specKeys.map((spec) => {
                const values = sorted.map((p) => (p[spec.key] !== undefined && p[spec.key] !== null ? p[spec.key] : "N/A"));
                const isDifferent = values.some((val) => String(val) !== String(values[0]));
                let bestValue = null;
                if (spec.type === "currency") {
                    const numVals = values.map(v => Number(v)).filter(v => !isNaN(v));
                    if (numVals.length) bestValue = Math.min(...numVals);
                } else if (spec.type === "rating" || spec.type === "number") {
                    const numVals = values.map(v => Number(v)).filter(v => !isNaN(v));
                    if (numVals.length) bestValue = Math.max(...numVals);
                }
                return { key: spec.key, label: spec.label, type: spec.type, values, isDifferent, bestValue };
            });

            const filteredMatrix = highlightDifferencesOnly ? specMatrix.filter(r => r.isDifferent) : specMatrix;
            renderMatrixUI(sorted, filteredMatrix);
        }
    }

    function renderMatrixUI(products, specMatrix) {
        if (!compareMatrixContent) return;

        if (!products.length || !specMatrix.length) {
            compareMatrixContent.innerHTML = `<h3 style="text-align: center; padding: 40px;">No specs available to compare.</h3>`;
            return;
        }

        let html = `
            <table class="compare-matrix-table">
                <thead>
                    <tr>
                        <th>Specifications</th>
                        ${products.map((p) => `
                            <th class="compare-product-header">
                                <button type="button" class="compare-remove-btn" data-remove-id="${AppUtils.escapeHTML(String(p.id))}" title="Remove product">
                                    <i class="fas fa-times"></i>
                                </button>
                                <img src="${AppUtils.escapeHTML(p.image || p.img || '')}" alt="${AppUtils.escapeHTML(p.name)}" class="compare-product-img" onerror="this.src='assets/images/logo.png'">
                                <div class="compare-product-title">${AppUtils.escapeHTML(p.name)}</div>
                                <button type="button" class="btn btn-primary add-to-cart-btn" data-product-id="${AppUtils.escapeHTML(String(p.id))}" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px;">
                                    <i class="fas fa-shopping-cart"></i> Add to Cart
                                </button>
                            </th>
                        `).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${specMatrix.map((row) => `
                        <tr class="${row.isDifferent ? 'highlight-diff' : ''}">
                            <td>${AppUtils.escapeHTML(row.label)}</td>
                            ${row.values.map((val) => {
                                const isBest = row.bestValue !== null
                                    && row.bestValue !== undefined
                                    && Number.isFinite(Number(val))
                                    && Number(val) === Number(row.bestValue);
                                let formattedVal = AppUtils.escapeHTML(String(val));

                                if (row.type === 'currency') {
                                    formattedVal = AppUtils.formatPrice(val);
                                } else if (row.type === 'rating') {
                                    formattedVal = `⭐ ${Number(val).toFixed(1)}`;
                                }

                                return `
                                    <td class="${isBest ? 'best-value' : ''}">
                                        ${formattedVal}
                                        ${isBest ? '<span class="best-badge">BEST</span>' : ''}
                                    </td>
                                `;
                            }).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;

        compareMatrixContent.innerHTML = html;

        // Bind Remove buttons
        compareMatrixContent.querySelectorAll(".compare-remove-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const removeId = btn.dataset.removeId;

                compareProductIds = writeStoredIds(
                    compareProductIds.filter((id) => !sameId(id, removeId))
                );

                // Drop it from what has already been fetched too, so the
                // re-render does not have to wait on the network to stop
                // showing a product the user just removed.
                loadedProducts = loadedProducts.filter((product) => !sameId(product.id, removeId));

                AppUtils.notify("Product removed from comparison", "info");

                if (!compareProductIds.length) {
                    renderEmptyState();
                    return;
                }

                processMatrix();
            });
        });

        // Bind Add to Cart buttons
        compareMatrixContent.querySelectorAll(".add-to-cart-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const prodId = btn.dataset.productId;
                const targetProd = loadedProducts.find((p) => sameId(p.id, prodId));

                if (!targetProd) {
                    // Reachable only if the render and the loaded set have
                    // drifted. Silence here is what made the original defect so
                    // hard to spot, so it says something now.
                    console.warn("COMPARE: no loaded product for id", prodId);
                    AppUtils.notify("That product is no longer available", "warning");
                    return;
                }

                AppUtils.addCartItem(targetProd);
                AppUtils.notify(`Added ${targetProd.name} to cart`, "success");
            });
        });
    }

    function renderEmptyState() {
        if (!compareMatrixContent) return;
        compareMatrixContent.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <i class="fas fa-balance-scale" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 16px;"></i>
                <h3>No Products Selected for Comparison</h3>
                <p style="color: #64748b; margin-bottom: 20px;">Add items to your comparison list from the shop to view detailed specs side by side.</p>
                <a href="shop.html" class="btn" style="padding: 10px 24px; background: #088178; color: #fff; border-radius: 8px; text-decoration: none; display: inline-block;">
                    Browse Shop
                </a>
            </div>
        `;
    }

    // Event Listeners
    if (sortSelect) {
        sortSelect.addEventListener("change", processMatrix);
    }

    if (toggleDiffCheckbox) {
        toggleDiffCheckbox.addEventListener("change", processMatrix);
    }

    if (clearCompareBtn) {
        clearCompareBtn.addEventListener("click", () => {
            if (confirm("Clear all items from comparison matrix?")) {
                compareProductIds = writeStoredIds([]);
                loadedProducts = [];
                renderEmptyState();
                AppUtils.notify("Comparison list cleared", "info");
            }
        });
    }

    // Initialize.
    //
    // Against readyState rather than a bare DOMContentLoaded listener: the tag
    // is a plain <script> today, so the event has not fired yet, but a `defer`
    // or `async` added later would mean the listener is registered after the
    // event and the page never loads anything at all.
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", loadProducts);
    } else {
        loadProducts();
    }

    // Exposed for tests. The IIFE keeps everything else private; these three are
    // the pure pieces worth asserting on directly.
    if (typeof window !== "undefined") {
        window.__compareInternals = { sameId, normalizeIds, readStoredIds, writeStoredIds };
    }
})();
