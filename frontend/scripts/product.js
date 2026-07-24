// frontend/scripts/product.js

(() => {
    console.log("Product page loaded successfully!");

    // ============================================
    // PRODUCT PAGE ELEMENTS
    // ============================================
    const productElements = {
        mainImage: document.getElementById("main-product-image"),
        qtyInput: document.getElementById("product-qty"),
        productCategory: document.getElementById("product-category"),
        productName: document.getElementById("product-name"),
        productPrice: document.getElementById("product-price"),
        productOriginalPrice: document.getElementById("product-original-price"),
        productDiscount: document.getElementById("product-discount"),
        productBrand: document.getElementById("product-brand"),
        productDescription: document.getElementById("product-description"),
        productStock: document.getElementById("product-stock"),
        variantStock: document.getElementById("variant-stock"),
        wishlistBtn: document.getElementById("wishlist-btn"),
        reviewForm: document.getElementById("review-form"),
        plusBtn: document.getElementById("plus-btn"),
        minusBtn: document.getElementById("minus-btn"),
        addToCartBtn: document.getElementById("add-to-cart-btn"),
        buyNowBtn: document.getElementById("buy-now-btn"),
        shareBtn: document.getElementById("share-product-btn"), // 🔥 NEW
        shareDropdown: document.getElementById("share-dropdown"), // 🔥 NEW
        shareToast: document.getElementById("share-toast") // 🔥 NEW
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

// ========================================
// TRACK RECENTLY VIEWED PRODUCTS (Issue #1126)
// ========================================

function trackRecentlyViewed(productId) {
    if (!productId) return;
    
    // Get existing recently viewed IDs from localStorage
    let recentlyViewed = AppUtils.getJSON('recentlyViewed', []);
    
    // Remove if already exists (to move to front)
    recentlyViewed = recentlyViewed.filter(id => id !== productId);
    
    // Add to front
    recentlyViewed.unshift(productId);
    
    // Keep only last 10
    if (recentlyViewed.length > 10) {
        recentlyViewed = recentlyViewed.slice(0, 10);
    }
    
    // Save to localStorage
    AppUtils.setJSON('recentlyViewed', recentlyViewed);
}

// ========================================
// Breadcrumb Navigation (Issue #344)
// ========================================
function updateBreadcrumb(product) {
    const categoryEl = document.getElementById('breadcrumb-category');
    const categoryLink = document.getElementById('breadcrumb-category-link');
    const productNameEl = document.getElementById('breadcrumb-product-name');

    if (!product || !productNameEl) return;

    // Update product name
    productNameEl.textContent = product.name || 'Product';

    // Update category if available
    if (product.category) {
        categoryEl.style.display = 'inline-block';
        categoryLink.textContent = product.category.charAt(0).toUpperCase() + product.category.slice(1);
        categoryLink.href = `shop.html?category=${encodeURIComponent(product.category)}`;
    } else {
        categoryEl.style.display = 'none';
    }
}

// ========================================
// Wishlist Status & Toggle (Issue #777)
// ========================================
async function updateWishlistIcon(productId) {
    const wishlistBtn = document.getElementById('wishlist-btn');
    if (!wishlistBtn) return;

    const token = localStorage.getItem('token');
    const icon = wishlistBtn.querySelector('i');

    if (!token) {
        icon.classList.remove('fas');
        icon.classList.add('far');
        wishlistBtn.dataset.inWishlist = 'false';
        return;
    }

    try {
        // Check local wishlist cache first
        const wishlist = AppUtils.getWishlist() || [];
        const localExists = wishlist.some(item => item.id === productId);

        if (localExists) {
            icon.classList.remove('far');
            icon.classList.add('fas');
            wishlistBtn.dataset.inWishlist = 'true';
            return;
        }

        // Fallback to API
        const response = await AppUtils.apiRequest(`/wishlist/status/${productId}`);
        if (response.success && response.inWishlist) {
            icon.classList.remove('far');
            icon.classList.add('fas');
            wishlistBtn.dataset.inWishlist = 'true';
        } else {
            icon.classList.remove('fas');
            icon.classList.add('far');
            wishlistBtn.dataset.inWishlist = 'false';
        }
    } catch (error) {
        console.error('Wishlist status error:', error);
        icon.classList.remove('fas');
        icon.classList.add('far');
        wishlistBtn.dataset.inWishlist = 'false';
    }
}

async function toggleWishlist(productId) {
    const wishlistBtn = document.getElementById('wishlist-btn');
    if (!wishlistBtn) return;

    const icon = wishlistBtn.querySelector('i');
    const isInWishlist = wishlistBtn.dataset.inWishlist === 'true';

    try {
        const endpoint = isInWishlist ? '/wishlist/remove' : '/wishlist/add';
        const response = await AppUtils.apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify({ productId })
        });

        if (response.success) {
            let wishlist = AppUtils.getWishlist() || [];

            if (response.action === 'added' || (!isInWishlist && response.success)) {
                AppUtils.notify('Added to wishlist ❤️', 'success');
                icon.classList.remove('far');
                icon.classList.add('fas');
                wishlistBtn.dataset.inWishlist = 'true';
                // Update local cache
                const product = currentProductData || { id: productId };
                wishlist.push(product);
                AppUtils.saveWishlist(wishlist);
            } else {
                AppUtils.notify('Removed from wishlist 💔', 'info');
                icon.classList.remove('fas');
                icon.classList.add('far');
                wishlistBtn.dataset.inWishlist = 'false';
                // Update local cache
                wishlist = wishlist.filter(item => item.id !== productId);
                AppUtils.saveWishlist(wishlist);
            }
        } else {
            AppUtils.notify(response.message || 'Failed to update wishlist', 'error');
        }
    } catch (error) {
        console.error('Wishlist toggle error:', error);
        AppUtils.notify('Failed to update wishlist', 'error');
    }
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

    // ============================================
    // PRODUCT STATE
    // ============================================
    let currentProductData = null;

    window.currentProductData = null;
    

    // loading state

    let isLoading = false;

    // ============================================
    // URL PARAMS
    // ============================================
    const urlParams = new URLSearchParams(window.location.search);
    const productId = parseInt(urlParams.get("id"), 10);

    if (Number.isNaN(productId) || productId <= 0) {
        window.location.href = "shop.html";
        throw new Error("Invalid product ID");
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    function escapeHTML(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Update breadcrumb
    updateBreadcrumb(product);

    // ===== TRACK RECENTLY VIEWED (Issue #1126) =====
    trackRecentlyViewed(product.id);

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

    // ========== WISHLIST ICON STATUS ==========
    updateWishlistIcon(product.id);

    // Attach wishlist button event listener
    if (productElements.wishlistBtn) {
        productElements.wishlistBtn.addEventListener('click', function(e) {
            e.preventDefault();
            toggleWishlist(product.id);
        });
    }

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

    if (
        typeof loadProductReviews ===
        "function"
    ) {

        loadProductReviews(
            product.id
        );
    }

    function showLoadingState() {
        document.body.classList.add("loading");
    }

    function hideLoadingState() {
        document.body.classList.remove("loading");
    }

    // ===== INITIALIZE IMAGE ZOOM (Lens Effect) =====
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

    function cacheProduct(product) {
        AppUtils.setJSON(`product-${productId}`, product);
    }

    // ============================================
    // BREADCRUMB
    // ============================================
    function updateBreadcrumb(product) {
        const categoryEl = document.getElementById('breadcrumb-category');
        const categoryLink = document.getElementById('breadcrumb-category-link');
        const productNameEl = document.getElementById('breadcrumb-product-name');

        if (!product || !productNameEl) return;

        productNameEl.textContent = product.name || 'Product';

        if (product.category) {
            categoryEl.style.display = 'inline-block';
            categoryLink.textContent = product.category.charAt(0).toUpperCase() + product.category.slice(1);
            categoryLink.href = `shop.html?category=${encodeURIComponent(product.category)}`;
        } else {
            categoryEl.style.display = 'none';
        }
    }

    // ============================================
    // RECENTLY VIEWED
    // ============================================
    function saveRecentlyViewed(product) {
        if (!product) return;

        const recentlyViewed = JSON.parse(localStorage.getItem("recentlyViewed")) || [];
        const filtered = recentlyViewed.filter((item) => Number(item.id) !== Number(product.id));

        filtered.unshift({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image
        });

        localStorage.setItem("recentlyViewed", JSON.stringify(filtered.slice(0, 10)));
    }

    // ============================================
    // 🔥 SHARE FUNCTIONALITY
    // ============================================
    function initShareButton(product) {
        if (!productElements.shareBtn) return;

        const shareBtn = productElements.shareBtn;
        const shareDropdown = productElements.shareDropdown;
        const shareToast = productElements.shareToast;

        // Store product reference
        window.currentProduct = product;

        // Toggle dropdown
        shareBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (shareDropdown) {
                const isVisible = shareDropdown.style.display === 'block';
                shareDropdown.style.display = isVisible ? 'none' : 'block';
            }
        });

        // Close dropdown on outside click
        document.addEventListener('click', function(e) {
            if (shareDropdown && 
                !e.target.closest('#share-dropdown') && 
                !e.target.closest('#share-product-btn')) {
                shareDropdown.style.display = 'none';
            }
        });

        // Share options
        document.querySelectorAll('.share-option').forEach(function(option) {
            option.addEventListener('click', function(e) {
                e.stopPropagation();
                const method = this.dataset.method;
                if (shareDropdown) {
                    shareDropdown.style.display = 'none';
                }
                handleShare(method, product);
            });
        });

        // Also close dropdown on Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && shareDropdown && shareDropdown.style.display === 'block') {
                shareDropdown.style.display = 'none';
            }
        });
    }

    function handleShare(method, product) {
        if (!product) {
            showShareToast('Product data not available', 'error');
            return;
        }

        const productUrl = `${window.location.origin}/product.html?id=${product.id}`;
        const productName = product.name || 'Product';
        const productPrice = product.price ? `₹${parseFloat(product.price).toFixed(2)}` : '';
        const shareText = `${productName} ${productPrice ? `- ${productPrice}` : ''}\n${productUrl}`;

        if (method === 'whatsapp') {
            const encodedMessage = encodeURIComponent(shareText);
            const whatsappUrl = `https://wa.me/?text=${encodedMessage}`;
            window.open(whatsappUrl, '_blank');
            showShareToast('✅ Opening WhatsApp...', 'success');
            
            // Record share interaction
            recordShareInteraction(product.id, 'whatsapp');
            
        } else if (method === 'clipboard') {
            copyToClipboard(productUrl, product);
            
        } else if (method === 'native') {
            if (navigator.share) {
                navigator.share({
                    title: `Check out ${productName}`,
                    text: `I found this amazing product: ${productName}${productPrice ? ` for ${productPrice}` : ''}`,
                    url: productUrl
                }).then(() => {
                    showShareToast('✅ Shared successfully!', 'success');
                    recordShareInteraction(product.id, 'native');
                }).catch((err) => {
                    if (err.name !== 'AbortError') {
                        console.error('Share error:', err);
                    }
                });
            } else {
                // Fallback: copy link
                copyToClipboard(productUrl, product);
            }
        }
    }

    function copyToClipboard(text, product) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                showShareToast('✅ Link copied to clipboard!', 'success');
                recordShareInteraction(product?.id, 'clipboard');
            }).catch(() => {
                fallbackCopy(text, product);
            });
        } else {
            fallbackCopy(text, product);
        }
    }

    function fallbackCopy(text, product) {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showShareToast('✅ Link copied to clipboard!', 'success');
            recordShareInteraction(product?.id, 'clipboard');
        } catch (error) {
            console.error('Copy failed:', error);
            showShareToast('❌ Failed to copy link', 'error');
        }
    }

    function showShareToast(message, type = 'info') {
        const toast = productElements.shareToast;
        if (!toast) return;

        toast.textContent = message;
        toast.className = `share-toast ${type}`;
        toast.style.display = 'block';

        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.style.display = 'none';
        }, 3000);
    }

    async function recordShareInteraction(productId, method) {
        try {
            const token = localStorage.getItem('jwt');
            if (!token) return;

            await fetch('/api/interactions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    productId: productId,
                    type: 'share',
                    method: method
                })
            });
        } catch (error) {
            // Silently fail - don't block user experience
            console.debug('Share interaction recording failed:', error);
        }
    }

    // ============================================
    // PRIMARY ORCHESTRATOR
    // ============================================
    function initializeProductPage(product) {
        if (!product) return;

        updateBreadcrumb(product);

        // Out of stock behavior
        if (Number(product.stock) <= 0) {
            if (productElements.addToCartBtn) {
                productElements.addToCartBtn.disabled = true;
                productElements.addToCartBtn.innerText = "Out of Stock";
            }
            if (productElements.buyNowBtn) {
                productElements.buyNowBtn.disabled = true;
            }
        }

        renderProduct(product);

        if (typeof setupVariants === "function") {
            setupVariants(product);
        }

        if (typeof setCurrentProduct === "function") {
            setCurrentProduct(product);
        }

        setupCartActions(product);

        // 🔥 Initialize Share Button
        initShareButton(product);

        productElements.mainImage.alt = escapeHTML(product.name || "Product image");

        if (typeof loadProductReviews === "function") {
            loadProductReviews(product.id);
        }

        if (typeof loadRelatedProducts === "function") {
            loadRelatedProducts(product);
        }

        if (typeof loadRecentlyViewedRecommendations === "function") {
            loadRecentlyViewedRecommendations();
        }

        initializeImageZoom();
        initializeProductGallery(product);
    }

    // ============================================
    // FETCH PRODUCT
    // ============================================
    async function fetchProduct() {
        if (isLoading) return;

        isLoading = true;
        showLoadingState();

        try {
            const response = await AppUtils.apiRequest(`/products/${productId}`);

            if (response && response.success && response.product) {
                currentProductData = response.product;

                saveRecentlyViewed(currentProductData);

                window.currentProductData = currentProductData;
                if (typeof saveRecentlyViewed === "function") {
                    saveRecentlyViewed(currentProductData);
                }

                cacheProduct(currentProductData);
            } else {
                currentProductData = getCachedProduct() || getFallbackProduct();
                window.currentProductData = currentProductData;
            }
        } catch (error) {
            console.error("PRODUCT FETCH ERROR:", error);
            currentProductData = getCachedProduct() || getFallbackProduct();
            window.currentProductData = currentProductData;
        } finally {
            initializeProductPage(currentProductData);
            hideLoadingState();
            isLoading = false;
        }
    }

    // ============================================
    // CART ACTIONS
    // ============================================
    function addProductToCart(product, redirect = false) {
        if (!product) return;

        if (!AppUtils.requireLogin("Please sign in to add items to your cart")) {
            return;
        }

        if (Number(product.stock) <= 0) {
            AppUtils.notify("Product is out of stock", "error");
            return;
        }

        let cart = AppUtils.getCart();
        cart = AppUtils.safeArray(cart);

        const existing = cart.find((item) => Number(item.id) === Number(product.id));
        const qty = safeQty(productElements.qtyInput?.value || 1);

        if (existing) {
            existing.qty = Math.min(10, safeQty(existing.qty) + qty);
        } else {
            cart.push({
                id: product.id,
                name: product.name,
                price: product.price,
                image: product.image,
                qty,
                stock: product.stock
            });
        }

        AppUtils.saveCart(cart);
        AppUtils.notify(`${product.name} added to cart`, "success");

        if (typeof loadProductReviews === "function") {
            loadProductReviews(productId);
        }

        if (typeof updateCartCount === "function") {
            updateCartCount();
        }

        if (redirect) {
            window.location.href = "cart.html";
        }
    }

    function setupCartActions(product) {
        // Handled by product-actions.js
    }

    // ============================================
    // RENDER PRODUCT
    // ============================================
    function renderProduct(product) {
        if (!product) return;

// ========================================
// IMAGE ZOOM / LENS EFFECT (Issue #779)
// ========================================

function initializeImageZoom() {
    const wrapper = document.getElementById('mainImageWrapper');
    const image = document.getElementById('main-product-image');
    const lens = document.getElementById('imageLens');
    const zoomResult = document.getElementById('zoomResult');

    // If elements don't exist, skip
    if (!wrapper || !image || !lens || !zoomResult) {
        console.warn('⚠️ Zoom elements not found, skipping initialization');
        return;
    }

    // Avoid duplicate initialization
    if (wrapper.dataset.zoomReady === 'true') {
        return;
    }
    wrapper.dataset.zoomReady = 'true';

    // Configuration
    const ZOOM_FACTOR = 2.5;
    let lensSize = 150;
    let isZoomActive = false;
    let currentImageSrc = image.src;

    // Update lens size based on viewport
    function updateLensSize() {
        const width = window.innerWidth;
        if (width <= 480) {
            lensSize = 100;
        } else if (width <= 768) {
            lensSize = 120;
        } else {
            lensSize = 150;
        }
        lens.style.width = lensSize + 'px';
        lens.style.height = lensSize + 'px';
    }

    // Update zoom background when image changes
    function updateZoomBackground() {
        const rect = wrapper.getBoundingClientRect();
        const bgWidth = rect.width * ZOOM_FACTOR;
        const bgHeight = rect.height * ZOOM_FACTOR;
        zoomResult.style.backgroundImage = `url('${currentImageSrc}')`;
        zoomResult.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
        zoomResult.style.backgroundPosition = '50% 50%';
    }

    // Position lens and zoom result
    function positionLens(clientX, clientY) {
        const rect = wrapper.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const wrapperWidth = rect.width;
        const wrapperHeight = rect.height;

        // Calculate lens position (center on cursor)
        let lensX = x - (lensSize / 2);
        let lensY = y - (lensSize / 2);

        // Keep lens within wrapper bounds
        lensX = Math.max(0, Math.min(lensX, wrapperWidth - lensSize));
        lensY = Math.max(0, Math.min(lensY, wrapperHeight - lensSize));

        lens.style.left = lensX + 'px';
        lens.style.top = lensY + 'px';

        // Update zoom result background position
        const percentX = x / wrapperWidth;
        const percentY = y / wrapperHeight;

        const bgWidth = wrapperWidth * ZOOM_FACTOR;
        const bgHeight = wrapperHeight * ZOOM_FACTOR;

        zoomResult.style.backgroundImage = `url('${currentImageSrc}')`;
        zoomResult.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
        zoomResult.style.backgroundPosition = `${percentX * 100}% ${percentY * 100}%`;
    }

    // Enable zoom
    function enableZoom() {
        isZoomActive = true;
        wrapper.classList.add('zoom-active');
        updateZoomBackground();
    }

    // Disable zoom
    function disableZoom() {
        isZoomActive = false;
        wrapper.classList.remove('zoom-active');
    }

    // ===== DESKTOP EVENTS =====
    wrapper.addEventListener('mouseenter', enableZoom);

    wrapper.addEventListener('mousemove', (e) => {
        if (isZoomActive) {
            positionLens(e.clientX, e.clientY);
        }
    });

    wrapper.addEventListener('mouseleave', disableZoom);

    // ===== MOBILE TOUCH EVENTS =====
    wrapper.addEventListener('touchstart', (e) => {
        e.preventDefault();
        enableZoom();
        const touch = e.touches[0];
        if (touch) {
            positionLens(touch.clientX, touch.clientY);
        }
    }, { passive: false });

    wrapper.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (isZoomActive) {
            const touch = e.touches[0];
            if (touch) {
                positionLens(touch.clientX, touch.clientY);
            }
        }
    }, { passive: false });

    wrapper.addEventListener('touchend', disableZoom);

    // ===== WINDOW RESIZE =====
    window.addEventListener('resize', () => {
        updateLensSize();
        if (isZoomActive) {
            updateZoomBackground();
        }
    });

    // ===== THUMBNAIL CLICK SYNC =====
    // When thumbnails are clicked, update the zoom image
    const thumbnails = document.querySelectorAll('.small-image');
    thumbnails.forEach((thumb) => {
        thumb.addEventListener('click', () => {
            const newSrc = thumb.src;
            if (newSrc && newSrc !== currentImageSrc) {
                currentImageSrc = newSrc;
                image.src = newSrc;
                if (isZoomActive) {
                    updateZoomBackground();
                }
            }
        });
    });

    // ===== WATCH FOR MAIN IMAGE CHANGES =====
    // Observe image src changes (in case it's changed programmatically)
    const observer = new MutationObserver(() => {
        if (image.src !== currentImageSrc) {
            currentImageSrc = image.src;
            if (isZoomActive) {
                updateZoomBackground();
            }
        }
    });
    observer.observe(image, { attributes: true, attributeFilter: ['src'] });

    // Initialize
    updateLensSize();
    console.log('✅ Image Zoom initialized successfully');
}

