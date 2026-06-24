(() => {

    console.log(
        "Product page loaded successfully!"
    );

    // product page elements
    const productElements = {

        mainImage:
            document.getElementById(
                "main-product-image"
            ),

        qtyInput:
            document.getElementById(
                "product-qty"
            ),

        productCategory:
            document.getElementById(
                "product-category"
            ),

        productName:
            document.getElementById(
                "product-name"
            ),

        productPrice:
            document.getElementById(
                "product-price"
            ),

        productOriginalPrice:
            document.getElementById(
                "product-original-price"
            ),

        productDiscount:
            document.getElementById(
                "product-discount"
            ),

        productBrand:
            document.getElementById(
                "product-brand"
            ),

        productDescription:
            document.getElementById(
                "product-description"
            ),

        productStock:
            document.getElementById(
                "product-stock"
            ),

        variantStock:
            document.getElementById(
                "variant-stock"
            ),

        wishlistBtn:
            document.getElementById(
                "wishlist-btn"
            ),

        reviewForm:
            document.getElementById(
                "review-form"
            ),

        plusBtn:
            document.getElementById(
                "plus-btn"
            ),

        minusBtn:
            document.getElementById(
                "minus-btn"
            ),

        addToCartBtn:
            document.getElementById(
                "add-to-cart-btn"
            ),

        buyNowBtn:
            document.getElementById(
                "buy-now-btn"
            )
    };

    // product state
    let currentProductData =
        null;

    // loading state
    let isLoading =
        false;

    // product id
    const urlParams =
        new URLSearchParams(
            window.location.search
        );

    const productId =
        parseInt(
            urlParams.get("id"),
            10
        );

    // invalid product id
    if (
        Number.isNaN(
            productId
        )
        ||
        productId <= 0
    ) {

        window.location.href =
            "shop.html";

        throw new Error(
            "Invalid product ID"
        );
    }

    // escape html
    function escapeHTML(
        value
    ) {

        return String(
            value || ""
        )

            .replace(
                /&/g,
                "&amp;"
            )

            .replace(
                /</g,
                "&lt;"
            )

            .replace(
                />/g,
                "&gt;"
            )

            .replace(
                /"/g,
                "&quot;"
            )

            .replace(
                /'/g,
                "&#039;"
            );
    }

    // safe quantity
    function safeQty(
        value
    ) {

        return Math.max(
            1,
            parseInt(
                value,
                10
            ) || 1
        );
    }

    // fallback product
    function getFallbackProduct() {

        return {

            id: 1,

            brand:
                "AnthropicBots",

            name:
                "Nike Hoodie",

            category:
                "Fashion",

            price: 2999,

            image:
                "/assets/images/f1.jpg",

            description:
                "Premium cotton hoodie with modern fashion styling and comfortable fit.",

            stock: 12,

            rating: 4.5,

            discount_percent: 10
        };
    }

    // loading state
    function showLoadingState() {

        document.body.classList.add(
            "loading"
        );
    }

    function hideLoadingState() {

        document.body.classList.remove(
            "loading"
        );
    }

    // cache helpers
    function getCachedProduct() {

        return AppUtils.getJSON(
            `product-${productId}`,
            null
        );
    }

    function cacheProduct(
        product
    ) {

        AppUtils.setJSON(
            `product-${productId}`,
            product
        );
    }
    function saveRecentlyViewed(
    product
) {

    if (!product) {
        return;
    }

    const recentlyViewed =
        JSON.parse(
            localStorage.getItem(
                "recentlyViewed"
            )
        ) || [];

    const filtered =
        recentlyViewed.filter(
            (item) =>
                Number(item.id) !==
                Number(product.id)
        );

    filtered.unshift({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image
    });

    localStorage.setItem(
        "recentlyViewed",
        JSON.stringify(
            filtered.slice(0, 10)
        )
    );
}

    // fetch product
    async function fetchProduct() {

        if (
            isLoading
        ) {

            return;
        }

        isLoading =
            true;

        showLoadingState();

        try {

            const response =
                await AppUtils.apiRequest(
                    `/products/${productId}`
                );

            if (
                response.success
                &&
                response.product
            ) {

                currentProductData =
                    response.product;
                if (
                    typeof saveRecentlyViewed ===
                     "function"
                ) {
                 saveRecentlyViewed(
                     response.product
                    );
                }
                cacheProduct(
                    response.product
                );

            } else {

                currentProductData =
                    getCachedProduct()
                    ||
                    getFallbackProduct();
            }

        } catch (error) {

            console.error(
                "PRODUCT FETCH ERROR:",
                error
            );

            currentProductData =
                getCachedProduct()
                ||
                getFallbackProduct();

        } finally {

            initializeProductPage();

            hideLoadingState();

            isLoading =
                false;
        }
    }

    // initialize page
    function initializeProductPage() {

        const product =
            currentProductData;

        if (
            !product
        ) {

            return;
        }

        // out of stock
        if (
            Number(
                product.stock
            ) <= 0
        ) {

            if (
                productElements.addToCartBtn
            ) {

                productElements.addToCartBtn.disabled =
                    true;

                productElements.addToCartBtn.innerText =
                    "Out of Stock";
            }

            if (
                productElements.buyNowBtn
            ) {

                productElements.buyNowBtn.disabled =
                    true;
            }
        }

        renderProduct(
            product
        );

        if (
            typeof setupVariants ===
            "function"
        ) {

            setupVariants(
                product
            );
        }
        setCurrentProduct(
            product
        );

        setupCartActions(
            product
        );

        // clamp the quantity selector to this product's stock on load
        if (typeof window.syncProductQtyControls === "function") {
            window.syncProductQtyControls();
        }

        if (
            typeof loadProductReviews ===
            "function"
        ) {

            loadProductReviews(
                product.id
            );
        }

        if (
            typeof loadRelatedProducts ===
            "function"
        ) {

            loadRelatedProducts(
                product
            );
        }

        if (
            typeof loadRecentlyViewedRecommendations ===
            "function"
        ) {

            loadRecentlyViewedRecommendations();
        }

        initializeImageZoom();

        initializeProductGallery(
            product
        );
    }

    // add to cart
    function addProductToCart(
        product,
        redirect = false
    ) {

        if (
            !product
        ) {

            return;
        }

        // cart is account-bound: guests must sign in first
        if (!AppUtils.requireLogin("Please sign in to add items to your cart")) {
            return;
        }

        if (
            Number(
                product.stock
            ) <= 0
        ) {

            AppUtils.notify(
                "Product is out of stock",
                "error"
            );

            return;
        }

        let cart =
            AppUtils.getCart();

        cart =
            AppUtils.safeArray(
                cart
            );

        const existing =
            cart.find(
                (
                    item
                ) => {

                    return (
                        Number(
                            item.id
                        ) ===
                        Number(
                            product.id
                        )
                    );
                }
            );

        const qty =
            safeQty(
                productElements.qtyInput
                    ?.value || 1
            );

        if (
            existing
        ) {

            existing.qty =
                Math.min(
                    10,
                    safeQty(
                        existing.qty
                    ) + qty
                );

        } else {

            cart.push({

                id:
                    product.id,

                name:
                    product.name,

                price:
                    product.price,

                image:
                    product.image,

                qty,

                stock:
                    product.stock
            });
        }

        AppUtils.saveCart(
            cart
        );

        AppUtils.notify(
            `${product.name} added to cart`,
            "success"
        );

        if (
            typeof updateCartCount ===
            "function"
        ) {

            updateCartCount();
        }

        if (
            redirect
        ) {

            window.location.href =
                "cart.html";
        }
    }

    // setup cart actions
    // NOTE: Add to Cart / Buy Now are handled by product-actions.js, which
    // captures the selected size/color and validates against stock. Binding
    // them here too caused every click to add the item twice (and fire two
    // toasts), so this is intentionally a no-op.
    function setupCartActions() { }

    // render product
    function renderProduct(
        product
    ) {

        if (
            !product
        ) {

            return;
        }

        // image
        if (
            productElements.mainImage
        ) {

            productElements.mainImage.src =
                escapeHTML(
                    product.image
                    ||
                    "/assets/images/f1.jpg"
                );

            productElements.mainImage.alt =
                escapeHTML(
                    product.name
                    || "Product"
                );

            productElements.mainImage.onerror =
                () => {

                    productElements.mainImage.src =
                        "/assets/images/f1.jpg";
                };
        }

        // category
        if (
            productElements.productCategory
        ) {

            productElements.productCategory.innerText =
                product.category
                || "Fashion";
        }

        // name
        if (
            productElements.productName
        ) {

            productElements.productName.innerText =
                product.name
                || "Product Name";
        }

        // price
        if (
            productElements.productPrice
        ) {

            productElements.productPrice.innerText =
                AppUtils.formatPrice(
                    product.price || 0
                );
        }

        // original price
        if (
            productElements.productOriginalPrice
        ) {

            const productPrice =
                parseFloat(
                    product.price || 0
                );

            const originalPrice =
                productPrice + 1000;

            productElements.productOriginalPrice.innerText =
                AppUtils.formatPrice(
                    originalPrice
                );
        }

        // discount
        if (
            productElements.productDiscount
        ) {

            productElements.productDiscount.innerText =
                `${product.discount_percent
                || 50
                }% OFF`;
        }

        // brand
        if (
            productElements.productBrand
        ) {

            productElements.productBrand.innerText =
                product.brand
                || "Fashion";
        }

        // description
        if (
            productElements.productDescription
        ) {

            productElements.productDescription.innerText =
                product.description
                || "Premium fashion product.";
        }

        // stock
        if (
            productElements.productStock
        ) {

            productElements.productStock.innerText =
                Number(
                    product.stock
                ) > 0
                    ? "In Stock"
                    : "Out Of Stock";
        }

        // page title
        document.title =
            `${product.name} | AnthropicBots E-Commerce`;
    }

    function initializeImageZoom() {

        const mainImage = productElements.mainImage;

        if (!mainImage) {
            return;
        }

        const container = document.getElementById("zoom-container");
        if (!container) {
            return;
        }

        // avoid duplicate listeners
        if (mainImage.dataset.zoomReady) {
            return;
        }

        mainImage.dataset.zoomReady = "true";

        container.addEventListener("mousemove", (e) => {
            const rect = container.getBoundingClientRect();

            // Calculate cursor position as a percentage
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;

            mainImage.style.transformOrigin = `${x}% ${y}%`;
            mainImage.style.transform = "scale(2.5)";
        });

        container.addEventListener("mouseleave", () => {
            mainImage.style.transformOrigin = "center center";
            mainImage.style.transform = "scale(1)";
        });
    }

    // gallery
    function initializeProductGallery(
        product
    ) {

        const thumbnails =
            document.querySelectorAll(
                ".small-image"
            );

        if (
            !thumbnails.length
        ) {

            return;
        }

        thumbnails.forEach(
            (
                thumb
            ) => {

                thumb.src =
                    product.image
                    ||
                    "/assets/images/f1.jpg";

                thumb.onclick =
                    () => {

                        if (
                            productElements.mainImage
                        ) {

                            productElements.mainImage.src =
                                thumb.src;
                        }
                    };
            }
        );
    }

    // quantity controls
    // read the live available stock (updated per variant in product-variants.js)
    function getStockCap() {
        const raw = productElements.variantStock
            ? parseInt(productElements.variantStock.innerText, 10)
            : NaN;

        // no numeric stock shown -> don't cap
        return isNaN(raw) ? Infinity : raw;
    }

    // clamp the quantity to [1, stock] and enable/disable the +/- buttons
    function syncQtyControls() {
        if (!productElements.qtyInput) {
            return;
        }

        const cap = getStockCap();
        const qty = Math.max(1, Math.min(cap, safeQty(productElements.qtyInput.value)));

        productElements.qtyInput.value = qty;

        if (productElements.plusBtn) {
            productElements.plusBtn.disabled = qty >= cap;
        }

        if (productElements.minusBtn) {
            productElements.minusBtn.disabled = qty <= 1;
        }
    }

    if (
        productElements.plusBtn
    ) {

        productElements.plusBtn.addEventListener(
            "click",
            () => {
                productElements.qtyInput.value =
                    safeQty(productElements.qtyInput.value) + 1;
                syncQtyControls();
            }
        );
    }

    if (
        productElements.minusBtn
    ) {

        productElements.minusBtn.addEventListener(
            "click",
            () => {
                productElements.qtyInput.value =
                    safeQty(productElements.qtyInput.value) - 1;
                syncQtyControls();
            }
        );
    }

    // expose so the variant switcher can re-clamp when stock changes
    window.syncProductQtyControls = syncQtyControls;

    // keyboard accessibility
    document.addEventListener(
        "keydown",
        (
            event
        ) => {

            const activeTag =
                document.activeElement
                    ?.tagName;

            if (
                [
                    "INPUT",
                    "TEXTAREA"
                ].includes(
                    activeTag
                )
            ) {

                return;
            }

            if (
                event.key === "+"
                &&
                productElements.plusBtn
            ) {

                productElements.plusBtn.click();
            }

            if (
                event.key === "-"
                &&
                productElements.minusBtn
            ) {

                productElements.minusBtn.click();
            }
        }
    );

    // init
    document.addEventListener(
        "DOMContentLoaded",
        () => {

            fetchProduct();

            if (
                typeof updateCartCount ===
                "function"
            ) {

                updateCartCount();
            }
        }
    );

})();