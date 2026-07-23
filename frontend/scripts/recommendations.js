// frontend/scripts/recommendations.js

// ============================================
// RECOMMENDATIONS CONFIGURATION
// ============================================

const RECOMMENDATIONS_CONFIG = {
    apiEndpoint: '/api/recommendations',
    interactionEndpoint: '/api/recommendations/interaction',
    defaultLimit: 8,
    displayLimit: 10,
    cacheKey: 'recommendations',
    cacheTTL: 300000 // 5 minutes
};

// ============================================
// RECOMMENDATIONS MODULE
// ============================================

const Recommendations = (() => {
    // ============================================
    // CACHE MANAGEMENT
    // ============================================
    
    const cache = {
        data: null,
        timestamp: null,
        
        get(key) {
            if (!this.data || !this.timestamp) return null;
            if (Date.now() - this.timestamp > RECOMMENDATIONS_CONFIG.cacheTTL) {
                this.clear();
                return null;
            }
            return this.data;
        },
        
        set(data) {
            this.data = data;
            this.timestamp = Date.now();
            try {
                localStorage.setItem(RECOMMENDATIONS_CONFIG.cacheKey, JSON.stringify({
                    data,
                    timestamp: this.timestamp
                }));
            } catch (error) {
                // Ignore storage errors
            }
        },
        
        clear() {
            this.data = null;
            this.timestamp = null;
            try {
                localStorage.removeItem(RECOMMENDATIONS_CONFIG.cacheKey);
            } catch (error) {
                // Ignore
            }
        },
        
        loadFromStorage() {
            try {
                const stored = localStorage.getItem(RECOMMENDATIONS_CONFIG.cacheKey);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.data && parsed.timestamp) {
                        this.data = parsed.data;
                        this.timestamp = parsed.timestamp;
                        if (Date.now() - this.timestamp > RECOMMENDATIONS_CONFIG.cacheTTL) {
                            this.clear();
                            return null;
                        }
                        return this.data;
                    }
                }
            } catch (error) {
                // Ignore
            }
            return null;
        }
    };

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    
    /**
     * Get product image with fallback
     */
    const getProductImage = (product) => {
        if (product.image) return product.image;
        if (product.imageUrl) return product.imageUrl;
        if (product.images && product.images.length > 0) return product.images[0];
        return '/assets/images/placeholder.png';
    };

    /**
     * Format price
     */
    const formatPrice = (price) => {
        const num = parseFloat(price) || 0;
        return `₹${num.toFixed(2)}`;
    };

    /**
     * Truncate text
     */
    const truncateText = (text, maxLength = 30) => {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    };

    /**
     * Escape HTML
     */
    const escapeHTML = (text) => {
        if (!text) return '';
        return text.replace(/[&<>"]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            return m;
        });
    };

    /**
     * Get recommendation badge text
     */
    const getBadgeText = (type) => {
        const badges = {
            'collaborative': '👥 Recommended for You',
            'content_based': '🎯 Based on Your Interests',
            'trending': '🔥 Trending',
            'top_rated': '⭐ Top Rated',
            'personalized': '✨ Personalized'
        };
        return badges[type] || '✨ Recommended';
    };

    /**
     * Get recommendation type color
     */
    const getBadgeColor = (type) => {
        const colors = {
            'collaborative': '#6c5ce7',
            'content_based': '#00b894',
            'trending': '#e17055',
            'top_rated': '#fdcb6e',
            'personalized': '#0984e3'
        };
        return colors[type] || '#0984e3';
    };

    // ============================================
    // RENDER FUNCTIONS
    // ============================================
    
    /**
     * Render empty state
     */
    const renderEmptyState = (container) => {
        if (!container) return;
        
        const section = container.closest('section');
        if (section) {
            section.style.display = 'block';
        }
        
        container.innerHTML = `
            <div class="empty-state-card recommendations-empty">
                <div class="empty-icon">🎯</div>
                <h3>No Recommendations Yet</h3>
                <p>Explore more products to get personalized recommendations!</p>
                <p class="empty-subtext">The more you browse, the better recommendations you'll get.</p>
                <a href="/shop.html" class="empty-state-btn">
                    🛍️ Explore Products
                </a>
            </div>
        `;
    };

    /**
     * Render loading state
     */
    const renderLoading = (container) => {
        if (!container) return;
        
        container.innerHTML = `
            <div class="loading-grid recommendations-loading">
                ${Array(4).fill(0).map(() => `
                    <div class="product-card skeleton">
                        <div class="skeleton-image"></div>
                        <div class="skeleton-title"></div>
                        <div class="skeleton-price"></div>
                        <div class="skeleton-badge"></div>
                    </div>
                `).join('')}
            </div>
        `;
    };

    /**
     * Render error state
     */
    const renderError = (container) => {
        if (!container) return;
        
        container.innerHTML = `
            <div class="error-state-card recommendations-error">
                <div class="error-icon">⚠️</div>
                <h3>Unable to Load Recommendations</h3>
                <p>We're having trouble fetching personalized recommendations.</p>
                <button onclick="Recommendations.loadRecommendations()" class="retry-btn">
                    🔄 Retry
                </button>
            </div>
        `;
    };

    /**
     * Create product card HTML
     */
    const createProductCard = (product, wishlistIds = new Set()) => {
        const image = getProductImage(product);
        const name = escapeHTML(product.name || 'Product');
        const price = formatPrice(product.price);
        const badgeText = getBadgeText(product.recommendationType);
        const badgeColor = getBadgeColor(product.recommendationType);
        const productId = product.id || product.product_id;
        const isInWishlist = wishlistIds.has(String(productId));
        const rating = product.rating || product.avg_rating || 0;
        const reviewCount = product.review_count || product.reviews || 0;
        
        return `
            <div class="product-card recommendation-item" data-product-id="${productId}" data-recommendation-type="${product.recommendationType || 'personalized'}">
                <a href="/product.html?id=${productId}" class="product-link">
                    <div class="product-image-wrapper">
                        <img 
                            src="${image}" 
                            alt="${name}"
                            loading="lazy"
                            onerror="this.src='/assets/images/placeholder.png'"
                            class="product-image"
                        >
                        ${product.stock !== undefined && product.stock <= 0 ? '<span class="out-of-stock-badge">Out of Stock</span>' : ''}
                        ${product.discount ? `<span class="discount-badge">${product.discount}% OFF</span>` : ''}
                        <span class="recommendation-badge" style="background: ${badgeColor}">
                            ${badgeText}
                        </span>
                    </div>
                    <div class="product-info">
                        <h4 class="product-name">${truncateText(name, 35)}</h4>
                        <div class="product-price-row">
                            <span class="product-price">${price}</span>
                            ${product.original_price ? `<span class="original-price">₹${product.original_price}</span>` : ''}
                            ${product.discount_percentage ? `<span class="discount-percent">${product.discount_percentage}%</span>` : ''}
                        </div>
                        ${rating > 0 ? `
                            <div class="product-rating">
                                <span class="stars">${'⭐'.repeat(Math.round(rating))}</span>
                                <span class="rating-text">${rating.toFixed(1)}</span>
                                ${reviewCount > 0 ? `<span class="review-count">(${reviewCount})</span>` : ''}
                            </div>
                        ` : ''}
                        ${product.category ? `<div class="product-category">${escapeHTML(product.category)}</div>` : ''}
                    </div>
                </a>
                <div class="product-actions">
                    <button onclick="Recommendations.addToCart('${productId}')" class="add-to-cart-btn">
                        🛒 Add to Cart
                    </button>
                    <button onclick="Recommendations.toggleWishlist('${productId}')" class="wishlist-btn ${isInWishlist ? 'active' : ''}" title="${isInWishlist ? 'Remove from wishlist' : 'Add to wishlist'}">
                        ❤️
                    </button>
                </div>
            </div>
        `;
    };

    /**
     * Render products
     */
    const renderProducts = (container, products) => {
        if (!container) return;
        
        if (!products || products.length === 0) {
            renderEmptyState(container);
            return;
        }
        
        const wishlistIds = new Set((window.AppUtils?.getWishlist() || []).map(item => String(item.id)));
        
        const productHTML = products.map(product => createProductCard(product, wishlistIds)).join('');
        
        container.innerHTML = `
            <div class="recommendations-grid">
                ${productHTML}
            </div>
        `;
        
        // Add animations
        if (typeof window.addProductCardAnimations === 'function') {
            window.addProductCardAnimations(container);
        }
    };

    // ============================================
    // API FUNCTIONS
    // ============================================
    
    /**
     * Post user interaction
     */
    const postInteraction = async (productId, type) => {
        const user = window.AppUtils?.getUser();
        if (!user) return; // Only log for authenticated users

        try {
            await window.AppUtils.apiRequest(RECOMMENDATIONS_CONFIG.interactionEndpoint, {
                method: "POST",
                body: JSON.stringify({ productId, type }),
            });
        } catch (error) {
            console.error("❌ Failed to post interaction", error);
        }
    };

    /**
     * Load recommendations from API
     */
    const loadRecommendations = async (containerId = "recommended-products-container", limit = RECOMMENDATIONS_CONFIG.defaultLimit) => {
        const container = window.AppUtils?.$(containerId);
        if (!container) return;

        const user = window.AppUtils?.getUser();
        if (!user) {
            // If not logged in, hide recommendations section
            const section = container.closest("section");
            if (section) section.style.display = "none";
            return;
        }

        // Show section
        const section = container.closest("section");
        if (section) section.style.display = "block";

        // Show loading
        renderLoading(container);

        // Try cache first
        const cached = cache.loadFromStorage();
        if (cached && cached.length > 0) {
            renderProducts(container, cached);
            return;
        }

        try {
            const response = await window.AppUtils.apiRequest(
                `${RECOMMENDATIONS_CONFIG.apiEndpoint}?limit=${limit}`
            );

            if (response && response.success && response.data && response.data.length > 0) {
                // Cache results
                cache.set(response.data);
                
                // Render products
                renderProducts(container, response.data);
            } else {
                renderEmptyState(container);
            }
        } catch (error) {
            console.error("❌ Failed to load recommendations", error);
            renderError(container);
        }
    };

    /**
     * Add to cart
     */
    const addToCart = async (productId) => {
        try {
            const user = window.AppUtils?.getUser();
            if (!user) {
                window.location.href = '/signin.html';
                return;
            }
            
            // Record interaction
            await postInteraction(productId, 'cart_add');
            
            // Add to cart via the backend cart API (apiRequest already
            // prefixes API_BASE, so the path is /cart/add, not /api/cart).
            const response = await window.AppUtils.apiRequest('/cart/add', {
                method: 'POST',
                body: JSON.stringify({ productId, quantity: 1 })
            });
            
            if (response && response.success) {
                showToast('✅ Product added to cart!', 'success');
                // Pull the authoritative cart back into the local mirror so the
                // navbar count and cart page reflect the new item.
                if (typeof window.AppUtils.loadUserCollections === 'function') {
                    await window.AppUtils.loadUserCollections();
                }
                if (typeof window.updateCartCount === 'function') {
                    window.updateCartCount();
                }
            } else {
                showToast('❌ Failed to add to cart', 'error');
            }
        } catch (error) {
            console.error('❌ Add to cart error:', error);
            showToast('❌ Failed to add to cart', 'error');
        }
    };

    /**
     * Toggle wishlist
     */
    const toggleWishlist = async (productId) => {
        try {
            const user = window.AppUtils?.getUser();
            if (!user) {
                window.location.href = '/signin.html';
                return;
            }
            
            const wishlist = window.AppUtils?.getWishlist() || [];
            const isInWishlist = wishlist.some(item => String(item.id) === String(productId));
            
            if (isInWishlist) {
                // Remove from wishlist
                await window.AppUtils.apiRequest(`/api/wishlist/${productId}`, {
                    method: 'DELETE'
                });
                showToast('❌ Removed from wishlist', 'info');
            } else {
                // Record interaction
                await postInteraction(productId, 'wishlist_add');
                
                // Add to wishlist
                await window.AppUtils.apiRequest('/api/wishlist', {
                    method: 'POST',
                    body: JSON.stringify({ productId })
                });
                showToast('❤️ Added to wishlist', 'success');
            }
            
            // Refresh recommendations to update wishlist buttons
            loadRecommendations();
        } catch (error) {
            console.error('❌ Wishlist toggle error:', error);
            showToast('❌ Failed to update wishlist', 'error');
        }
    };

    /**
     * Track product view
     */
    const trackView = () => {
        const urlParams = new URLSearchParams(window.location.search);
        const productId = urlParams.get("id");

        if (window.location.pathname.includes("product.html") && productId) {
            // Record a view
            postInteraction(parseInt(productId, 10), "view");
        }
    };

    /**
     * Clear cache
     */
    const clearCache = () => {
        cache.clear();
        console.log('🧹 Recommendations cache cleared');
    };

    // ============================================
    // TOAST NOTIFICATION
    // ============================================
    
    const showToast = (message, type = 'info') => {
        const toast = document.getElementById('toast');
        if (!toast) {
            // Fallback alert
            alert(message);
            return;
        }
        
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.style.display = 'block';
        
        setTimeout(() => {
            toast.style.display = 'none';
        }, 3000);
    };

    // ============================================
    // INITIALIZATION
    // ============================================
    
    /**
     * Initialize recommendations
     */
    const init = () => {
        // Add CSS
        const style = document.createElement('style');
        style.textContent = `
            .recommendations-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
                gap: 20px;
                padding: 20px 0;
            }
            .recommendation-item {
                position: relative;
            }
            .recommendation-badge {
                position: absolute;
                top: 10px;
                left: 10px;
                padding: 4px 12px;
                border-radius: 20px;
                color: white;
                font-size: 11px;
                font-weight: 600;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                z-index: 2;
            }
            .product-card {
                background: white;
                border-radius: 12px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.08);
                transition: transform 0.3s, box-shadow 0.3s;
                overflow: hidden;
                position: relative;
            }
            .product-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 4px 20px rgba(0,0,0,0.12);
            }
            .product-image-wrapper {
                position: relative;
                overflow: hidden;
                padding-top: 100%;
            }
            .product-image {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            .product-info {
                padding: 12px;
            }
            .product-name {
                font-size: 14px;
                font-weight: 600;
                margin: 0 0 8px 0;
                color: #333;
                line-height: 1.3;
            }
            .product-price {
                font-size: 18px;
                font-weight: 700;
                color: #2c7be5;
            }
            .product-actions {
                display: flex;
                justify-content: space-between;
                padding: 8px 12px 12px;
                gap: 8px;
            }
            .add-to-cart-btn {
                flex: 1;
                padding: 8px 12px;
                background: #2c7be5;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                transition: background 0.2s;
            }
            .add-to-cart-btn:hover {
                background: #1a68c4;
            }
            .wishlist-btn {
                padding: 8px 12px;
                background: #f5f5f5;
                color: #999;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 16px;
                transition: all 0.2s;
                min-width: 40px;
            }
            .wishlist-btn:hover {
                background: #fee;
                color: #e74c3c;
            }
            .wishlist-btn.active {
                background: #fee;
                color: #e74c3c;
            }
            .skeleton {
                background: #f0f0f0;
                border-radius: 8px;
                animation: pulse 1.5s ease-in-out infinite;
            }
            .skeleton-image {
                width: 100%;
                height: 200px;
                background: #e0e0e0;
                border-radius: 8px 8px 0 0;
            }
            .skeleton-title {
                height: 20px;
                width: 80%;
                margin: 10px auto;
                background: #e0e0e0;
                border-radius: 4px;
            }
            .skeleton-price {
                height: 16px;
                width: 50%;
                margin: 10px auto;
                background: #e0e0e0;
                border-radius: 4px;
            }
            .skeleton-badge {
                height: 20px;
                width: 60%;
                margin: 10px auto;
                background: #e0e0e0;
                border-radius: 20px;
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            .empty-state-card {
                text-align: center;
                padding: 60px 20px;
                background: #f9f9f9;
                border-radius: 12px;
            }
            .empty-icon {
                font-size: 48px;
                margin-bottom: 16px;
            }
            .empty-state-btn {
                display: inline-block;
                margin-top: 16px;
                padding: 10px 24px;
                background: #2c7be5;
                color: white;
                border-radius: 8px;
                text-decoration: none;
            }
            .empty-state-btn:hover {
                background: #1a68c4;
            }
            .error-state-card {
                text-align: center;
                padding: 40px 20px;
                background: #fff5f5;
                border-radius: 12px;
                border: 1px solid #fdd;
            }
            .error-icon {
                font-size: 36px;
                margin-bottom: 12px;
            }
            .retry-btn {
                padding: 8px 20px;
                background: #2c7be5;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                margin-top: 12px;
            }
            .retry-btn:hover {
                background: #1a68c4;
            }
            .product-category {
                font-size: 12px;
                color: #999;
                margin-top: 4px;
            }
            .product-rating {
                display: flex;
                align-items: center;
                gap: 4px;
                margin-top: 4px;
            }
            .stars {
                font-size: 12px;
            }
            .rating-text {
                font-size: 13px;
                font-weight: 600;
                color: #555;
            }
            .review-count {
                font-size: 12px;
                color: #999;
            }
            .discount-percent {
                color: #e74c3c;
                font-weight: 600;
                font-size: 14px;
            }
            .original-price {
                text-decoration: line-through;
                color: #999;
                font-size: 14px;
                margin-left: 8px;
            }
            .out-of-stock-badge {
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(231, 76, 60, 0.9);
                color: white;
                padding: 4px 10px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
                z-index: 2;
            }
            .discount-badge {
                position: absolute;
                top: 10px;
                right: 10px;
                background: #e74c3c;
                color: white;
                padding: 4px 10px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
                z-index: 2;
            }
            .recommendations-loading {
                min-height: 200px;
            }
            .loading-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
                gap: 20px;
            }
            .empty-subtext {
                color: #999;
                font-size: 14px;
                margin-top: 4px;
            }
        `;
        document.head.appendChild(style);

        // Track view on product page
        trackView();

        // Load recommendations
        loadRecommendations();

        console.log('✅ Recommendations initialized');
    };

    // ============================================
    // EXPOSE PUBLIC API
    // ============================================

    // Public API
    const publicAPI = {
        postInteraction,
        loadRecommendations,
        addToCart,
        toggleWishlist,
        trackView,
        clearCache,
        init
    };

    // ============================================
    // AUTO-INITIALIZE
    // ============================================

    document.addEventListener('DOMContentLoaded', () => {
        // Only initialize if container exists
        const container = document.getElementById('recommended-products-container');
        if (container) {
            init();
        }
    });

    return publicAPI;
})();

// ============================================
// EXPOSE GLOBALLY
// ============================================

window.Recommendations = Recommendations;

// ============================================
// EXPORT FOR MODULE USE
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Recommendations;
}