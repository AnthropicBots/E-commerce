// featured products container
const homeFeaturedContainer = document.getElementById("featured-products");

// new arrivals container
const homeArrivalsContainer = document.getElementById("new-arrivals-container");

// safe helpers
function safeText(value, fallback = "") {
  return String(value ?? fallback);
}

function safePrice(value) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

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

/**
 * Is this product currently on the shopper's wishlist?
 *
 * `script.js` builds a `Set` of wishlist ids once per render and passes it in,
 * so the whole grid costs one `AppUtils.getWishlist()` call rather than one
 * per card. When the set is not supplied (other callers pass only a product),
 * fall back to reading the wishlist directly.
 *
 * @param {string|number} productId
 * @param {Set<string>} [wishlistIds]
 * @returns {boolean}
 */
function isProductWishlisted(productId, wishlistIds) {
    const id = String(productId);

    // Duck-typed rather than `instanceof Set`, which is false for a Set built
    // in a different realm (iframe, test sandbox).
    if (wishlistIds && typeof wishlistIds.has === "function") {
        return wishlistIds.has(id);
    }

    const wishlist =
        (typeof AppUtils !== "undefined" && AppUtils.getWishlist &&
            AppUtils.getWishlist()) || [];

    return wishlist.some((item) => item && String(item.id) === id);
}

// render product card with stock badge
//
// `wishlistIds` was previously missing from the signature even though
// `script.js` passes it as the second argument, and the body referenced an
// undefined `isWishlisted` -- a ReferenceError that was masked only because
// the file did not parse at all (#1296).
function createProductCard(
    product,
    wishlistIds
) {
    const isWishlisted = isProductWishlisted(product.id, wishlistIds);

    const rating =
        Math.min(
            5,
            Math.max(
                0,
                Number(
                    product.rating || 4
                )
            )
        );

    const stars =
        Array.from(
            {
                length: 5
            },
            (_, index) => {
                return `
                    <i class="fas fa-star${
                        index < rating
                            ? ""
                            : "-o"
                    }"></i>
                `;
            }
        ).join("");

    const stock = Number(product.stock) || 0;
    const outOfStock = isOutOfStock(stock);
    const outOfStockClass = outOfStock ? 'out-of-stock' : '';

    // The pre-`isProductWishlisted` version of this lookup was left in place
    // here by a bad merge (#1341): it re-declared `wishlistIds`, which is
    // already this function's parameter, and `isWishlisted`, already assigned
    // above -- a SyntaxError that took the whole homepage grid offline. It also
    // read a `wishlistSet` binding that does not exist in this scope.

    return `
        <div class="pro ${outOfStockClass} fade-in" data-id="${product.id}">
            ${
                product.featured
                    ? `<span class="product-badge">Featured</span>`
                    : ""
            }

            <div class="product-image-wrapper">
                <img
                    src="${typeof defaultImage === 'function' ? defaultImage(product.image) : (product.image || '')}"
                    alt="${typeof escapeHTML === 'function' ? escapeHTML(product.name || 'Product image') : (product.name || 'Product')}"
                    loading="lazy"
                    onerror="typeof handleImageError === 'function' && handleImageError(this)"
                >
                ${getStockBadgeHTML(stock)}
                ${getOutOfStockOverlayHTML(stock)}
            </div>

            <div class="des">
                <span>${safeText(product.brand || product.category, "Fashion")}</span>
                <h5>${safeText(product.name, "Product")}</h5>
                <div class="star">${stars}</div>
                <h4>${typeof formatPrice === 'function' ? formatPrice(safePrice(product.price)) : `$${safePrice(product.price)}`}</h4>
                ${getLowStockTextHTML(stock)}

                <div class="product-actions">
                    <button
                        type="button"
                        class="view-product-btn"
                        data-id="${product.id}"
                        ${outOfStock ? 'disabled' : ''}
                    >
                        View
                    </button>
                    <button
                        type="button"
                        class="add-cart-btn"
                        data-id="${product.id}"
                        ${outOfStock ? 'disabled' : ''}
                    >
                        Add Cart
                    </button>
                    <button
                        type="button"
                        class="compare-btn"
                        data-id="${product.id}"
                        ${outOfStock ? 'disabled' : ''}
                    >
                        Compare
                    </button>

                    <button
                        type="button"
                        class="wishlist-btn secondary-action"
                        data-id="${product.id}"
                    >
                        <i class="${isWishlisted ? "fas" : "far"} fa-heart"></i>
                        Wishlist
                    </button>
                </div>
            </div>
        </div>`;
}

