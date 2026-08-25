// PRODUCTS STATE
(function () {
    let allProducts = [];
    let filteredProducts = [];

    // SERVER PAGINATION / INFINITE SCROLL STATE
    let serverPage = 0;
    let serverTotalPages = 1;
    let serverHasNext = true;
    let isFetchingPage = false;
    let catalogExhausted = false;
    let lastServerSort = "";
    let priceTouched = false;
    let productObserver = null;

    const loadedProductIds = new Set();

    // LOCAL FALLBACK SAMPLE PRODUCTS
    const fallbackProducts =
        (window.CATEGORIES_DATA &&
            window.CATEGORIES_DATA.fallbackProducts) || [
            {
                id: "ft1",
                name: "Classic Cotton T-Shirt",
                description: "Summer collection soft cotton tee.",
                price: 19.99,
                image: "",
                category: "T-Shirts",
                stock: 50,
                rating: 4,
                sales_count: 190
            }
        ];

    const SEARCH_HISTORY_KEY = "advancedProductSearchHistory";

    const SHOP_IMAGE_FALLBACK =
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg"
                 viewBox="0 0 600 600"
                 role="img"
                 aria-label="Product image unavailable">

                <rect width="600" height="600"
                      rx="36"
                      fill="#f3f4f6"/>

                <rect x="110" y="110"
                      width="380"
                      height="380"
                      rx="28"
                      fill="#e5e7eb"/>

                <path d="M190 405l70-82 54 62 40-48 94 106H190z"
                      fill="#cbd5e1"/>

                <circle cx="255"
                        cy="240"
                        r="34"
                        fill="#cbd5e1"/>

                <text x="300"
                      y="515"
                      text-anchor="middle"
                      font-family="Arial, sans-serif"
                      font-size="30"
                      fill="#6b7280">
                    Image unavailable
                </text>
            </svg>
        `);

    // NUMBER OF PRODUCTS REQUESTED PER BACKEND PAGE
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

    const getFilterUtils = () =>
        globalThis.ShopFilterUtils;

    const getStoredSearchHistory = () =>
        AppUtils.safeArray(
            AppUtils.getJSON(
                SEARCH_HISTORY_KEY,
                []
            )
        ).filter(Boolean);

    // ---------------------------------------------------------
    // SEARCH HISTORY
    // ---------------------------------------------------------

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
                    item.toLowerCase() !==
                    normalizedTerm.toLowerCase()
            )
        ].slice(0, 8);

        AppUtils.setJSON(
            SEARCH_HISTORY_KEY,
            searchHistory
        );
    };

    // ---------------------------------------------------------
    // PRODUCT IMAGE
    // ---------------------------------------------------------

    function getProductImageSrc(image) {
        const resolvedImage =
            AppUtils.defaultImage(image);

        return resolvedImage &&
            resolvedImage !==
                "assets/images/default-product.png"
            ? resolvedImage
            : SHOP_IMAGE_FALLBACK;
    }

    // ---------------------------------------------------------
    // WISHLIST
    // ---------------------------------------------------------

    function getWishlistIconClass(productId) {
        const isWishlisted =
            AppUtils.getWishlist().some(
                (item) =>
                    String(item.id) ===
                    String(productId)
            );

        return isWishlisted ? "fas" : "far";
    }

    function updateWishlistButtons(
        productId,
        isWishlisted
    ) {
        const buttons =
            document.querySelectorAll(
                `.wishlist-btn[data-id="${productId}"],
                 .wishlist-btn-shop[data-id="${productId}"]`
            );

        buttons.forEach((btn) => {
            const icon = btn.querySelector("i");

            if (!icon) {
                return;
            }

            icon.classList.toggle(
                "fas",
                isWishlisted
            );

            icon.classList.toggle(
                "far",
                !isWishlisted
            );
        });
    }

    function resetCategoryCheckboxes() {
        const categoryCheckboxes =
            document.querySelectorAll(
                'input[name="category-filter"]'
            );

        categoryCheckboxes.forEach(
            (checkbox) => {
                checkbox.checked = false;
            }
        );
    }

    async function syncWishlistFallback(product) {
        let wishlist =
            AppUtils.getWishlist();

        const exists =
            wishlist.some(
                (item) =>
                    String(item.id) ===
                    String(product.id)
            );

        const token =
            AppUtils.getToken();

        if (exists) {
            wishlist =
                wishlist.filter(
                    (item) =>
                        String(item.id) !==
                        String(product.id)
                );

            AppUtils.notify(
                "Removed from wishlist",
                "info"
            );

            if (token) {
                try {
                    await AppUtils.apiRequest(
                        "/wishlist/remove",
                        {
                            method: "POST",
                            body: JSON.stringify({
                                productId: product.id
                            })
                        }
                    );
                } catch (error) {
                    console.warn(
                        "Failed to sync wishlist removal:",
                        error
                    );
                }
            }
        } else {
            wishlist.push(product);

            AppUtils.notify(
                "Added to wishlist ❤️",
                "success"
            );

            if (token) {
                try {
                    await AppUtils.apiRequest(
                        "/wishlist/add",
                        {
                            method: "POST",
                            body: JSON.stringify({
                                productId: product.id
                            })
                        }
                    );
                } catch (error) {
                    console.warn(
                        "Failed to sync wishlist addition:",
                        error
                    );
                }
            }
        }

        AppUtils.saveWishlist(wishlist);

        updateWishlistButtons(
            product.id,
            !exists
        );
    }

    // ---------------------------------------------------------
    // CATALOG PAGINATION
    // ---------------------------------------------------------

    function resetCatalog() {
        allProducts = [];
        filteredProducts = [];

        loadedProductIds.clear();

        serverPage = 0;
        serverTotalPages = 1;
        serverHasNext = true;
        catalogExhausted = false;
    }

    function buildProductsQuery(page) {
        const params =
            new URLSearchParams();

        params.set(
            "page",
            String(page)
        );

        params.set(
            "limit",
            String(PAGE_SIZE)
        );

        if (filters.sort) {
            params.set(
                "sort",
                filters.sort
            );
        }

        if (
            priceTouched &&
            Number.isFinite(
                Number(filters.minPrice)
            )
        ) {
            params.set(
                "minPrice",
                String(filters.minPrice)
            );
        }

        if (
            priceTouched &&
            Number.isFinite(
                Number(filters.maxPrice)
            )
        ) {
            params.set(
                "maxPrice",
                String(filters.maxPrice)
            );
        }

        return `/products?${params.toString()}`;
    }

    function appendProducts(products) {
        AppUtils.safeArray(products).forEach(
            (product) => {
                const key =
                    String(product.id);

                if (
                    loadedProductIds.has(key)
                ) {
                    return;
                }

                loadedProductIds.add(key);
                allProducts.push(product);
            }
        );
    }

    async function loadNextProductsPage() {
        if (
            isFetchingPage ||
            !serverHasNext
        ) {
            return;
        }

        const isFirstPage =
            serverPage === 0;

        isFetchingPage = true;

        if (
            isFirstPage &&
            elements.productContainer &&
            allProducts.length === 0
        ) {
            AppUtils.renderSkeletonState(
                elements.productContainer,
                8
            );
        }

        renderScrollStatus();

        try {
            const data =
                await AppUtils.apiRequest(
                    buildProductsQuery(
                        serverPage + 1
                    )
                );

            const products =
                data && data.success
                    ? AppUtils.safeArray(
                          data.products
                      )
                    : [];

            if (
                isFirstPage &&
                products.length === 0
            ) {
                appendProducts(
                    fallbackProducts
                );

                serverHasNext = false;
                catalogExhausted = true;
            } else {
                appendProducts(products);

                serverPage += 1;

                serverTotalPages =
                    Number(data.totalPages) ||
                    serverTotalPages;

                serverHasNext =
                    data.hasNextPage === true ||
                    serverPage <
                        serverTotalPages;

                catalogExhausted =
                    !serverHasNext;
            }
        } catch (error) {
            console.error(
                "SHOP FETCH ERROR:",
                error
            );

            if (isFirstPage) {
                appendProducts(
                    fallbackProducts
                );
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

        maybeAutoLoadMore();
    }

    function maybeAutoLoadMore() {
        if (
            !serverHasNext ||
            isFetchingPage ||
            !productObserver
        ) {
            return;
        }

        const sentinel =
            document.getElementById(
                "product-scroll-sentinel"
            );

        if (!sentinel) {
            return;
        }

        requestAnimationFrame(() => {
            const rect =
                sentinel.getBoundingClientRect();

            const viewportHeight =
                globalThis.innerHeight ||
                document.documentElement
                    .clientHeight;

            if (
                rect.top <=
                viewportHeight + 200
            ) {
                loadNextProductsPage();
            }
        });
    }

    // ---------------------------------------------------------
    // FETCH PRODUCTS
    // ---------------------------------------------------------

    function fetchProducts() {
        searchHistory =
            getStoredSearchHistory();

        lastServerSort =
            elements.sortSelect?.value ||
            "newest";

        filters.sort =
            lastServerSort;

        resetCatalog();

        setupProductObserver();

        loadNextProductsPage();
    }

    // ---------------------------------------------------------
    // EMPTY STATE
    // ---------------------------------------------------------

    function renderEmptyState(message) {
        if (
            !elements.productContainer
        ) {
            return;
        }

        elements.productContainer.innerHTML = `
            <div class="empty-products">
                <h3>${AppUtils.escapeHTML(
                    message
                )}</h3>
            </div>
        `;
    }

    // ---------------------------------------------------------
    // STAR RATINGS
    // ---------------------------------------------------------

    function renderStars(rating = 5) {
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
            () => `
                <i class="fas fa-star"></i>
            `
        ).join("");
    }

    // ---------------------------------------------------------
    // PRODUCT CARD
    // ---------------------------------------------------------

    function createProductCard(product) {
        const displayName =
            product.name || "Product";

        const stock =
            Number(product.stock) || 0;

        const isOutOfStock =
            stock === 0;

        const isLowStock =
            stock > 0 && stock <= 5;

        const outOfStockClass =
            isOutOfStock
                ? "out-of-stock"
                : "";

        let badgeHTML = "";

        if (isOutOfStock) {
            badgeHTML = `
                <span class="stock-badge out-of-stock">
                    Out of Stock
                </span>
            `;
        } else if (isLowStock) {
            badgeHTML = `
                <span class="stock-badge low-stock">
                    Only ${stock} left
                </span>
            `;
        } else {
            badgeHTML = `
                <span class="stock-badge in-stock">
                    In Stock
                </span>
            `;
        }

        let overlayHTML = "";

        if (isOutOfStock) {
            overlayHTML = `
                <div class="out-of-stock-overlay">
                    Sold Out
                </div>
            `;
        }

        let lowStockText = "";

        if (isLowStock && !isOutOfStock) {
            lowStockText = `
                <span class="low-stock-text">
                    ⚡ Hurry! Only ${stock} left
                </span>
            `;
        }

        const actionButtons =
            isOutOfStock
                ? ""
                : `
                    <div
                        style="
                            position: absolute;
                            bottom: 20px;
                            right: 12px;
                            display: flex;
                            gap: 8px;
                            z-index: 2;
                        "
                    >
                        <button
                            class="wishlist-btn-shop cart"
                            data-id="${product.id}"
                            aria-label="Add to Wishlist"
                            style="
                                position: relative;
                                bottom: 0;
                                right: 0;
                            "
                        >
                            <i class="${
                                AppUtils.getWishlist()
                                    .some(
                                        (item) =>
                                            String(
                                                item.id
                                            ) ===
                                            String(
                                                product.id
                                            )
                                    )
                                    ? "fas"
                                    : "far"
                            } fa-heart"></i>
                        </button>

                        <button
                            class="add-to-cart-icon cart"
                            aria-label="Add to cart"
                            style="
                                position: relative;
                                bottom: 0;
                                right: 0;
                            "
                        >
                            <i class="fal fa-shopping-cart"></i>
                        </button>
                    </div>
                `;

        const escapedName =
            AppUtils.escapeHTML(
                displayName
            );

        const brand =
            product.brand ||
            product.category ||
            "Fashion";

        const wishlistIconClass =
            getWishlistIconClass(
                product.id
            );

        return `
            <div
                class="pro ${outOfStockClass}"
                data-product-id="${product.id}"
            >
                <div
                    style="position: relative;"
                >
                    <img
                        src="${getProductImageSrc(
                            product.image
                        )}"
                        alt="${escapedName}"
                        loading="lazy"
                    >

                    ${badgeHTML}
                    ${overlayHTML}
                </div>

                <div class="des">
                    <span>
                        ${AppUtils.escapeHTML(
                            brand
                        )}
                    </span>

                    <h5>
                        ${escapedName}
                    </h5>

                    <div class="star">
                        ${renderStars(
                            product.rating
                        )}

                        <span class="rating-count">
                            ${AppUtils.escapeHTML(
                                getRatingLabel(
                                    product
                                )
                            )}

                            <i
                                class="${wishlistIconClass} fa-heart"
                            ></i>
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

    // ---------------------------------------------------------
    // RENDER PRODUCTS
    // ---------------------------------------------------------

    function renderProducts(
        products = [],
        {
            emptyMessage = "No products found."
        } = {}
    ) {
        if (
            !elements.productContainer
        ) {
            return;
        }

        if (
            !Array.isArray(products) ||
            products.length === 0
        ) {
            renderEmptyState(
                emptyMessage
            );
            return;
        }

        elements.productContainer.innerHTML =
            "";

        const fragment =
            document.createDocumentFragment();

        products.forEach((product) => {
            const wrapper =
                document.createElement(
                    "div"
                );

            wrapper.innerHTML =
                createProductCard(product);

            const card =
                wrapper.firstElementChild;

            if (!card) {
                return;
            }

            const cardImage =
                card.querySelector("img");

            if (cardImage) {
                cardImage.addEventListener(
                    "error",
                    () => {
                        if (
                            cardImage.dataset
                                .fallbackApplied ===
                            "true"
                        ) {
                            return;
                        }

                        cardImage.dataset
                            .fallbackApplied =
                            "true";

                        cardImage.src =
                            SHOP_IMAGE_FALLBACK;
                    }
                );
            }

            setupProductCard(
                card,
                product
            );

            fragment.appendChild(card);
        });

        elements.productContainer.appendChild(
            fragment
        );
    }

    // ---------------------------------------------------------
    // PRODUCT CARD EVENTS
    // ---------------------------------------------------------

    function setupProductCard(
        card,
        product
    ) {
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

        // ADD TO CART
        const cartBtn =
            card.querySelector(
                ".add-to-cart-icon"
            );

        if (cartBtn) {
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
                        if (
                            typeof addToCartFromProduct ===
                            "function"
                        ) {
                            await addToCartFromProduct(
                                item
                            );

                            return;
                        }

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

                        if (
                            AppUtils.getCartCount(
                                cart
                            ) <= countBefore
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
        }

        // ADD TO WISHLIST
        const wishlistBtn =
            card.querySelector(
                ".wishlist-btn-shop"
            );

        if (wishlistBtn) {
            wishlistBtn.addEventListener(
                "click",
                async (event) => {
                    event.preventDefault();
                    event.stopPropagation();

                    if (
                        typeof globalThis.toggleWishlist ===
                        "function"
                    ) {
                        await globalThis.toggleWishlist(
                            product
                        );
                    } else {
                        await syncWishlistFallback(
                            product
                        );
                    }
                }
            );
        }
    }

    // ---------------------------------------------------------
    // FILTER STATE AND CONTROLS
    // ---------------------------------------------------------

    function getReviewCount(product) {
        return Number(
            product?.num_reviews ??
                product?.numReviews ??
                product?.reviewCount ??
                0
        );
    }

    function getRatingLabel(product) {
        const count =
            getReviewCount(product);

        const rating =
            Number(product.rating || 0);

        if (!count) {
            return "No reviews yet";
        }

        const reviewLabel =
            count === 1
                ? "review"
                : "reviews";

        return `${rating.toFixed(
            1
        )} (${count} ${reviewLabel})`;
    }

    function initializeFilterControls() {
        const utils =
            getFilterUtils();

        priceBounds =
            utils.getPriceBounds(
                allProducts
            );

        filters = {
            ...filters,
            minPrice: priceBounds.min,
            maxPrice: priceBounds.max,
            sort:
                elements.sortSelect?.value ||
                "newest"
        };

        renderCategoryFilters();
        applyUrlCategoryFilters();
        updatePriceControls();
    }

    function getUrlCategoryFilters() {
        const params =
            new URLSearchParams(
                globalThis.location.search
            );

        return {
            category:
                params.get("category") || "",

            subcategory:
                params.get("subcategory") || ""
        };
    }

    function applyUrlCategoryFilters() {
        if (hasAppliedUrlFilters) {
            return;
        }

        const {
            category,
            subcategory
        } = getUrlCategoryFilters();

        filters.megaCategory =
            category;

        filters.megaSubcategory =
            subcategory;

        if (category) {
            const matchingCategoryInput =
                Array.from(
                    document.querySelectorAll(
                        'input[name="category-filter"]'
                    )
                ).find(
                    (input) =>
                        input.value ===
                        category
                );

            if (matchingCategoryInput) {
                matchingCategoryInput.checked =
                    true;

                filters.categories = [
                    category
                ];
            }
        }

        hasAppliedUrlFilters = true;
    }

    function renderCategoryFilters() {
        if (!elements.categoryList) {
            return;
        }

        const checkedValues =
            new Set(
                Array.from(
                    document.querySelectorAll(
                        'input[name="category-filter"]:checked'
                    )
                ).map(
                    (input) =>
                        input.value
                )
            );

        const categories =
            getFilterUtils().uniqueCategories(
                allProducts
            );

        elements.categoryList.innerHTML =
            categories
                .map(
                    (category) => `
                        <label>
                            <input
                                type="checkbox"
                                name="category-filter"
                                value="${AppUtils.escapeHTML(
                                    category
                                )}"
                                ${
                                    checkedValues.has(
                                        category
                                    )
                                        ? "checked"
                                        : ""
                                }
                            >

                            ${AppUtils.escapeHTML(
                                category
                            )}
                        </label>
                    `
                )
                .join("");
    }

    function refreshFilterControls() {
        priceBounds =
            getFilterUtils().getPriceBounds(
                allProducts
            );

        if (!priceTouched) {
            filters.minPrice =
                priceBounds.min;

            filters.maxPrice =
                priceBounds.max;
        }

        renderCategoryFilters();
        updatePriceControls();
    }

    function updatePriceControls() {
        const {
            minPriceRange,
            maxPriceRange,
            priceOutput
        } = elements;

        if (
            !minPriceRange ||
            !maxPriceRange
        ) {
            return;
        }

        [
            minPriceRange,
            maxPriceRange
        ].forEach((range) => {
            range.min = priceBounds.min;
            range.max = priceBounds.max;
            range.step = 1;
        });

        minPriceRange.value =
            filters.minPrice;

        maxPriceRange.value =
            filters.maxPrice;

        if (elements.minPriceNumber) {
            elements.minPriceNumber.value =
                filters.minPrice;
        }

        if (elements.maxPriceNumber) {
            elements.maxPriceNumber.value =
                filters.maxPrice;
        }

        if (priceOutput) {
            priceOutput.textContent =
                `${AppUtils.formatPrice(
                    filters.minPrice
                )} - ${AppUtils.formatPrice(
                    filters.maxPrice
                )}`;
        }
    }

    function readFiltersFromControls() {
        filters.search =
            elements.searchInput?.value.trim() ||
            "";

        filters.categories =
            Array.from(
                document.querySelectorAll(
                    'input[name="category-filter"]:checked'
                )
            ).map(
                (input) =>
                    input.value
            );

        const minPrice =
            Number(
                elements.minPriceNumber?.value ||
                    elements.minPriceRange?.value ||
                    priceBounds.min
            );

        const maxPrice =
            Number(
                elements.maxPriceNumber?.value ||
                    elements.maxPriceRange?.value ||
                    priceBounds.max
            );

        if (elements.minPriceRange) {
            elements.minPriceRange.value =
                minPrice;
        }

        if (elements.maxPriceRange) {
            elements.maxPriceRange.value =
                maxPrice;
        }

        filters.minPrice =
            Math.min(
                minPrice,
                maxPrice
            );

        filters.maxPrice =
            Math.max(
                minPrice,
                maxPrice
            );

        filters.rating =
            Number(
                document.querySelector(
                    'input[name="rating-filter"]:checked'
                )?.value || 0
            );

        filters.availability =
            Array.from(
                document.querySelectorAll(
                    'input[name="availability-filter"]:checked'
                )
            ).map(
                (input) =>
                    input.value
            );

        filters.sort =
            elements.sortSelect?.value ||
            "newest";
    }

    function applyFilters({
        resetPage = false
    } = {}) {
        const utils =
            getFilterUtils();

        readFiltersFromControls();

        if (
            filters.sort !==
            lastServerSort
        ) {
            lastServerSort =
                filters.sort;

            resetCatalog();

            loadNextProductsPage();

            return;
        }

        filteredProducts =
            utils.sortProducts(
                utils.filterProducts(
                    allProducts,
                    filters
                ),
                filters.sort
            );

        updatePriceControls();
        updateResultsSummary();
        updateClearFiltersButton();

        renderProducts(
            filteredProducts,
            {
                emptyMessage:
                    isFetchingPage
                        ? "Loading products..."
                        : filters.megaCategory ||
                          filters.megaSubcategory
                        ? "No products available in this category."
                        : "No products found."
            }
        );

        renderScrollStatus();

        maybeAutoLoadMore();
    }

    // ---------------------------------------------------------
    // SEARCH SUGGESTIONS
    // ---------------------------------------------------------

    function showSearchSuggestions() {
        if (!elements.searchInput) {
            return;
        }

        const query =
            elements.searchInput.value.trim();

        if (!query) {
            renderSuggestionList(
                searchHistory,
                {
                    isHistory: true
                }
            );

            return;
        }

        renderSuggestionList(
            getFilterUtils().getSuggestions(
                allProducts,
                query,
                6
            )
        );
    }

    function closeSuggestions() {
        if (
            !elements.suggestions ||
            !elements.searchInput
        ) {
            return;
        }

        elements.suggestions.hidden = true;
        elements.suggestions.innerHTML = "";

        elements.searchInput.setAttribute(
            "aria-expanded",
            "false"
        );

        activeSuggestionIndex = -1;
    }

    function renderSuggestionList(
        items,
        {
            isHistory = false
        } = {}
    ) {
        if (
            !elements.suggestions ||
            !elements.searchInput
        ) {
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
            items
                .map(
                    (item, index) => {
                        if (isHistory) {
                            return `
                                <li class="suggestion-item">
                                    <button
                                        type="button"
                                        class="suggestion-button suggestion-history-button"
                                        data-suggestion-index="${index}"
                                        data-history-term="${AppUtils.escapeHTML(
                                            item
                                        )}"
                                    >
                                        <span class="suggestion-title">
                                            ${AppUtils.escapeHTML(
                                                item
                                            )}
                                        </span>

                                        <span class="suggestion-meta">
                                            Search again
                                        </span>
                                    </button>
                                </li>
                            `;
                        }

                        const titleText =
                            item.name ||
                            item.title ||
                            "Product";

                        return `
                            <li class="suggestion-item">
                                <button
                                    type="button"
                                    class="suggestion-button"
                                    data-suggestion-index="${index}"
                                    data-product-id="${encodeURIComponent(
                                        item.id
                                    )}"
                                >
                                    <img
                                        src="${getProductImageSrc(
                                            item.image
                                        )}"
                                        alt=""
                                        loading="lazy"
                                    >

                                    <span>
                                        <span class="suggestion-title">
                                            ${AppUtils.escapeHTML(
                                                titleText
                                            )}
                                        </span>

                                        <span class="suggestion-meta">
                                            ${AppUtils.escapeHTML(
                                                item.category ||
                                                    item.brand ||
                                                    "Fashion"
                                            )}
                                        </span>
                                    </span>

                                    <span class="suggestion-price">
                                        ${AppUtils.formatPrice(
                                            item.price || 0
                                        )}
                                    </span>
                                </button>
                            </li>
                        `;
                    }
                )
                .join("");

        elements.suggestions.innerHTML = `
            <p class="suggestion-section-title">
                ${title}
            </p>

            <ul class="suggestion-list">
                ${listItems}
            </ul>

            ${
                isHistory
                    ? `
                        <button
                            type="button"
                            class="clear-history-button"
                        >
                            Clear history
                        </button>
                    `
                    : ""
            }
        `;

        elements.suggestions.hidden = false;

        elements.searchInput.setAttribute(
            "aria-expanded",
            "true"
        );

        activeSuggestionIndex = -1;
    }

    function updateActiveSuggestion(
        nextIndex
    ) {
        const buttons =
            Array.from(
                elements.suggestions?.querySelectorAll(
                    ".suggestion-button"
                ) || []
            );

        if (!buttons.length) {
            return;
        }

        activeSuggestionIndex =
            (nextIndex +
                buttons.length) %
            buttons.length;

        buttons.forEach(
            (button, index) => {
                button.classList.toggle(
                    "is-active",
                    index ===
                        activeSuggestionIndex
                );
            }
        );

        buttons[
            activeSuggestionIndex
        ].scrollIntoView({
            block: "nearest"
        });
    }

    function chooseSuggestion(button) {
        if (
            !button ||
            !elements.searchInput
        ) {
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
                    button.dataset
                        .productId || ""
                );

            const product =
                allProducts.find(
                    (item) =>
                        String(item.id) ===
                        String(productId)
                );

            elements.searchInput.value =
                product?.name ||
                product?.title ||
                "";
        }

        saveSearchHistory(
            elements.searchInput.value
        );

        closeSuggestions();

        applyFilters({
            resetPage: true
        });
    }

    // ---------------------------------------------------------
    // SEARCH SETUP
    // ---------------------------------------------------------

    function setupSearch() {
        if (!elements.searchInput) {
            return;
        }

        const debouncedApplyFilters =
            getFilterUtils().debounce(
                () =>
                    applyFilters({
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
                        elements.suggestions?.querySelectorAll(
                            ".suggestion-button"
                        ) || []
                    );

                if (
                    event.key ===
                        "ArrowDown" &&
                    buttons.length
                ) {
                    event.preventDefault();

                    updateActiveSuggestion(
                        activeSuggestionIndex +
                            1
                    );
                }

                if (
                    event.key ===
                        "ArrowUp" &&
                    buttons.length
                ) {
                    event.preventDefault();

                    updateActiveSuggestion(
                        activeSuggestionIndex -
                            1
                    );
                }

                if (event.key === "Enter") {
                    if (
                        activeSuggestionIndex >=
                            0 &&
                        buttons[
                            activeSuggestionIndex
                        ]
                    ) {
                        event.preventDefault();

                        chooseSuggestion(
                            buttons[
                                activeSuggestionIndex
                            ]
                        );

                        return;
                    }

                    saveSearchHistory(
                        elements.searchInput
                            .value
                    );

                    closeSuggestions();
                }

                if (
                    event.key ===
                    "Escape"
                ) {
                    closeSuggestions();
                }
            }
        );

        elements.searchForm?.addEventListener(
            "submit",
            (event) => {
                event.preventDefault();

                saveSearchHistory(
                    elements.searchInput.value
                );

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
                    event.target.closest(
                        ".suggestion-button"
                    );

                if (suggestionButton) {
                    chooseSuggestion(
                        suggestionButton
                    );

                    return;
                }

                if (
                    event.target.closest(
                        ".clear-history-button"
                    )
                ) {
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
                    !event.target.closest(
                        ".search-box"
                    )
                ) {
                    closeSuggestions();
                }
            }
        );
    }

    // ---------------------------------------------------------
    // FILTER CONTROLS
    // ---------------------------------------------------------

    function setupFilterControls() {
        elements.categoryList?.addEventListener(
            "change",
            () =>
                applyFilters({
                    resetPage: true
                })
        );

        [
            elements.minPriceRange,
            elements.maxPriceRange
        ].forEach((range) => {
            range?.addEventListener(
                "input",
                () => {
                    if (
                        range ===
                            elements.minPriceRange &&
                        elements.minPriceNumber
                    ) {
                        elements.minPriceNumber.value =
                            range.value;
                    }

                    if (
                        range ===
                            elements.maxPriceRange &&
                        elements.maxPriceNumber
                    ) {
                        elements.maxPriceNumber.value =
                            range.value;
                    }

                    priceTouched = true;

                    applyFilters({
                        resetPage: true
                    });
                }
            );
        });

        [
            elements.minPriceNumber,
            elements.maxPriceNumber
        ].forEach((numInput) => {
            numInput?.addEventListener(
                "input",
                () =>
                    applyFilters({
                        resetPage: true
                    })
            );

            numInput?.addEventListener(
                "change",
                () =>
                    applyFilters({
                        resetPage: true
                    })
            );
        });

        document
            .querySelectorAll(
                'input[name="rating-filter"], input[name="availability-filter"]'
            )
            .forEach((input) => {
                input.addEventListener(
                    "change",
                    () =>
                        applyFilters({
                            resetPage: true
                        })
                );
            });

        elements.sortSelect?.addEventListener(
            "change",
            () =>
                applyFilters({
                    resetPage: true
                })
        );

        elements.clearFilters?.addEventListener(
            "click",
            () => {
                if (elements.searchInput) {
                    elements.searchInput.value =
                        "";
                }

                document
                    .querySelectorAll(
                        'input[name="category-filter"], input[name="availability-filter"]'
                    )
                    .forEach((input) => {
                        input.checked = false;
                    });

                const allRatings =
                    document.querySelector(
                        'input[name="rating-filter"][value="0"]'
                    );

                if (allRatings) {
                    allRatings.checked =
                        true;
                }

                if (elements.sortSelect) {
                    elements.sortSelect.value =
                        "newest";
                }

                priceTouched = false;

                filters.minPrice =
                    priceBounds.min;

                filters.maxPrice =
                    priceBounds.max;

                filters.megaCategory =
                    "";

                filters.megaSubcategory =
                    "";

                hasAppliedUrlFilters =
                    true;

                updatePriceControls();
                closeSuggestions();

                applyFilters({
                    resetPage: true
                });
            }
        );
    }

    // ---------------------------------------------------------
    // FILTER DRAWER
    // ---------------------------------------------------------

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
                if (
                    event.key ===
                    "Escape"
                ) {
                    setFilterDrawer(false);
                }
            }
        );
    }

    // ---------------------------------------------------------
    // CLEAR FILTERS
    // ---------------------------------------------------------

    function isAnyFilterActive() {
        return Boolean(
            filters.search ||
                filters.categories.length ||
                filters.megaCategory ||
                filters.megaSubcategory ||
                Number(filters.rating) >
                    0 ||
                filters.availability.length ||
                (priceTouched &&
                    (filters.minPrice !==
                        priceBounds.min ||
                        filters.maxPrice !==
                            priceBounds.max))
        );
    }

    function updateClearFiltersButton() {
        const clearFiltersBtn =
            elements.clearFilters;

        if (!clearFiltersBtn) {
            return;
        }

        if (isAnyFilterActive()) {
            clearFiltersBtn.style.display =
                "inline-flex";

            clearFiltersBtn.classList.add(
                "show"
            );
        } else {
            clearFiltersBtn.style.display =
                "none";

            clearFiltersBtn.classList.remove(
                "show"
            );
        }
    }

    // ---------------------------------------------------------
    // RESULTS SUMMARY
    // ---------------------------------------------------------

    function updateResultsSummary() {
        if (!elements.resultsSummary) {
            return;
        }

        let activeCategory =
            "All Products";

        if (
            filters.categories &&
            filters.categories.length === 1
        ) {
            activeCategory =
                filters.categories[0];
        } else if (
            filters.categories &&
            filters.categories.length > 1
        ) {
            activeCategory = "Multiple";
        } else if (
            filters.megaCategory
        ) {
            activeCategory =
                filters.megaCategory;
        }

        const productCountText =
            `Showing ${filteredProducts.length} Products`;

        elements.resultsSummary.innerHTML = `
            <span class="active-category-display">
                Category:
                ${AppUtils.escapeHTML(
                    activeCategory
                )}
            </span>
            |
            <span class="product-count-display">
                ${productCountText}
            </span>
        `;

        const clearFiltersBtn =
            document.getElementById(
                "active-clear-filters"
            );

        if (clearFiltersBtn) {
            const hasFilters =
                filters.categories.length >
                    0 ||
                filters.search ||
                filters.megaCategory ||
                filters.megaSubcategory;

            clearFiltersBtn.style.display =
                hasFilters
                    ? "inline-block"
                    : "none";
        }

        document
            .querySelectorAll(
                ".fashion-card"
            )
            .forEach((card) => {
                const cat =
                    card.dataset.category;

                const isActive =
                    filters.categories.includes(
                        cat
                    ) ||
                    filters.megaCategory ===
                        cat;

                if (isActive) {
                    card.classList.add(
                        "active"
                    );

                    card.setAttribute(
                        "aria-pressed",
                        "true"
                    );
                } else {
                    card.classList.remove(
                        "active"
                    );

                    card.setAttribute(
                        "aria-pressed",
                        "false"
                    );
                }
            });
    }

    // ---------------------------------------------------------
    // INFINITE SCROLL UI
    // ---------------------------------------------------------

    function renderScrollStatus() {
        let statusBar =
            document.getElementById(
                "pagination"
            );

        if (!statusBar) {
            statusBar =
                document.createElement(
                    "section"
                );

            statusBar.id =
                "pagination";

            elements.productContainer?.after(
                statusBar
            );
        }

        const hasResults =
            filteredProducts.length > 0;

        let statusMarkup = "";

        if (isFetchingPage) {
            statusMarkup = `
                <div
                    class="scroll-loader"
                    role="status"
                    aria-live="polite"
                >
                    <span
                        class="scroll-spinner"
                        aria-hidden="true"
                    ></span>

                    <span>
                        Loading more products…
                    </span>
                </div>
            `;
        } else if (
            catalogExhausted &&
            !serverHasNext &&
            hasResults
        ) {
            statusMarkup = `
                <p
                    class="scroll-end"
                    role="status"
                >
                    You've reached the end
                    of the catalog.
                </p>
            `;
        }

        statusBar.innerHTML = `
            ${statusMarkup}

            <div
                id="product-scroll-sentinel"
                class="scroll-sentinel"
                aria-hidden="true"
            ></div>
        `;

        observeSentinel();
    }

    function observeSentinel() {
        if (!productObserver) {
            return;
        }

        const sentinel =
            document.getElementById(
                "product-scroll-sentinel"
            );

        if (sentinel) {
            productObserver.observe(
                sentinel
            );
        }
    }

    function setupProductObserver() {
        if (
            productObserver ||
            typeof IntersectionObserver ===
                "undefined"
        ) {
            return;
        }

        productObserver =
            new IntersectionObserver(
                (entries) => {
                    if (
                        entries.some(
                            (entry) =>
                                entry.isIntersecting
                        )
                    ) {
                        loadNextProductsPage();
                    }
                },
                {
                    rootMargin:
                        "200px 0px"
                }
            );
    }

    // ---------------------------------------------------------
    // INITIALIZATION
    // ---------------------------------------------------------

    document.addEventListener(
        "DOMContentLoaded",
        () => {
            elements.searchForm =
                document.getElementById(
                    "shop-search-form"
                );

            elements.searchInput =
                document.getElementById(
                    "search-input"
                );

            elements.suggestions =
                document.getElementById(
                    "search-suggestions"
                );

            elements.categoryList =
                document.getElementById(
                    "category-filter-list"
                );

            elements.minPriceRange =
                document.getElementById(
                    "min-price-range"
                );

            elements.maxPriceRange =
                document.getElementById(
                    "max-price-range"
                );

            elements.minPriceNumber =
                document.getElementById(
                    "min-price-number"
                );

            elements.maxPriceNumber =
                document.getElementById(
                    "max-price-number"
                );

            elements.priceOutput =
                document.getElementById(
                    "price-range-output"
                );

            elements.sortSelect =
                document.getElementById(
                    "product-sort"
                );

            elements.productContainer =
                document.getElementById(
                    "product-container"
                );

            elements.resultsSummary =
                document.getElementById(
                    "results-summary"
                );

            elements.filterSidebar =
                document.getElementById(
                    "filter-sidebar"
                );

            elements.filterBackdrop =
                document.getElementById(
                    "filter-backdrop"
                );

            elements.mobileFilterToggle =
                document.getElementById(
                    "mobile-filter-toggle"
                );

            elements.closeFilterSidebar =
                document.getElementById(
                    "close-filter-sidebar"
                );

            elements.clearFilters = document.getElementById("clear-filters");

            setupSearch();
            setupFilterControls();
            setupFilterDrawer();
            fetchProducts();

            // ACTIVE CLEAR FILTERS BUTTON
            const activeClearFiltersBtn =
                document.getElementById(
                    "active-clear-filters"
                );

            if (activeClearFiltersBtn) {
                activeClearFiltersBtn.addEventListener(
                    "click",
                    () => {
                        resetCategoryCheckboxes();

                        if (
                            elements.searchInput
                        ) {
                            elements.searchInput.value =
                                "";
                        }

                        const filterUrlParams =
                            new URLSearchParams(
                                window.location
                                    .search
                            );

                        filterUrlParams.delete(
                            "category"
                        );

                        filterUrlParams.delete(
                            "subcategory"
                        );

                        const newUrl =
                            window.location
                                .pathname +
                            (
                                filterUrlParams.toString()
                                    ? "?" +
                                      filterUrlParams.toString()
                                    : ""
                            );

                        window.history.replaceState(
                            {},
                            "",
                            newUrl
                        );

                        filters.megaCategory =
                            "";

                        filters.megaSubcategory =
                            "";

                        applyFilters({
                            resetPage: true
                        });
                    }
                );
            }

            // CATEGORY CARD CLICK FILTER
            document
                .querySelectorAll(
                    ".fashion-card"
                )
                .forEach((card) => {
                    const handleCategorySelect =
                        () => {
                            const category =
                                card.dataset
                                    .category;

                            let checkbox =
                                document.querySelector(
                                    `input[name="category-filter"][value="${category}"]`
                                );

                            resetCategoryCheckboxes();

                            if (
                                !checkbox &&
                                elements.categoryList
                            ) {
                                const label =
                                    document.createElement(
                                        "label"
                                    );

                                label.innerHTML = `
                                    <input
                                        type="checkbox"
                                        name="category-filter"
                                        value="${AppUtils.escapeHTML(
                                            category
                                        )}"
                                    >

                                    ${AppUtils.escapeHTML(
                                        category
                                    )}
                                `;

                                elements.categoryList.appendChild(
                                    label
                                );

                                checkbox =
                                    label.querySelector(
                                        "input"
                                    );
                            }

                            if (checkbox) {
                                checkbox.checked =
                                    true;

                                applyFilters({
                                    resetPage: true
                                });

                                document
                                    .getElementById(
                                        "product-container"
                                    )
                                    ?.scrollIntoView(
                                        {
                                            behavior:
                                                "smooth"
                                        }
                                    );
                            }
                        };

                    card.addEventListener(
                        "click",
                        handleCategorySelect
                    );

                    card.addEventListener(
                        "keydown",
                        (event) => {
                            if (
                                event.key ===
                                    "Enter" ||
                                event.key ===
                                    " "
                            ) {
                                event.preventDefault();

                                handleCategorySelect();
                            }
                        }
                    );
                });
        }
    );
})();
