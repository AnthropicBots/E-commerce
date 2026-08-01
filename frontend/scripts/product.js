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

    // ============================================
    // PRODUCT STATE
    // ============================================
    //
    // These declarations were previously trapped inside the stale
    // `async function fetchProduct()` left behind by merge 99abcd6 (#1296).
    // Being function-scoped there, every other function in this module saw
    // them as undefined, and `fetchProduct` itself read `isLoading` on its
    // first line while the `let isLoading` sat 20 lines further down in the
    // same scope -- a temporal-dead-zone ReferenceError on the very first
    // call. They belong at module scope.
    let currentProductData = null;
    let isLoading = false;
    let fairQueueState = {
        active: false,
        waitToken: null,
        admitToken: null,
        position: null,
        etaSec: null,
        pollTimer: null
    };

    window.currentProductData = null;

    // ============================================
    // URL PARAMS
    // ============================================
    const urlParams = new URLSearchParams(window.location.search);

    // Product ids are UUIDs (#1025, #1191). The previous
    // `parseInt(urlParams.get("id"), 10)` produced NaN for every real id and
    // bounced the visitor straight back to shop.html, so the product page
    // could never open. Other pages (recommendations.js, product-reviews.js)
    // already read this parameter as an opaque string.
    const productId = (urlParams.get("id") || "").trim();

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

    /**
     * Coerce a quantity input into a positive integer.
     *
     * Called in four places but never defined -- `safeQty` lives in
     * checkout.js, which product.html does not load, so every quantity
     * interaction threw `ReferenceError: safeQty is not defined` (#1296).
     *
     * @param {any} value
     * @returns {number} An integer >= 1.
     */
    function safeQty(value) {
        const parsed = parseInt(value, 10);
        return Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
    }

    /**
     * Minimal placeholder shown when the product cannot be fetched and nothing
     * is cached.
     *
     * `fetchProduct` calls this on both of its failure paths but it was never
     * defined, so an API error turned a graceful degradation into a hard
     * `ReferenceError` (#1296).
     *
     * @returns {object}
     */
    function getFallbackProduct() {
        return {
            id: productId,
            name: "Product unavailable",
            description: "We could not load this product. Please try again later.",
            price: 0,
            stock: 0,
            brand: "",
            category: "",
            image: "/assets/images/f1.jpg"
        };
    }

// loading state
function showLoadingState() {
    document.body.classList.add("loading");
    const mainImgWrapper = document.getElementById("mainImageWrapper");
    if (mainImgWrapper && !mainImgWrapper.querySelector(".product-skeleton-overlay")) {
        const skeletonOverlay = document.createElement("div");
        skeletonOverlay.className = "skeleton skeleton-img-lg product-skeleton-overlay";
        skeletonOverlay.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;border-radius:16px;";
        mainImgWrapper.appendChild(skeletonOverlay);
    }
    const nameEl = document.getElementById("product-name");
    if (nameEl) nameEl.classList.add("skeleton", "skeleton-text");
    const priceEl = document.getElementById("product-price");
    if (priceEl) priceEl.classList.add("skeleton", "skeleton-text", "price");
}