// ========================================
// PRODUCT GALLERY (Thumbnails)
// ========================================

function initializeProductGallery(
    product
) {

        if (mainImage.dataset.zoomReady) return;
        mainImage.dataset.zoomReady = "true";

        container.addEventListener("mousemove", (e) => {
            const rect = container.getBoundingClientRect();
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

    // ============================================
    // PRODUCT GALLERY
    // ============================================
    function initializeProductGallery(product) {
        const thumbnails = document.querySelectorAll(".small-image");
        if (!thumbnails.length) return;

        thumbnails.forEach((thumb) => {
            thumb.src = product.image || "/assets/images/f1.jpg";
            thumb.onclick = () => {
                if (productElements.mainImage) {
                    productElements.mainImage.src = thumb.src;
                }
            };
        });
    }

    // ============================================
    // QUANTITY CONTROLS
    // ============================================
    function getStockCap() {
        const raw = productElements.variantStock
            ? parseInt(productElements.variantStock.innerText, 10)
            : NaN;
        return isNaN(raw) ? Infinity : raw;
    }

    function syncQtyControls() {
        if (!productElements.qtyInput) return;

        const cap = getStockCap();
        const qty = Math.max(1, Math.min(cap, safeQty(productElements.qtyInput.value)));

// ========================================
// QUANTITY CONTROLS
// ========================================

if (
    productElements.plusBtn
) {

        if (productElements.plusBtn) {
            productElements.plusBtn.disabled = qty >= cap;
        }

        if (productElements.minusBtn) {
            productElements.minusBtn.disabled = qty <= 1;
        }
    }

// ========================================
// KEYBOARD ACCESSIBILITY
// ========================================

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

    if (productElements.minusBtn) {
        productElements.minusBtn.addEventListener("click", () => {
            productElements.qtyInput.value = safeQty(productElements.qtyInput.value) - 1;
            syncQtyControls();
        });
    }

    window.syncProductQtyControls = syncQtyControls;

    // ============================================
    // KEYBOARD ACCESSIBILITY
    // ============================================
    document.addEventListener("keydown", (event) => {
        const activeTag = document.activeElement?.tagName;
        if (["INPUT", "TEXTAREA"].includes(activeTag)) return;

        if (event.key === "+" && productElements.plusBtn) {
            productElements.plusBtn.click();
        }

        if (event.key === "-" && productElements.minusBtn) {
            productElements.minusBtn.click();
        }
    });

    // ============================================
    // BACK TO TOP
    // ============================================
    function initBackToTop() {
        const backToTopBtn = document.getElementById('back-to-top-btn');
        if (!backToTopBtn) return;

        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                backToTopBtn.classList.add('show');
                backToTopBtn.style.display = 'flex';
            } else {
                backToTopBtn.classList.remove('show');
                backToTopBtn.style.display = 'none';
            }
        });

        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

// ========================================
// BACK TO TOP BUTTON (Issue #345)
// ========================================

function initBackToTop() {
    const backToTopBtn = document.getElementById('back-to-top-btn');
    if (!backToTopBtn) return;

    // Show/hide button based on scroll position
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            backToTopBtn.classList.add('show');
            backToTopBtn.style.display = 'flex';
        } else {
            backToTopBtn.classList.remove('show');
            backToTopBtn.style.display = 'none';
        }
    });

    // Smooth scroll to top on click
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

// ========================================
// INITIALIZATION
// ========================================

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

        initBackToTop();
    }
);

})();