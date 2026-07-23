// dashboard wishlist elements
const getDashboardElements = () => ({
    wishlistContainer: document.getElementById("wishlist-items"),
    wishlistCount: document.getElementById("wishlist-count"),
    cartContainer: document.getElementById("saved-cart-items"),
    cartCount: document.getElementById("cart-count-dashboard")
});

// paint wishlist from whatever is currently stored
function paintDashboardWishlist() {
    const elements = getDashboardElements();
    const wishlist = AppUtils.getWishlist();

    if (elements.wishlistCount) {
        elements.wishlistCount.innerText = wishlist.length;
    }

    if (!elements.wishlistContainer) {
        return;
    }

    if (!wishlist.length) {
        renderDashboardEmptyState(
            elements.wishlistContainer,
            "No wishlist items found."
        );
        return;
    }

    elements.wishlistContainer.innerHTML = "";

    wishlist.forEach((item) => {
        if (!item) return;
        const card = document.createElement("div");
        card.className = "dashboard-item-card";
        card.innerHTML = `
            <img
                src="${AppUtils.defaultImage(item.image || item.img)}"
                alt="${item.name || "Product"}"
            >
            <div class="dashboard-item-info">
                <h4>${item.name || "Product"}</h4>
                <p>${item.brand || ""}</p>
                <strong>${AppUtils.formatPrice(item.price || 0)}</strong>
            </div>
        `;
        elements.wishlistContainer.appendChild(card);
    });
}

// render wishlist (paint local first, then sync from backend)
async function renderDashboardWishlist() {
    // show stored items immediately so the panel never sits blank
    paintDashboardWishlist();

    const token = AppUtils.getToken();
    if (!token) {
        return;
    }

    try {
        const response = await AppUtils.apiRequest("/wishlist");
        // only adopt the server copy when it actually has items, so an
        // empty/unsynced server response never wipes the local wishlist.
        // setJSON (not saveWishlist) avoids echoing a sync request back.
        if (response && response.success && Array.isArray(response.wishlist) && response.wishlist.length) {
            AppUtils.setJSON(AppUtils.CONFIG.STORAGE_KEYS.WISHLIST, response.wishlist);
            paintDashboardWishlist();
        }
    } catch (error) {
        console.error("Failed to fetch wishlist in dashboard:", error);
    }
}

// render cart
function renderDashboardCart() {
    const elements = getDashboardElements();
    const cart = AppUtils.getCart();

    if (elements.cartCount) {
        elements.cartCount.innerText = cart.length;
    }

    if (!elements.cartContainer) {
        return;
    }

    if (!cart.length) {
        renderDashboardEmptyState(
            elements.cartContainer,
            "No saved cart items found."
        );
        return;
    }

    elements.cartContainer.innerHTML = "";

    cart.forEach((item) => {
        if (!item) return;
        const card = document.createElement("div");
        card.className = "dashboard-item-card";
        card.innerHTML = `
            <img
                src="${AppUtils.defaultImage(item.image || item.img)}"
                alt="${item.name || "Product"}"
            >
            <div class="dashboard-item-info">
                <h4>${item.name || "Product"}</h4>
                <p>Qty: ${item.qty || 1}</p>
                <strong>${AppUtils.formatPrice(item.price || 0)}</strong>
            </div>
        `;
        elements.cartContainer.appendChild(card);
    });
}

// expose globally
window.renderDashboardWishlist = renderDashboardWishlist;
window.paintDashboardWishlist = paintDashboardWishlist;
window.renderDashboardCart = renderDashboardCart;