function hideLoadingState() {
    document.body.classList.remove("loading");
    const skeletonOverlay = document.querySelector(".product-skeleton-overlay");
    if (skeletonOverlay) skeletonOverlay.remove();
    const nameEl = document.getElementById("product-name");
    if (nameEl) nameEl.classList.remove("skeleton", "skeleton-text");
    const priceEl = document.getElementById("product-price");
    if (priceEl) priceEl.classList.remove("skeleton", "skeleton-text", "price");
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
            if (!AppUtils.isAuthenticated()) return;

            await AppUtils.apiRequest('/interactions', {
                method: 'POST',
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

        // Fair shopping queue (#1384)
        initFairQueue(product);

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
    const MAX_LINE_QUANTITY = 10;

    function ensureFairQueuePanel() {
        let panel = document.getElementById("fair-queue-panel");
        if (panel) return panel;
        const stockEl = productElements.productStock;
        panel = document.createElement("div");
        panel.id = "fair-queue-panel";
        panel.style.cssText =
            "display:none;margin:1rem 0;padding:1rem;border:1px solid #cde;background:#f7fbfd;border-radius:8px;";
        panel.innerHTML = `
            <strong style="display:block;margin-bottom:0.35rem;">Fair shopping queue</strong>
            <p id="fair-queue-msg" style="margin:0 0 0.75rem;font-size:0.9rem;color:#555;">
                High demand item — join the queue for a fair shot at stock.
            </p>
            <p id="fair-queue-position" style="margin:0 0 0.75rem;font-size:0.95rem;"></p>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                <button type="button" id="fair-queue-join-btn">Join queue</button>
                <button type="button" id="fair-queue-leave-btn" style="display:none;">Leave queue</button>
            </div>
        `;
        if (stockEl?.parentNode) {
            stockEl.parentNode.insertBefore(panel, stockEl.nextSibling);
        } else {
            document.body.appendChild(panel);
        }
        return panel;
    }

    function updateFairQueueUI(status) {
        const panel = ensureFairQueuePanel();
        const msg = document.getElementById("fair-queue-msg");
        const pos = document.getElementById("fair-queue-position");
        const joinBtn = document.getElementById("fair-queue-join-btn");
        const leaveBtn = document.getElementById("fair-queue-leave-btn");

        if (!fairQueueState.active && !status?.enabled) {
            panel.style.display = "none";
            return;
        }
        panel.style.display = "block";

        if (status?.admitted && status.admitToken) {
            fairQueueState.admitToken = status.admitToken;
            fairQueueState.waitToken = null;
            if (msg) msg.textContent = "You are admitted — add to cart now before your slot expires.";
            if (pos) pos.textContent = "Status: Ready to reserve";
            if (joinBtn) joinBtn.style.display = "none";
            if (leaveBtn) leaveBtn.style.display = "none";
            if (productElements.addToCartBtn) productElements.addToCartBtn.disabled = false;
            return;
        }

        if (status?.queued) {
            if (msg) msg.textContent = status.message || "Waiting in fair queue…";
            if (pos) {
                pos.textContent = `Position ${status.position} of ${status.queueLength} · ETA ~${status.etaSec}s`;
            }
            if (joinBtn) {
                joinBtn.style.display = "none";
            }
            if (leaveBtn) leaveBtn.style.display = "inline-block";
            if (productElements.addToCartBtn) productElements.addToCartBtn.disabled = true;
            return;
        }

        if (msg) {
            msg.textContent =
                "High demand item — join the queue for a fair shot at stock.";
        }
        if (pos) pos.textContent = "";
        if (joinBtn) {
            joinBtn.style.display = "inline-block";
            joinBtn.disabled = false;
        }
        if (leaveBtn) leaveBtn.style.display = "none";
        if (productElements.addToCartBtn && Number(currentProductData?.stock) > 0) {
            // Block add until admitted when queue is active
            productElements.addToCartBtn.disabled = fairQueueState.active;
        }
    }

    function stopFairQueuePoll() {
        if (fairQueueState.pollTimer) {
            clearInterval(fairQueueState.pollTimer);
            fairQueueState.pollTimer = null;
        }
    }

    async function pollFairQueueStatus() {
        if (!fairQueueState.waitToken || !productId) return;
        try {
            const res = await AppUtils.apiRequest(
                `/products/${encodeURIComponent(productId)}/fair-queue/status`,
                {
                    method: "POST",
                    body: JSON.stringify({ waitToken: fairQueueState.waitToken })
                }
            );
            if (!res?.success) return;
            if (res.admitted && res.admitToken) {
                stopFairQueuePoll();
                updateFairQueueUI(res);
                AppUtils.notify("Your turn — reserve stock now", "success");
            } else {
                updateFairQueueUI(res);
            }
        } catch (err) {
            console.warn("Fair queue poll failed", err);
        }
    }

    async function joinFairQueue() {
        if (!AppUtils.requireLogin("Sign in to join the fair shopping queue")) return;
        const joinBtn = document.getElementById("fair-queue-join-btn");
        if (joinBtn) joinBtn.disabled = true;
        try {
            const res = await AppUtils.apiRequest(
                `/products/${encodeURIComponent(productId)}/fair-queue/join`,
                { method: "POST", body: JSON.stringify({}) }
            );
            if (!res?.success) {
                AppUtils.notify(res?.message || "Could not join queue", "error");
                return;
            }
            fairQueueState.waitToken = res.waitToken;
            fairQueueState.active = true;
            try {
                sessionStorage.setItem(
                    `fairq:${productId}`,
                    JSON.stringify({ waitToken: res.waitToken })
                );
            } catch (_) { /* ignore */ }
            updateFairQueueUI(res);
            stopFairQueuePoll();
            fairQueueState.pollTimer = setInterval(pollFairQueueStatus, 2000);
            if (res.admitted) {
                stopFairQueuePoll();
            }
        } catch (err) {
            AppUtils.notify(err?.message || "Could not join queue", "error");
        } finally {
            if (joinBtn) joinBtn.disabled = false;
        }
    }

    async function leaveFairQueue() {
        stopFairQueuePoll();
        try {
            await AppUtils.apiRequest(
                `/products/${encodeURIComponent(productId)}/fair-queue/leave`,
                {
                    method: "POST",
                    body: JSON.stringify({ waitToken: fairQueueState.waitToken })
                }
            );
        } catch (_) { /* ignore */ }
        fairQueueState.waitToken = null;
        fairQueueState.admitToken = null;
        try {
            sessionStorage.removeItem(`fairq:${productId}`);
        } catch (_) { /* ignore */ }
        updateFairQueueUI({ queued: false, admitted: false });
        AppUtils.notify("Left the fair queue", "info");
    }

    async function initFairQueue(product) {
        if (!product?.id) return;
        ensureFairQueuePanel();
        const joinBtn = document.getElementById("fair-queue-join-btn");
        const leaveBtn = document.getElementById("fair-queue-leave-btn");
        joinBtn?.addEventListener("click", joinFairQueue);
        leaveBtn?.addEventListener("click", leaveFairQueue);

        try {
            const info = await AppUtils.apiRequest(
                `/products/${encodeURIComponent(product.id)}/fair-queue`,
                { method: "GET" }
            );
            fairQueueState.active = Boolean(info?.active || info?.config?.forceAll);
            if (!fairQueueState.active) {
                updateFairQueueUI({ enabled: false });
                return;
            }
            // Restore wait token after refresh (anti-refresh binding stays server-side)
            try {
                const saved = JSON.parse(sessionStorage.getItem(`fairq:${product.id}`) || "null");
                if (saved?.waitToken) {
                    fairQueueState.waitToken = saved.waitToken;
                    updateFairQueueUI({
                        queued: true,
                        position: "…",
                        queueLength: "…",
                        etaSec: "…",
                        message: "Reconnecting to fair queue…"
                    });
                    fairQueueState.pollTimer = setInterval(pollFairQueueStatus, 2000);
                    pollFairQueueStatus();
                    return;
                }
            } catch (_) { /* ignore */ }
            updateFairQueueUI({ queued: false });
        } catch (err) {
            console.warn("Fair queue info unavailable", err);
        }
    }

    async function addProductToCart(product, redirect = false) {
        if (!product) return;

        if (!AppUtils.requireLogin("Please sign in to add items to your cart")) {
            return;
        }

        if (Number(product.stock) <= 0) {
            AppUtils.notify("Product is out of stock", "error");
            return;
        }

        if (fairQueueState.active && !fairQueueState.admitToken) {
            AppUtils.notify("Join the fair queue and wait for your turn before adding to cart", "warning");
            ensureFairQueuePanel();
            return;
        }

        const line = { id: product.id };

        const existing = AppUtils.getCart().find(
            (item) => AppUtils.getCartItemKey(item) === AppUtils.getCartItemKey(line)
        );

        // This page has always capped a line at ten units.
        const qty = Math.min(
            safeQty(productElements.qtyInput?.value || 1),
            Math.max(0, MAX_LINE_QUANTITY - safeQty(existing?.qty))
        );

        // Silently doing nothing would leave the button looking broken.
        if (qty < 1) {
            AppUtils.notify(`You can add up to ${MAX_LINE_QUANTITY} of this item`, "info");
            return;
        }

        const countBefore = AppUtils.getCartCount();

        // Routed through the shared helper so the add reserves stock and the
        // account gets the final say on it.
        const cart = await AppUtils.addCartItem({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image,
            qty,
            stock: product.stock,
            admitToken: fairQueueState.admitToken || undefined
        });

        // A refused add has already told the shopper why.
        if (AppUtils.getCartCount(cart) <= countBefore) return;

        fairQueueState.admitToken = null;
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
        // Handled by product-actions.js — fair queue still gates via addProductToCart
        // and product-actions when it calls AppUtils.addCartItem with admitToken.
        if (typeof window !== "undefined") {
            window.getFairQueueAdmitToken = () => fairQueueState.admitToken;
            window.isFairQueueBlocking = () =>
                Boolean(fairQueueState.active && !fairQueueState.admitToken);
        }
    }

    // ============================================
    const DEFAULT_PRODUCT_IMAGE = "/assets/images/f1.jpg";

    const normalizeProductImage = (image) => {
        if (!image) {
            return "";
        }

        if (typeof image === "string") {
            return image.trim();
        }

        if (typeof image === "object") {
            return String(
                image.url ||
                image.src ||
                image.image ||
                image.path ||
                image.file ||
                ""
            ).trim();
        }

        return String(image).trim();
    };

    const getProductGalleryImages = (product) => {
        const images = Array.isArray(product?.images)
            ? product.images.map(normalizeProductImage).filter(Boolean)
            : [];
        const fallbackImage = normalizeProductImage(product?.image) || DEFAULT_PRODUCT_IMAGE;

        if (images.length) {
            return images.filter((src, index, list) => list.indexOf(src) === index);
        }

        return [fallbackImage];
    };

    const setMainProductImage = (src, altText = "") => {
        if (!productElements.mainImage) {
            return "";
        }

        const nextSrc = normalizeProductImage(src) || DEFAULT_PRODUCT_IMAGE;
        const image = productElements.mainImage;

        if (altText) {
            image.alt = altText;
        }

        image.classList.add("is-fading");

        const removeFade = () => {
            image.classList.remove("is-fading");
        };

        image.addEventListener("load", removeFade, { once: true });
        image.src = nextSrc;

        if (image.complete) {
            window.requestAnimationFrame(removeFade);
        }

        return nextSrc;
    };

    const setActiveGalleryThumbnail = (gallery, activeIndex) => {
        if (!gallery) {
            return;
        }

        gallery.querySelectorAll(".small-image-col").forEach((thumb, index) => {
            const isActive = index === activeIndex;
            thumb.classList.toggle("is-active", isActive);
            thumb.setAttribute("aria-pressed", String(isActive));
        });
    };

    // RENDER PRODUCT
    // ============================================
    function renderProduct(
        product
    ) {

        if (
            !product
        ) {

            return;
        }

        const primaryImage = getProductGalleryImages(product)[0] || DEFAULT_PRODUCT_IMAGE;

        // image
        if (
            productElements.mainImage
        ) {

            setMainProductImage(
                primaryImage,
                product.name || "Product image"
            );

            productElements.mainImage.onerror =
                () => {

                    productElements.mainImage.classList.remove("is-fading");
                    productElements.mainImage.src =
                        DEFAULT_PRODUCT_IMAGE;
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
                `${
                    product.discount_percent
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
    let currentImageSrc = image.getAttribute("src") || image.src;

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

    function initializeProductGallery(product) {
        const gallery = document.getElementById("product-thumbnail-gallery");

        if (!gallery) {
            return;
        }

        const images = getProductGalleryImages(product);
        const productName = product?.name || "Product";

        gallery.innerHTML = images
            .map((src, index) => {
                const isActive = index === 0;
                const escapedSrc = escapeHTML(src);
                const escapedAlt = escapeHTML(`${productName} thumbnail ${index + 1}`);

                return `
                    <button
                        type="button"
                        class="small-image-col${isActive ? " is-active" : ""}"
                        data-image-index="${index}"
                        aria-label="View image ${index + 1} of ${images.length}"
                        aria-pressed="${String(isActive)}"
                    >
                        <img
                            src="${escapedSrc}"
                            class="small-image"
                            alt="${escapedAlt}"
                            loading="lazy"
                        >
                    </button>
                `;
            })
            .join("");

        const thumbnails = Array.from(gallery.querySelectorAll(".small-image-col"));

        setActiveGalleryThumbnail(gallery, 0);

        thumbnails.forEach((thumb, index) => {
            thumb.addEventListener("click", () => {
                const nextSrc = images[index];

                if (!nextSrc) {
                    return;
                }

                setMainProductImage(
                    nextSrc,
                    productName
                );
                setActiveGalleryThumbnail(gallery, index);
            });
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

        if (productElements.plusBtn) {
            productElements.plusBtn.disabled = qty >= cap;
        }

        if (productElements.minusBtn) {
            productElements.minusBtn.disabled = qty <= 1;
        }
    }

    // ============================================
    // QUANTITY CONTROLS
    // ============================================
    if (productElements.plusBtn) {
        productElements.plusBtn.addEventListener("click", () => {
            const cap = getStockCap();
            const next = safeQty(productElements.qtyInput.value) + 1;
            productElements.qtyInput.value = Math.min(cap, next);
            syncQtyControls();
        });
    }
    if (productElements.minusBtn) {
        productElements.minusBtn.addEventListener("click", () => {
            if (!productElements.qtyInput) return;
            productElements.qtyInput.value = Math.max(1, safeQty(productElements.qtyInput.value) - 1);
            syncQtyControls();
        });
    }

    window.syncProductQtyControls = syncQtyControls;

    // KEYBOARD ACCESSIBILITY
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
// INITIALIZATION
// ========================================

class Product360Viewer {
    resizeCanvas() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.render();
    }

    render() {
        if (!this.ctx || !this.images.length || !this.canvas.parentElement) return;

        const rect = this.canvas.parentElement.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        this.ctx.clearRect(0, 0, width, height);

        const img = this.images[this.currentFrame] || this.images[0];
        if (!img || !img.complete) return;

        this.ctx.save();
        this.ctx.translate(width / 2 + this.panX, height / 2 + this.panY);
        this.ctx.scale(this.scale, this.scale);

        // Frame scrubbing tilt angle effect on HTML5 Canvas
        const angle = (this.currentFrame / this.totalFrames) * Math.PI * 2;
        const scaleX = Math.cos(angle);
        this.ctx.scale(scaleX, 1);

        this.ctx.drawImage(img, -width / 3, -height / 3, (width * 2) / 3, (height * 2) / 3);
        this.ctx.restore();
    }

    onDragStart(point) {
        if (!this.container || this.container.style.display === "none") return;
        this.isDragging = true;
        this.startX = point.clientX;
        this.lastX = point.clientX;
        this.lastTime = performance.now();
        this.velocity = 0;
        this.stopAutoRotate();
        if (this.inertiaRaf) cancelAnimationFrame(this.inertiaRaf);
        this.canvas.classList.add("is-grabbing");
    }

    onDragMove(point) {
        if (!this.isDragging) return;
        const now = performance.now();
        const deltaX = point.clientX - this.lastX;
        const deltaTime = Math.max(1, now - this.lastTime);

        this.velocity = deltaX / deltaTime;
        this.lastX = point.clientX;
        this.lastTime = now;

        const sensitivity = 0.15;
        const frameOffset = Math.round(deltaX * sensitivity);
        if (frameOffset !== 0) {
            this.currentFrame = (this.currentFrame - frameOffset + this.totalFrames * 10) % this.totalFrames;
            requestAnimationFrame(() => this.render());
        }
    }

    onDragEnd() {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.canvas.classList.remove("is-grabbing");
        this.applyInertia();
    }

    applyInertia() {
        if (Math.abs(this.velocity) < 0.05) return;

        const step = () => {
            if (Math.abs(this.velocity) < 0.05 || this.isDragging) {
                this.inertiaRaf = null;
                return;
            }

            const frameDelta = this.velocity > 0 ? -1 : 1;
            this.currentFrame = (this.currentFrame + frameDelta + this.totalFrames) % this.totalFrames;
            this.velocity *= 0.92;
            this.render();

            this.inertiaRaf = requestAnimationFrame(step);
        };

        if (this.inertiaRaf) cancelAnimationFrame(this.inertiaRaf);
        this.inertiaRaf = requestAnimationFrame(step);
    }

    toggleAutoRotate() {
        if (this.autoRotate) {
            this.stopAutoRotate();
        } else {
            this.autoRotate = true;
            if (this.btnRotate) this.btnRotate.classList.add("is-active");
            const loop = () => {
                if (!this.autoRotate) return;
                this.currentFrame = (this.currentFrame + 1) % this.totalFrames;
                this.render();
                this.autoRotateRaf = setTimeout(() => requestAnimationFrame(loop), 80);
            };
            loop();
        }
    }

    stopAutoRotate() {
        this.autoRotate = false;
        if (this.btnRotate) this.btnRotate.classList.remove("is-active");
        if (this.autoRotateRaf) {
            clearTimeout(this.autoRotateRaf);
            this.autoRotateRaf = null;
        }
    }

    zoom(factor) {
        this.scale = Math.min(3.0, Math.max(0.5, this.scale * factor));
        this.render();
    }

    resetView() {
        this.scale = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.currentFrame = 0;
        this.stopAutoRotate();
        this.render();
    }

    toggleFullscreen() {
        if (!this.container) return;
        this.container.classList.toggle("is-fullscreen");
        this.resizeCanvas();
    }
}

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener("DOMContentLoaded", () => {
    fetchProduct();

    if (typeof updateCartCount === "function") {
        updateCartCount();
    }

    initBackToTop();
    new Product360Viewer();
});

})();

