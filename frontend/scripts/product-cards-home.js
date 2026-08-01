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

// render product card
function createProductCard(product, wishlistIds = null, options = {}) {
  const rating = Math.min(5, Math.max(0, Number(product.rating || 4)));
  const showActions = options.showActions !== false;
  const compactClass = options.compact ? " product-card-compact" : "";

  const stars = Array.from(
    {
      length: 5,
    },
    (_, index) => {
      return `
                    <i class="fas fa-star${index < rating ? "" : "-o"}"></i>
                `;
    },
  ).join("");

  const isWishlisted = (wishlistIds instanceof Set)
    ? wishlistIds.has(String(product.id))
    : AppUtils.getWishlist().some((item) => String(item.id) === String(product.id));

  return `
        <div class="pro fade-in${compactClass}" data-id="${product.id}">
            ${
              product.featured
                ? `
                        <span class="product-badge">
                            Featured
                        </span>
                    `
                : ""
            }

            <img
                src="${defaultImage(product.image)}"
                alt="${safeText(product.name, "Product")}"
                loading="lazy"
                onerror="this.onerror=null; this.src='data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'200\\' height=\\'200\\' viewBox=\\'0 0 200 200\\'%3E%3Crect fill=\\'%23eee\\' width=\\'200\\' height=\\'200\\'/%3E%3Ctext fill=\\'%23999\\' font-family=\\'sans-serif\\' font-size=\\'14\\' x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dominant-baseline=\\'middle\\'%3ENo Image%3C/text%3E%3C/svg%3E';"
            >

            <div class="des">
                <span>
                    ${safeText(product.brand || product.category, "Fashion")}
                </span>

                <h5>
                    ${safeText(product.name, "Product")}
                </h5>

                <div class="star">
                    ${stars}
                </div>

                <h4>
                    ${formatPrice(safePrice(product.price))}
                </h4>

                ${
                  showActions
                    ? `
                <div class="product-actions">
                    <button
                        type="button"
                        class="view-product-btn primary-action"
                        data-id="${product.id}"
                    >
                        View
                    </button>
                    <button
                        type="button"
                        class="add-cart-btn primary-action"
                        data-id="${product.id}"
                    >
                        Add Cart
                    </button>
                    <button
                        type="button"
                        class="compare-btn secondary-action"
                        data-id="${product.id}">
                            <i class="fas fa-balance-scale"></i>
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
                    `
                    : ""
                }
            </div>
        </div>`;
}

// render featured products
function renderFeaturedProducts(products = []) {
  if (!homeFeaturedContainer) {
    return;
  }

  const featured = products.filter((product) => product.featured);
  const wishlistIds = new Set(AppUtils.getWishlist().map((item) => String(item.id)));

  homeFeaturedContainer.innerHTML = featured.length
    ? featured.slice(0, 8).map((product) => createProductCard(product, wishlistIds)).join("")
    : `
                <p class="empty-products">
                    No featured products found
                </p>
            `;

  // Add stagger indices for scroll animation
  requestAnimationFrame(() => {
    const cards = homeFeaturedContainer.querySelectorAll(".pro");

    cards.forEach((card, i) => {
      card.setAttribute("data-anim-index", String(i));
    });

    if (typeof addProductCardAnimations === "function") {
      addProductCardAnimations("#featured-products");
    }
  });
}

// render new arrivals
function renderNewArrivals(products = []) {
  if (!homeArrivalsContainer) {
    return;
  }

  // Filter out featured products to match script.js logic
  const arrivals = products
    .filter((product) => Number(product.featured) !== 1)
    .slice(0, 8);

  const wishlistIds = new Set(AppUtils.getWishlist().map((item) => String(item.id)));

  homeArrivalsContainer.innerHTML = arrivals.length
    ? arrivals.map((product) => createProductCard(product, wishlistIds)).join("")
    : `
                <p class="empty-products">
                    No new arrivals found
                </p>
            `;

  // Force animations for already-visible cards (above-the-fold)
  requestAnimationFrame(() => {
    if (typeof addProductCardAnimations === "function") {
      addProductCardAnimations("#new-arrivals-container");
    }
  });
}

// after rendering new cards, re-apply scroll animations if available
function refreshHomeCardAnimations() {
  // Prefer the dedicated helper (animations.js)
  if (typeof addProductCardAnimations === "function") {
    if (homeFeaturedContainer) {
      addProductCardAnimations("#featured-products");
    }
    if (homeArrivalsContainer) {
      addProductCardAnimations("#new-arrivals-container");
    }
    return;
  }

  // Fallback: re-run observer setup
  if (typeof initializeScrollAnimations === "function") {
    initializeScrollAnimations();
  }
}

// wrap render functions to trigger animations after DOM updates
function renderFeaturedProductsWithAnim(products = []) {
  renderFeaturedProducts(products);
  refreshHomeCardAnimations();
}

function renderNewArrivalsWithAnim(products = []) {
  renderNewArrivals(products);
  refreshHomeCardAnimations();
}

// expose globally
window.renderFeaturedProducts = renderFeaturedProductsWithAnim;

window.renderNewArrivals = renderNewArrivalsWithAnim;

window.createProductCard = createProductCard;
