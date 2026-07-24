// related products container
const relatedProductsContainer =
    document.getElementById(
        "related-products"
    );

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
// RENDER PRODUCT CARD WITH STOCK
// ========================================

function renderProductCard(product, container) {
    if (!product || !container) return;

    const stock = Number(product.stock) || 0;
    const outOfStock = isOutOfStock(stock);
    const outOfStockClass = outOfStock ? 'out-of-stock' : '';

    const card = document.createElement('div');
    card.className = `pro ${outOfStockClass}`;
    card.style.cursor = 'pointer';

    card.innerHTML = `
        <div class="product-image-wrapper">
            <img 
    src="${defaultImage(product.image)}" 
    alt="${escapeHTML(product.name || 'Product image')}"
    loading="lazy"
>
            ${getStockBadgeHTML(stock)}
            ${getOutOfStockOverlayHTML(stock)}
        </div>
        <div class="des">
            <span>${safeText(product.category, 'Fashion')}</span>
            <h5>${safeText(product.name, 'Product')}</h5>
            <h4>${formatPrice(safePrice(product.price))}</h4>
            ${getLowStockTextHTML(stock)}
        </div>
        ${!outOfStock ? `<a href="product.html?id=${product.id}" class="cart"><i class="fas fa-shopping-cart"></i></a>` : ''}
    `;

    card.addEventListener('click', (e) => {
        if (e.target.closest('.cart')) return;
        window.location.href = `product.html?id=${product.id}`;
    });

    container.appendChild(card);
}

// fetch related products
async function loadRelatedProducts(
    currentProduct
) {
    try {
        if (
            !currentProduct
            ||
            !relatedProductsContainer
        ) {
            return;
        }

        const response =
            await AppUtils.apiRequest(
                "/products"
            );

        if (
            !response.success
        ) {
            throw new Error(
                response.message
                || "Failed to load products"
            );
        }

        const products =
            Array.isArray(
                response.products
            )
                ? response.products
                : [];

        const related =
            products.filter(
                (product) => {
                    return (
                        String(
                            product.id
                        )
                        !==
                        String(
                            currentProduct.id
                        )
                        &&
                        product.category
                        ===
                        currentProduct.category
                    );
                }
            )
            .slice(0, 4);
            
        renderRelatedProducts(
            related
        );

    } catch (error) {
        console.error(
            "RELATED PRODUCTS ERROR:",
            error
        );
    }
}

// render related products
function renderRelatedProducts(
    products = []
) {
    if (
        !relatedProductsContainer
    ) {
        return;
    }

    if (
        !products.length
    ) {
        relatedProductsContainer.innerHTML = `
            <p>
                No related products found
            </p>
        `;
        return;
    }

    relatedProductsContainer.innerHTML =
        "";

    products.forEach(
        (product) => {
            if (
                typeof renderProductCard
                === "function"
            ) {
                renderProductCard(
                    product,
                    relatedProductsContainer
                );
            }
        }
    );
}

// recently viewed recommendation
function loadRecentlyViewedRecommendations() {
    const viewed =
        AppUtils.getJSON(
            "recentlyViewed",
            []
        );

    const recommendationContainer =
        document.getElementById(
            "recently-viewed-products"
        );

    if (
        !recommendationContainer
    ) {
        return;
    }

    if (
        !viewed.length
    ) {
        recommendationContainer.innerHTML = `
            <p>
                No recently viewed products
            </p>
        `;
        return;
    }

    recommendationContainer.innerHTML =
        "";

    viewed.forEach(
        (product) => {
            if (
                typeof renderProductCard
                === "function"
            ) {
                renderProductCard(
                    product,
                    recommendationContainer
                );
            }
        }
    );
}

window.loadRelatedProducts =
    loadRelatedProducts;

window.renderRelatedProducts =
    renderRelatedProducts;

window.loadRecentlyViewedRecommendations =
    loadRecentlyViewedRecommendations;