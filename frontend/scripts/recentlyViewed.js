import {
    getJSON,
    setJSON,
    $,
    defaultImage,
    safeText,
    safePrice,
    formatPrice,
    apiRequest,
    notify
} from "./utils.js";

// ========================================
// STOCK STATUS HELPERS (Issue #1123)
// ========================================

function getStockBadgeHTML(stock) {
    const stockNum = Number(stock) || 0;
    
    if (stockNum === 0) {
        return `<span class="stock-badge out-of-stock">Out of Stock</span>`;
    } else if (stockNum <= 5) {
        return `<span class="stock-badge low-stock">Only ${stockNum} left</span>`;
    } else {
        return `<span class="stock-badge in-stock">In Stock</span>`;
    }
}

function getOutOfStockOverlayHTML(stock) {
    const stockNum = Number(stock) || 0;
    if (stockNum === 0) {
        return `<div class="out-of-stock-overlay">Sold Out</div>`;
    }
    return '';
}

function getLowStockTextHTML(stock) {
    const stockNum = Number(stock) || 0;
    if (stockNum > 0 && stockNum <= 5) {
        return `<span class="low-stock-text">⚡ Hurry! Only ${stockNum} left</span>`;
    }
    return '';
}

function isOutOfStock(stock) {
    return Number(stock) === 0;
}

// ========================================
// RECENTLY VIEWED PRODUCT CARD
// ========================================

function renderRecentlyViewedCard(product) {
    if (!product) return '';
    
    const stock = Number(product.stock) || 0;
    const outOfStock = isOutOfStock(stock);
    const outOfStockClass = outOfStock ? 'out-of-stock' : '';
    
    // Rating stars
    const rating = Math.min(5, Math.max(0, Number(product.rating || 4)));
    const stars = Array.from({ length: 5 }, (_, i) => {
        return `<i class="fas fa-star${i < rating ? '' : '-o'}"></i>`;
    }).join('');

    return `
        <div class="pro ${outOfStockClass}" data-id="${product.id}">
            <div style="position: relative;">
                <img 
                    src="${defaultImage(product.image)}" 
                    alt="${safeText(product.name, 'Product')}"
                    loading="lazy"
                >
                ${getStockBadgeHTML(stock)}
                ${getOutOfStockOverlayHTML(stock)}
                <span class="product-badge" style="background: #6c3bff;">Recently Viewed</span>
            </div>
            <div class="des">
                <span>${safeText(product.category, 'Fashion')}</span>
                <h5>${safeText(product.name, 'Product')}</h5>
                <div class="star">${stars}</div>
                <h4>${formatPrice(safePrice(product.price))}</h4>
                ${getLowStockTextHTML(stock)}
            </div>
            ${!outOfStock ? `<a href="product.html?id=${product.id}" class="cart"><i class="fas fa-shopping-cart"></i></a>` : ''}
        </div>
    `;
}

// ========================================
// LOAD RECENTLY VIEWED PRODUCTS
// ========================================

async function loadRecentlyViewed() {
    const container = document.getElementById('recently-viewed-container');
    if (!container) return;
    
    // Get recently viewed IDs from localStorage
    const ids = getJSON('recentlyViewed', []);
    
    if (!ids || ids.length === 0) {
        container.innerHTML = `
            <div class="empty-recent" style="width:100%; padding:60px 20px; text-align:center; color:#888; font-size:16px; background:#f9f9f9; border-radius:12px;">
                <i class="fas fa-eye-slash" style="font-size:48px; color:#ccc; display:block; margin-bottom:15px;"></i>
                <p>No recently viewed products yet.</p>
                <p style="font-size:14px; margin-top:8px; opacity:0.7;">Start browsing to see products you've viewed here!</p>
            </div>
        `;
        return;
    }
    
    try {
        // Fetch product details for the IDs (max 6)
        const fetchPromises = ids.slice(0, 6).map(id => 
            apiRequest(`/products/${id}`)
                .then(res => res.product)
                .catch(() => null)
        );
        
        const products = await Promise.all(fetchPromises);
        const validProducts = products.filter(p => p !== null);
        
        if (validProducts.length === 0) {
            container.innerHTML = `
                <div class="empty-recent" style="width:100%; padding:60px 20px; text-align:center; color:#888; font-size:16px; background:#f9f9f9; border-radius:12px;">
                    <i class="fas fa-exclamation-circle" style="font-size:48px; color:#ccc; display:block; margin-bottom:15px;"></i>
                    <p>No recently viewed products available.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = validProducts
            .map(product => renderRecentlyViewedCard(product))
            .join('');
            
        // Re-apply animations
        if (typeof initializeScrollAnimations === 'function') {
            initializeScrollAnimations();
        }
        
    } catch (error) {
        console.error('Error loading recently viewed:', error);
        container.innerHTML = `
            <div class="empty-recent" style="width:100%; padding:60px 20px; text-align:center; color:#888; font-size:16px; background:#f9f9f9; border-radius:12px;">
                <i class="fas fa-exclamation-circle" style="font-size:48px; color:#ccc; display:block; margin-bottom:15px;"></i>
                <p>Could not load recently viewed products.</p>
            </div>
        `;
    }
}

// ========================================
// EXPOSE GLOBALLY
// ========================================

window.loadRecentlyViewed = loadRecentlyViewed;
window.renderRecentlyViewedCard = renderRecentlyViewedCard;

// Auto-load when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Load after a small delay to let other content render
    setTimeout(() => {
        loadRecentlyViewed();
    }, 500);
});
