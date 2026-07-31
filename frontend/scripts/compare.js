(() => {
    const compareMatrixContent = document.getElementById("compare-matrix-content");
    const sortSelect = document.getElementById("compare-sort-select");
    const toggleDiffCheckbox = document.getElementById("toggle-diff-checkbox");
    const clearCompareBtn = document.getElementById("clear-compare-btn");

    let compareProductIds = AppUtils.getJSON("compareProducts", []) || AppUtils.getJSON("comparisonList", []);
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
                compareProductIds.map((id) => AppUtils.apiRequest(`/products/${id}`))
            );

            loadedProducts = results
                .filter((res) => res.status === "fulfilled" && res.value && res.value.product)
                .map((res) => res.value.product);

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
                const values = sorted.map((p) => p[spec.key] !== undefined ? p[spec.key] : "N/A");
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
                                <button type="button" class="compare-remove-btn" data-remove-id="${p.id}" title="Remove product">
                                    <i class="fas fa-times"></i>
                                </button>
                                <img src="${AppUtils.escapeHTML(p.image || p.img || '')}" alt="${AppUtils.escapeHTML(p.name)}" class="compare-product-img" onerror="this.src='assets/images/logo.png'">
                                <div class="compare-product-title">${AppUtils.escapeHTML(p.name)}</div>
                                <button type="button" class="btn btn-primary add-to-cart-btn" data-product-id="${p.id}" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px;">
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
                                const isBest = row.bestValue !== null && row.bestValue !== undefined && Number(val) === Number(row.bestValue);
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
                const removeId = Number(btn.dataset.removeId);
                compareProductIds = compareProductIds.filter((id) => Number(id) !== removeId);
                AppUtils.setJSON("compareProducts", compareProductIds);
                AppUtils.setJSON("comparisonList", compareProductIds);
                AppUtils.notify("Product removed from comparison", "info");
                loadProducts();
            });
        });

        // Bind Add to Cart buttons
        compareMatrixContent.querySelectorAll(".add-to-cart-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const prodId = Number(btn.dataset.productId);
                const targetProd = loadedProducts.find((p) => Number(p.id) === prodId);
                if (targetProd) {
                    AppUtils.addCartItem(targetProd);
                    AppUtils.notify(`Added ${targetProd.name} to cart`, "success");
                }
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
                compareProductIds = [];
                AppUtils.setJSON("compareProducts", []);
                AppUtils.setJSON("comparisonList", []);
                renderEmptyState();
                AppUtils.notify("Comparison list cleared", "info");
            }
        });
    }

    // Initialize
    document.addEventListener("DOMContentLoaded", loadProducts);
})();