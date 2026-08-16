// PRODUCTS STATE
(function(){
let allProducts = [];
let filteredProducts = [];

// SERVER PAGINATION / INFINITE SCROLL STATE
// The catalog is streamed from the backend one page at a time and appended
// to `allProducts`; all filtering/sorting still happens client-side over the
// accumulated set. `sort` is the one dimension driven server-side so the
// paginated order stays globally consistent across pages.
let serverPage = 0;
let serverTotalPages = 1;
let serverHasNext = true;
let isFetchingPage = false;
let catalogExhausted = false;
let lastServerSort = "";
let priceTouched = false;
let productObserver = null;
const loadedProductIds = new Set();

// Legacy filter-button state, read and written by setupCategoryFilters,
// setupSearch and clearAllFilters. These were only ever assigned, never
// declared, so each one leaked onto `window` -- harmless while the file did
// not parse at all, and worth closing now that it does (#1444).
let currentCategory = "all";
let currentSearch = "";
let showAllHoodies = false;

// Local fallback sample products (used when backend returns no products)
const fallbackProducts = (window.CATEGORIES_DATA && window.CATEGORIES_DATA.fallbackProducts) || [
    { id: 'ft1', name: 'Classic Cotton T-Shirt', description: 'Summer collection soft cotton tee.', price: 19.99, image: '', category: 'T-Shirts', stock: 50, rating: 4, sales_count: 190 }
];

const SEARCH_HISTORY_KEY =
    "advancedProductSearchHistory";

const SHOP_IMAGE_FALLBACK =
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="Product image unavailable">
            <rect width="600" height="600" rx="36" fill="#f3f4f6"/>
            <rect x="110" y="110" width="380" height="380" rx="28" fill="#e5e7eb"/>
            <path d="M190 405l70-82 54 62 40-48 94 106H190z" fill="#cbd5e1"/>
            <circle cx="255" cy="240" r="34" fill="#cbd5e1"/>
            <text x="300" y="515" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#6b7280">Image unavailable</text>
        </svg>`
    );

// Number of products requested per backend page (server-side pagination).
const PAGE_SIZE =
    globalThis.CONFIG?.PRODUCTS_PER_PAGE || 12;

let filters = {
    search: "",
    categories: [],
    megaCategory: "",
    megaSubcategory: "",
    minPrice: 0,
    maxPrice: 0,
    rating: 0,
    availability: [],
    sort: "newest"
};

let priceBounds = {
    min: 0,
    max: 0
};

let activeSuggestionIndex = -1;
let searchHistory = [];
let hasAppliedUrlFilters = false;

// SHOP PAGE ELEMENTS
const elements = {};

const cacheShopElements = () => {
    elements.searchInput = document.getElementById("search-input");
    elements.suggestions = document.getElementById("search-suggestions");
    elements.searchForm = document.querySelector(".search-box");
};

const getFilterUtils = () =>
    globalThis.ShopFilterUtils;

const getStoredSearchHistory = () =>
    AppUtils.safeArray(
        AppUtils.getJSON(
            SEARCH_HISTORY_KEY,
            []
        )
    ).filter(Boolean);

const saveSearchHistory = (term) => {
    const normalizedTerm =
        String(term || "").trim();

    if (!normalizedTerm) {
        return;
    }

    searchHistory = [
        normalizedTerm,
        ...searchHistory.filter(
            (item) =>
                item.toLowerCase() !== normalizedTerm.toLowerCase()
        )
    ].slice(0, 8);

    AppUtils.setJSON(
        SEARCH_HISTORY_KEY,
        searchHistory
    );
};

function getProductImageSrc(image) {
    const resolvedImage = AppUtils.defaultImage(image);

    return resolvedImage && resolvedImage !== "assets/images/default-product.png"
        ? resolvedImage
        : SHOP_IMAGE_FALLBACK;
}

function getWishlistIconClass(productId) {
    const isWishlisted = AppUtils.getWishlist().some(
        (item) => String(item.id) === String(productId)
    );

    return isWishlisted ? "fas" : "far";
}

function updateWishlistButtons(productId, isWishlisted) {
    const buttons = document.querySelectorAll(
        `.wishlist-btn[data-id="${productId}"], .wishlist-btn-shop[data-id="${productId}"]`
    );

    buttons.forEach((btn) => {
        const icon = btn.querySelector("i");

        if (!icon) {
            return;
        }

        icon.classList.toggle("fas", isWishlisted);
        icon.classList.toggle("far", !isWishlisted);
    });
}

function resetCategoryCheckboxes() {
    const categoryCheckboxes = document.querySelectorAll('input[name="category-filter"]');

    categoryCheckboxes.forEach((checkbox) => {
        checkbox.checked = false;
    });
}

async function syncWishlistFallback(product) {
    let wishlist = AppUtils.getWishlist();
    const exists = wishlist.some((item) => String(item.id) === String(product.id));
    const token = AppUtils.getToken();

    if (exists) {
        wishlist = wishlist.filter((item) => String(item.id) !== String(product.id));
        AppUtils.notify("Removed from wishlist", "info");

        if (token) {
            try {
                await AppUtils.apiRequest("/wishlist/remove", {
                    method: "POST",
                    body: JSON.stringify({ productId: product.id })
                });
            } catch (error) {
                console.warn("Failed to sync wishlist removal:", error);
            }
        }
    } else {
        wishlist.push(product);
        AppUtils.notify("Added to wishlist ❤️", "success");

        if (token) {
            try {
                await AppUtils.apiRequest("/wishlist/add", {
                    method: "POST",
                    body: JSON.stringify({ productId: product.id })
                });
            } catch (error) {
                console.warn("Failed to sync wishlist addition:", error);
            }
        }
    }

    AppUtils.saveWishlist(wishlist);
    updateWishlistButtons(product.id, !exists);
}

// Reset accumulated catalog state so the next load starts from page 1.
function resetCatalog() {
    allProducts = [];
    loadedProductIds.clear();
    serverPage = 0;
    serverTotalPages = 1;
    serverHasNext = true;
    catalogExhausted = false;
}

// Build the paginated products endpoint. `sort` round-trips to the backend so
// each page is ordered consistently; search/category/price/rating/availability
// stay client-side over the accumulated catalog.
function buildProductsQuery(page) {
    const params =
        new URLSearchParams();

    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));

    if (filters.sort) {
        params.set("sort", filters.sort);
    }

    if (priceTouched && Number.isFinite(Number(filters.minPrice))) {
        params.set("minPrice", String(filters.minPrice));
    }

    if (priceTouched && Number.isFinite(Number(filters.maxPrice))) {
        params.set("maxPrice", String(filters.maxPrice));
    }

    return `/products?${params.toString()}`;
}

// Append a freshly fetched page to the catalog, skipping ids already loaded so
// a re-fetch can never duplicate cards.
function appendProducts(products) {
    AppUtils.safeArray(products).forEach((product) => {
        const key = String(product.id);

        if (loadedProductIds.has(key)) {
            return;
        }

        loadedProductIds.add(key);
        allProducts.push(product);
    });
}

// Fetch the next backend page and merge it in. Guards against concurrent or
// past-the-end requests so the IntersectionObserver can fire freely.
async function loadNextProductsPage() {
    if (isFetchingPage || !serverHasNext) {
        return;
    }

    const isFirstPage = serverPage === 0;
    isFetchingPage = true;
    if (isFirstPage && elements.productContainer && allProducts.length === 0) {
        AppUtils.renderSkeletonState(elements.productContainer, 8);
    }
    renderScrollStatus();

    try {
        const data =
            await AppUtils.apiRequest(
                buildProductsQuery(serverPage + 1)
            );

        const products =
            data && data.success
                ? AppUtils.safeArray(data.products)
                : [];

        if (isFirstPage && products.length === 0) {
            // Backend reachable but empty (or unsuccessful) — fall back to the
            // bundled sample catalog so the shop is never blank.
            appendProducts(fallbackProducts);
            serverHasNext = false;
            catalogExhausted = true;
        } else {
            appendProducts(products);
            serverPage += 1;
            serverTotalPages =
                Number(data.totalPages) || serverTotalPages;
            serverHasNext =
                data.hasNextPage === true
                || serverPage < serverTotalPages;
            catalogExhausted = !serverHasNext;
        }
    } catch (error) {
        console.error("SHOP FETCH ERROR:", error);

        if (isFirstPage) {
            appendProducts(fallbackProducts);
        }

        serverHasNext = false;
        catalogExhausted = true;
    } finally {
        isFetchingPage = false;
    }

    if (isFirstPage) {
        initializeFilterControls();
    } else {
        refreshFilterControls();
    }

    applyFilters();

    // Keep filling the viewport: when a client-side filter yields a short grid
    // (or the first page is shorter than the screen) the sentinel stays visible,
    // so pull the next page until the viewport is full or the catalog is drained.
    maybeAutoLoadMore();
}

// Load more automatically while the sentinel is on screen. This is what makes
// client-side search/category filtering work across the whole catalog: sparse
// results leave the sentinel visible, which drains remaining pages.
function maybeAutoLoadMore() {
    if (!serverHasNext || isFetchingPage || !productObserver) {
        return;
    }

    const sentinel =
        document.getElementById("product-scroll-sentinel");

    if (!sentinel) {
        return;
    }

    requestAnimationFrame(() => {
        const rect = sentinel.getBoundingClientRect();
        const viewportHeight =
            globalThis.innerHeight || document.documentElement.clientHeight;

        if (rect.top <= viewportHeight + 200) {
            loadNextProductsPage();
        }
    });
}

// FETCH PRODUCTS — entry point: reset and stream the catalog from page 1.
function fetchProducts() {
    searchHistory =
        getStoredSearchHistory();

    lastServerSort =
        elements.sortSelect?.value || "newest";
    filters.sort = lastServerSort;

    resetCatalog();
    setupProductObserver();
    loadNextProductsPage();
}

// EMPTY STATE
function renderEmptyState(
    message
) {
    if (
        !elements.productContainer
    ) {
        return;
    }
    elements.productContainer.innerHTML =
        `
            <div class="empty-products">
                <h3>${message}</h3>
            </div>
        `;
}

// STAR RATINGS
function renderStars(
    rating = 5
) {
    const safeRating =
        Math.min(
            Math.max(
                Number(rating) || 5,
                1
            ),
            5
        );

    return Array.from(
        {
            length: safeRating
        },
        () =>
            `
                <i class="fas fa-star"></i>
            `
    ).join("");
}

// PRODUCT CARD with Stock Badge (Issue #1123)
function createProductCard(
    product
) {
    const displayName =
        product.name ||
        "Product";

    const stock =
        Number(product.stock) || 0;
    
    const isOutOfStock = stock === 0;
    const isLowStock = stock > 0 && stock <= 5;
    const outOfStockClass = isOutOfStock ? 'out-of-stock' : '';

    // Stock Badge HTML
    let badgeHTML = '';
    if (isOutOfStock) {
        badgeHTML = `<span class="stock-badge out-of-stock">Out of Stock</span>`;
    } else if (isLowStock) {
        badgeHTML = `<span class="stock-badge low-stock">Only ${stock} left</span>`;
    } else {
        badgeHTML = `<span class="stock-badge in-stock">In Stock</span>`;
    }

    // Out of Stock Overlay
    let overlayHTML = '';
    if (isOutOfStock) {
        overlayHTML = `<div class="out-of-stock-overlay">Sold Out</div>`;
    }

    // Low Stock Text
    let lowStockText = '';
    if (isLowStock && !isOutOfStock) {
        lowStockText = `<span class="low-stock-text">⚡ Hurry! Only ${stock} left</span>`;
    }

    // Action Buttons (disabled if out of stock)
    const actionButtons = isOutOfStock ? '' : `
        <div style="position: absolute; bottom: 20px; right: 12px; display: flex; gap: 8px; z-index: 2;">
            <button class="wishlist-btn-shop cart" data-id="${product.id}" aria-label="Add to Wishlist" style="position: relative; bottom: 0; right: 0;">
                <i class="${ AppUtils.getWishlist().some(item => String(item.id) === String(product.id)) ? 'fas' : 'far' } fa-heart"></i>
            </button>
            <button class="add-to-cart-icon cart" aria-label="Add to cart" style="position: relative; bottom: 0; right: 0;">
                <i class="fal fa-shopping-cart"></i>
            </button>
        </div>
    `;

    const escapedName =
        AppUtils.escapeHTML(
            displayName
        );

    const escapedId =
        encodeURIComponent(
            product.id
        );

    const brand =
        product.brand ||
        product.category ||
        "Fashion";
    const wishlistIconClass = getWishlistIconClass(product.id);

    return `
        <div
            class="pro ${outOfStockClass}"
            data-product-id="${product.id}"
        >
            <div style="position: relative;">
                <img
    src="${AppUtils.defaultImage(product.image)}"
    alt="${escapeHTML(displayName || 'Product image')}"
    loading="lazy"
>
                ${badgeHTML}
                ${overlayHTML}
            </div>

            <div class="des">
                <span>
                    ${AppUtils.escapeHTML(brand)}
                </span>
                <h5>
                    ${escapedName}
                </h5>
                <div class="star">
                    ${renderStars(
                        product.rating
                    )}
                    <span class="rating-count">
                        ${AppUtils.escapeHTML(getRatingLabel(product))}
                        <i class="${wishlistIconClass} fa-heart"></i>
                    </span>
                </div>
                <h4>
                    ${AppUtils.formatPrice(
                        product.price
                    )}
                </h4>
                ${lowStockText}
            </div>

            ${actionButtons}
        </div>
    `;
}

// RENDER PRODUCTS
function renderProducts(
    products = [],
    {
        emptyMessage = "No products found."
    } = {}
) {
    if (!elements.productContainer) return;

    if (!Array.isArray(products) || products.length === 0) {
        renderEmptyState(emptyMessage);
        return;
    }

    elements.productContainer.innerHTML = "";

    const fragment = document.createDocumentFragment();

    products.forEach((product) => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = createProductCard(product);
        const card = wrapper.firstElementChild;
        if (card) {
            const cardImage = card.querySelector("img");
            if (cardImage) {
                cardImage.addEventListener("error", () => {
                    if (cardImage.dataset.fallbackApplied === "true") {
                        return;
                    }

                    cardImage.dataset.fallbackApplied = "true";
                    cardImage.src = SHOP_IMAGE_FALLBACK;
                });
            }
            setupProductCard(card, product);
            fragment.appendChild(card);
        }
    });

    elements.productContainer.appendChild(fragment);
}

// PRODUCT CARD EVENTS
function setupProductCard(
    card,
    product
) {
    // navigate to product page
    card.addEventListener(
        "click",
        (event) => {
            if (
                event.target.closest(
                    ".add-to-cart-icon, .wishlist-btn-shop, button, a"
                )
            ) {
                return;
            }
            globalThis.location.href =
                `product.html?id=${product.id}`;
        }
    );

    // add to cart
    const cartBtn =
        card.querySelector(
            ".add-to-cart-icon"
        );

    if (!cartBtn) {
        return;
    }
    cartBtn.addEventListener(
        "click",
        async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const item = {
                id: product.id,
                name:
                    product.name ||
                    "Product",
                price:
                    Number.parseFloat(
                        product.price
                    ) || 0,
                img:
                    AppUtils.defaultImage(
                        product.image
                    ),
                qty: 1
            };

            try {
                // centralized handler
                if (
                    typeof addToCartFromProduct ===
                    "function"
                ) {
                    await addToCartFromProduct(
                        item
                    );
                    return;
                }

                // fallback cart
                const countBefore =
                    AppUtils.getCartCount();

                const cart =
                    await AppUtils.addCartItem(
                        item
                    );

                if (
                    typeof updateCartCount ===
                    "function"
                ) {
                    updateCartCount();
                }

                if (
                    typeof renderCartDrawer ===
                    "function"
                ) {
                    renderCartDrawer();
                }

                // A refused add has already told the shopper why.
                if (
                    AppUtils.getCartCount(cart)
                    <=
                    countBefore
                ) {
                    return;
                }

                AppUtils.notify(
                    "Added to cart 🛍️",
                    "success"
                );

            } catch (error) {
                console.error(
                    "CART ERROR:",
                    error
                );

                AppUtils.notify(
                    "Failed to add product.",
                    "error"
                );
            }
        }
    );

    // add to wishlist
    const wishlistBtn = card.querySelector(".wishlist-btn-shop");
    if (wishlistBtn) {
        wishlistBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();

            // Re-use logic from product-actions-home.js if it's available, otherwise fallback
            if (typeof globalThis.toggleWishlist === "function") {
                await globalThis.toggleWishlist(product);
            } else {
                await syncWishlistFallback(product);
            }
        });
    }
}

// SEARCH FILTER (Updated)
function setupSearch() {

    if (!elements.searchInput) {
        return;
    }

    const {
        category,
        subcategory
    } = getUrlCategoryFilters();

    filters.megaCategory = category;
    filters.megaSubcategory = subcategory;

    elements.searchInput.addEventListener(
        "input",
        () => {
            clearTimeout(searchTimeout);

            searchTimeout = setTimeout(() => {

                currentSearch = elements.searchInput.value.trim();
                showAllHoodies = false;
                fetchProducts(1);
                updateClearFiltersButton(); // <-- ADD THIS LINE

            }, 400);
        }
    );
}

// CATEGORY FILTER (Updated)
function setupCategoryFilters() {

    elements.filterButtons.forEach(button => {

        button.addEventListener("click", () => {

            elements.filterButtons.forEach(btn => {
                btn.classList.remove("active-filter");
            });

            button.classList.add("active-filter");

            currentCategory = button.dataset.category || "all";
            showAllHoodies = false;
            fetchProducts(1);
            updateClearFiltersButton(); // <-- ADD THIS LINE

        });
    });
}

function updateResultsSummary() {
    if (!elements.resultsSummary) {
        return;
    }

    let activeCategory = "All Products";
    if (filters.categories && filters.categories.length === 1) {
        activeCategory = filters.categories[0];
    } else if (filters.categories && filters.categories.length > 1) {
        activeCategory = "Multiple";
    } else if (filters.megaCategory) {
        activeCategory = filters.megaCategory;
    }

    const productCountText = `Showing ${filteredProducts.length} Products`;

    elements.resultsSummary.innerHTML = `
        <span class="active-category-display">Category: ${AppUtils.escapeHTML(activeCategory)}</span> |
        <span class="product-count-display">${productCountText}</span>
    `;

    const clearFiltersBtn = document.getElementById("active-clear-filters");
    if (clearFiltersBtn) {
        const hasFilters = filters.categories.length > 0 || filters.search || filters.megaCategory || filters.megaSubcategory;
        clearFiltersBtn.style.display = hasFilters ? "inline-block" : "none";
    }

    // Update active state on fashion cards
    document.querySelectorAll(".fashion-card").forEach((card) => {
        const cat = card.dataset.category;
        const isActive = filters.categories.includes(cat) || filters.megaCategory === cat;
        if (isActive) {
            card.classList.add("active");
            card.setAttribute("aria-pressed", "true");
        } else {
            card.classList.remove("active");
            card.setAttribute("aria-pressed", "false");
        }
    });
}

function closeSuggestions() {
    if (!elements.suggestions || !elements.searchInput) {
        return;
    }

    elements.suggestions.hidden = true;
    elements.suggestions.innerHTML = "";
    elements.searchInput.setAttribute("aria-expanded", "false");
    activeSuggestionIndex = -1;
}

function renderSuggestionList(items, { isHistory = false } = {}) {
    if (!elements.suggestions || !elements.searchInput) {
        return;
    }

    if (!items.length) {
        closeSuggestions();
        return;
    }

    const title =
        isHistory
            ? "Recent searches"
            : "Matching products";

    const listItems =
        items.map((item, index) => {
            if (isHistory) {
                return `
                    <li class="suggestion-item">
                        <button
                            type="button"
                            class="suggestion-button suggestion-history-button"
                            data-suggestion-index="${index}"
                            data-history-term="${AppUtils.escapeHTML(item)}"
                        >
                            <span class="suggestion-title">${AppUtils.escapeHTML(item)}</span>
                            <span class="suggestion-meta">Search again</span>
                        </button>
                    </li>
                `;
            }

            const titleText =
                item.name || item.title || "Product";

            return `
                <li class="suggestion-item">
                    <button
                        type="button"
                        class="suggestion-button"
                        data-suggestion-index="${index}"
                        data-product-id="${encodeURIComponent(item.id)}"
                    >
                        <img
                            src="${AppUtils.defaultImage(item.image)}"
                            alt=""
                            loading="lazy"
                        >
                        <span>
                            <span class="suggestion-title">${AppUtils.escapeHTML(titleText)}</span>
                            <span class="suggestion-meta">${AppUtils.escapeHTML(item.category || item.brand || "Fashion")}</span>
                        </span>
                        <span class="suggestion-price">${AppUtils.formatPrice(item.price || 0)}</span>
                    </button>
                </li>
            `;
        }).join("");

    elements.suggestions.innerHTML =
        `
            <p class="suggestion-section-title">${title}</p>
            <ul class="suggestion-list">
                ${listItems}
            </ul>
            ${
                isHistory
                    ? '<button type="button" class="clear-history-button">Clear history</button>'
                    : ""
            }
        `;

    elements.suggestions.hidden = false;
    elements.searchInput.setAttribute("aria-expanded", "true");
    activeSuggestionIndex = -1;
}

function updateActiveSuggestion(nextIndex) {
    const buttons =
        Array.from(
            elements.suggestions?.querySelectorAll(".suggestion-button") || []
        );

    if (!buttons.length) {
        return;
    }

    activeSuggestionIndex =
        (nextIndex + buttons.length) % buttons.length;

    buttons.forEach((button, index) => {
        button.classList.toggle(
            "is-active",
            index === activeSuggestionIndex
        );
    });

    buttons[activeSuggestionIndex].scrollIntoView({
        block: "nearest"
    });
}

function chooseSuggestion(button) {
    if (!button || !elements.searchInput) {
        return;
    }

    const historyTerm =
        button.dataset.historyTerm;

    if (historyTerm) {
        elements.searchInput.value =
            historyTerm;
    } else {
        const productId =
            decodeURIComponent(
                button.dataset.productId || ""
            );

        const product =
            allProducts.find(
                (item) => String(item.id) === String(productId)
            );

        elements.searchInput.value =
            product?.name || product?.title || "";
    }

    saveSearchHistory(
        elements.searchInput.value
    );
    closeSuggestions();
    applyFilters({
        resetPage: true
    });
}

// SORT SELECT (Updated)
function setupSorting() {
    if (!elements.sortSelect) {
        return;
    }
    elements.sortSelect.addEventListener("change", () => {
        applySorting();
        updateClearFiltersButton(); // <-- ADD THIS LINE
    });
}

function setupSearch() {
    if (!elements.searchInput) {
        return;
    }

    const debouncedApplyFilters =
        getFilterUtils().debounce(
            () => applyFilters({
                resetPage: true
            }),
            400
        );

    elements.searchInput.addEventListener(
        "input",
        () => {
            showSearchSuggestions();
            debouncedApplyFilters();
        }
    );

    elements.searchInput.addEventListener(
        "focus",
        showSearchSuggestions
    );

    elements.searchInput.addEventListener(
        "keydown",
        (event) => {
            const buttons =
                Array.from(
                    elements.suggestions?.querySelectorAll(".suggestion-button") || []
                );

            if (event.key === "ArrowDown" && buttons.length) {
                event.preventDefault();
                updateActiveSuggestion(activeSuggestionIndex + 1);
            }

            if (event.key === "ArrowUp" && buttons.length) {
                event.preventDefault();
                updateActiveSuggestion(activeSuggestionIndex - 1);
            }

            if (event.key === "Enter") {
                if (activeSuggestionIndex >= 0 && buttons[activeSuggestionIndex]) {
                    event.preventDefault();
                    chooseSuggestion(buttons[activeSuggestionIndex]);
                    return;
                }

                saveSearchHistory(elements.searchInput.value);
                closeSuggestions();
            }

            if (event.key === "Escape") {
                closeSuggestions();
            }
        }
    );

    elements.searchForm?.addEventListener(
        "submit",
        (event) => {
            event.preventDefault();
            saveSearchHistory(elements.searchInput.value);
            closeSuggestions();
            applyFilters({
                resetPage: true
            });
        }
    );

    elements.suggestions?.addEventListener(
        "click",
        (event) => {
            const suggestionButton =
                event.target.closest(".suggestion-button");

            if (suggestionButton) {
                chooseSuggestion(suggestionButton);
                return;
            }

            if (event.target.closest(".clear-history-button")) {
                searchHistory = [];
                AppUtils.setJSON(
                    SEARCH_HISTORY_KEY,
                    searchHistory
                );
                closeSuggestions();
            }
        }
    );

    document.addEventListener(
        "click",
        (event) => {
            if (
                !event.target.closest(".search-box")
            ) {
                closeSuggestions();
            }
        }
    );
}

function setupFilterControls() {
    elements.categoryList?.addEventListener(
        "change",
        () => applyFilters({
            resetPage: true
        })
    );

    [elements.minPriceRange, elements.maxPriceRange].forEach((range) => {
  range?.addEventListener("input", () => {
    if (range === elements.minPriceRange && elements.minPriceNumber) {
      elements.minPriceNumber.value = range.value;
    }
    if (range === elements.maxPriceRange && elements.maxPriceNumber) {
      elements.maxPriceNumber.value = range.value;
    }
    priceTouched = true;
    applyFilters({ resetPage: true });
  });
});

[elements.minPriceNumber, elements.maxPriceNumber].forEach((numInput) => {
  numInput?.addEventListener("input", () => applyFilters({ resetPage: true }));
  numInput?.addEventListener("change", () => applyFilters({ resetPage: true }));
});

    document.querySelectorAll('input[name="rating-filter"], input[name="availability-filter"]')
        .forEach((input) => {
            input.addEventListener(
                "change",
                () => applyFilters({
                    resetPage: true
                })
            );
        });

    elements.sortSelect?.addEventListener(
        "change",
        () => applyFilters({
            resetPage: true
        })
    );

    elements.clearFilters?.addEventListener(
        "click",
        () => {
            if (elements.searchInput) {
                elements.searchInput.value = "";
            }

            document.querySelectorAll('input[name="category-filter"], input[name="availability-filter"]')
                .forEach((input) => {
                    input.checked = false;
                });

            const allRatings =
                document.querySelector('input[name="rating-filter"][value="0"]');

            if (allRatings) {
                allRatings.checked = true;
            }

            if (elements.sortSelect) {
                elements.sortSelect.value = "newest";
            }

            priceTouched = false;
            filters.minPrice = priceBounds.min;
            filters.maxPrice = priceBounds.max;
            filters.megaCategory = "";
            filters.megaSubcategory = "";
            hasAppliedUrlFilters = true;
            updatePriceControls();
            closeSuggestions();
            applyFilters({
                resetPage: true
            });
        }
    );
}

function setFilterDrawer(open) {
    elements.filterSidebar?.classList.toggle(
        "is-open",
        open
    );

    if (elements.filterBackdrop) {
        elements.filterBackdrop.hidden =
            !open;
    }

    elements.mobileFilterToggle?.setAttribute(
        "aria-expanded",
        String(open)
    );
}

function setupFilterDrawer() {
    elements.mobileFilterToggle?.addEventListener(
        "click",
        () => setFilterDrawer(true)
    );

    elements.closeFilterSidebar?.addEventListener(
        "click",
        () => setFilterDrawer(false)
    );

    elements.filterBackdrop?.addEventListener(
        "click",
        () => setFilterDrawer(false)
    );

    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Escape") {
                setFilterDrawer(false);
            }
        }
    );
}

// INITIALIZATION (Updated)
document.addEventListener("DOMContentLoaded", () => {
    cacheShopElements();
    fetchProducts();
    setupSearch();
    setupCategoryFilters();
    setupSorting();
    setupClearFilters(); // <-- ADD THIS LINE
    updateClearFiltersButton(); // <-- ADD THIS LINE
});

// ========================================
// CLEAR FILTERS BUTTON (Issue #1124)
// ========================================

// Elements
const clearFiltersBtn = document.getElementById('clear-filters-btn');
const searchInput = document.getElementById('search-input');
const filterButtons = document.querySelectorAll('.filter-btn');
const sortSelect = document.getElementById('sort-select');

// Check if any filter is active
function isAnyFilterActive() {
    const searchValue = searchInput?.value?.trim() || '';
    const activeCategory = document.querySelector('.filter-btn.active-filter')?.dataset?.category || 'all';
    const sortValue = sortSelect?.value || 'default';
    
    return searchValue !== '' || activeCategory !== 'all' || sortValue !== 'default';
}

// Show/hide clear filters button
function updateClearFiltersButton() {
    if (!clearFiltersBtn) return;
    
    if (isAnyFilterActive()) {
        clearFiltersBtn.style.display = 'inline-flex';
        clearFiltersBtn.classList.add('show');
    } else {
        clearFiltersBtn.style.display = 'none';
        clearFiltersBtn.classList.remove('show');
    }
}

// INITIALIZATION
document.addEventListener(
    "DOMContentLoaded",
    () => {
        elements.searchForm = document.getElementById("shop-search-form");
        elements.searchInput = document.getElementById("search-input");
        elements.suggestions = document.getElementById("search-suggestions");
        elements.categoryList = document.getElementById("category-filter-list");
        elements.minPriceRange = document.getElementById("min-price-range");
        elements.maxPriceRange = document.getElementById("max-price-range");
        elements.priceOutput = document.getElementById("price-range-output");
        elements.sortSelect = document.getElementById("product-sort");
        elements.productContainer = document.getElementById("product-container");
        elements.resultsSummary = document.getElementById("results-summary");
        elements.filterSidebar = document.getElementById("filter-sidebar");
        elements.filterBackdrop = document.getElementById("filter-backdrop");
        elements.mobileFilterToggle = document.getElementById("mobile-filter-toggle");
        elements.closeFilterSidebar = document.getElementById("close-filter-sidebar");
        elements.clearFilters = document.getElementById("clear-filters");

        setupSearch();
        setupFilterControls();
        setupFilterDrawer();
        fetchProducts();

        const activeClearFiltersBtn = document.getElementById("active-clear-filters");
        if (activeClearFiltersBtn) {
            activeClearFiltersBtn.addEventListener("click", () => {
                resetCategoryCheckboxes();
                if (elements.searchInput) elements.searchInput.value = "";
                
                const filterUrlParams = new URLSearchParams(window.location.search);
                filterUrlParams.delete('category');
                filterUrlParams.delete('subcategory');
                const newUrl = window.location.pathname + (filterUrlParams.toString() ? '?' + filterUrlParams.toString() : '');
                window.history.replaceState({}, '', newUrl);
                
                filters.megaCategory = "";
                filters.megaSubcategory = "";
                applyFilters({ resetPage: true });
            });
        }

         // Category card click filter
        document.querySelectorAll(".fashion-card").forEach((card) => {
            const handleCategorySelect = () => {
                const category = card.dataset.category;
                let checkbox = document.querySelector(
                    `input[name="category-filter"][value="${category}"]`
                );

                resetCategoryCheckboxes();

                if (!checkbox && elements.categoryList) {
                    // Create checkbox dynamically if it doesn't exist
                    const label = document.createElement("label");
                    label.innerHTML = `
                        <input
                            type="checkbox"
                            name="category-filter"
                            value="${AppUtils.escapeHTML(category)}"
                        >
                        ${AppUtils.escapeHTML(category)}
                    `;
                    elements.categoryList.appendChild(label);
                    checkbox = label.querySelector("input");
                }

                if (checkbox) {
                    checkbox.checked = true;
                    applyFilters({ resetPage: true });
                    document.getElementById("product-container")
                        ?.scrollIntoView({ behavior: "smooth" });
                }
            };

            card.addEventListener("click", handleCategorySelect);
            card.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleCategorySelect();
                }
            });
        });
    }
);

// Clear every active filter and go back to the default catalogue view.
//
// The `);` above and this declaration are what a bad merge dropped (#1444):
// the DOMContentLoaded listener was left unclosed and this function's body ran
// straight on from it, so the file did not parse and the whole shop page --
// search, filters, sorting, the product list -- was dead. `setupClearFilters`
// at the bottom binds this by name, and every binding the body reads is
// already declared above.
function clearAllFilters() {
    // Reset category
    filterButtons.forEach(btn => {
        btn.classList.remove('active-filter');
        if (btn.dataset.category === 'all') {
            btn.classList.add('active-filter');
        }
    });
    currentCategory = 'all';
    
    // Reset sort
    if (sortSelect) {
        sortSelect.value = 'default';
    }
    
    // Reset state
    showAllHoodies = false;
    currentSearch = '';
    currentCategory = 'all';
    
    // Update URL (remove query params)
    if (window.history && window.history.pushState) {
        const url = window.location.pathname;
        window.history.pushState({}, '', url);
    }
    
    // Hide button
    if (clearFiltersBtn) {
        clearFiltersBtn.style.display = 'none';
    }
    
    // Reload products
    fetchProducts(1);
    
    // Show notification
    if (typeof AppUtils !== 'undefined' && AppUtils.notify) {
        AppUtils.notify('All filters cleared ✅', 'info');
    }
}

// Setup clear filters button
function setupClearFilters() {
    if (!clearFiltersBtn) return;
    clearFiltersBtn.addEventListener('click', clearAllFilters);
}
})()