// render skeleton cards
function renderSkeletonCards(containerId, count = 4) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let skeletons = "";
    for (let i = 0; i < count; i++) {
        skeletons += `
        <div class="pro skeleton-wrapper">
            <div class="skeleton skeleton-img"></div>
            <div class="des">
                <div class="skeleton skeleton-text short"></div>
                <div class="skeleton skeleton-text"></div>
                <div class="skeleton skeleton-text"></div>
                <div class="skeleton skeleton-text price"></div>
            </div>
        </div>
        `;
    }
    container.innerHTML = skeletons;
}

/**
 * Initialize touch inertia carousel on product containers safely
 * Prevents memory leaks by destroying previous instance on the container
 */
function attachTouchCarousel(container) {
    if (!container) return;
    if (typeof TouchInertiaCarousel === 'function') {
        new TouchInertiaCarousel(container);
    }
}

// render featured products
function renderFeaturedProducts(products = []) {
  if (!homeFeaturedContainer) {
    return;
  }

  // Cleanup old carousel instance to avoid memory leak
  if (homeFeaturedContainer.__touchCarouselInstance) {
      homeFeaturedContainer.__touchCarouselInstance.destroy();
  }

  const featured = products.filter((product) => product.featured);
  const wishlistIds = (typeof AppUtils !== 'undefined' && AppUtils.getWishlist) 
      ? new Set(AppUtils.getWishlist().map((item) => String(item.id))) 
      : new Set();

  homeFeaturedContainer.innerHTML = featured.length
    ? featured.slice(0, 8).map((product) => createProductCard(product, wishlistIds)).join("")
    : `<p class="empty-products">No featured products found</p>`;

    requestAnimationFrame(() => {
        const cards = homeFeaturedContainer.querySelectorAll('.pro');
        cards.forEach((card, i) => {
            card.setAttribute('data-anim-index', String(i));
        });

        if (typeof initializeScrollAnimations === "function") {
            initializeScrollAnimations();
        }

        if (typeof addProductCardAnimations === "function") {
            addProductCardAnimations('#featured-products');
        }

        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduce) {
            cards.forEach(card => {
                const rect = card.getBoundingClientRect();
                const inView = rect.top < window.innerHeight * 0.85 && rect.bottom > 0;
                if (inView) {
                    card.classList.add('in-view');
                }
            });
        }

        // Attach hardware-accelerated touch gesture carousel
        attachTouchCarousel(homeFeaturedContainer);
    });
}

// render new arrivals
function renderNewArrivals(products = []) {
    if (!homeArrivalsContainer) {
        return;
    }

    // Cleanup old carousel instance to avoid memory leak
    if (homeArrivalsContainer.__touchCarouselInstance) {
        homeArrivalsContainer.__touchCarouselInstance.destroy();
    }

    const arrivals = products.filter((product) => Number(product.featured) !== 1).slice(0, 8);
    const wishlistIds = (typeof AppUtils !== 'undefined' && AppUtils.getWishlist) 
        ? new Set(AppUtils.getWishlist().map((item) => String(item.id))) 
        : new Set();

    homeArrivalsContainer.innerHTML = arrivals.length
        ? arrivals.map((product) => createProductCard(product, wishlistIds)).join("")
        : `<p class="empty-products">No new arrivals found</p>`;

    requestAnimationFrame(() => {
        if (typeof initializeScrollAnimations === "function") {
            initializeScrollAnimations();
        }
        const cards = homeArrivalsContainer.querySelectorAll('.pro');
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const inView = rect.top < window.innerHeight * 0.85 && rect.bottom > 0;
            if (inView) {
                card.classList.add('in-view');
            }
        });

        // Attach hardware-accelerated touch gesture carousel
        attachTouchCarousel(homeArrivalsContainer);
    });
}

function refreshHomeCardAnimations() {
    if (typeof addProductCardAnimations === "function") {
        if (homeFeaturedContainer) {
            addProductCardAnimations("#featured-products");
        }
        if (homeArrivalsContainer) {
            addProductCardAnimations("#new-arrivals-container");
        }
        return;
    }

    if (typeof initializeScrollAnimations === "function") {
        initializeScrollAnimations();
    }
}

function renderFeaturedProductsWithAnim(products = []) {
  renderFeaturedProducts(products);
  refreshHomeCardAnimations();
}

function renderNewArrivalsWithAnim(products = []) {
  renderNewArrivals(products);
  refreshHomeCardAnimations();
}

window.renderFeaturedProducts = renderFeaturedProductsWithAnim;
window.renderNewArrivals = renderNewArrivalsWithAnim;
window.createProductCard = createProductCard;
