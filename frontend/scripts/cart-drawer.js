// cart drawer elements
const cartDrawer = document.getElementById("cart-drawer");
const cartDrawerItems = document.getElementById("cart-drawer-items");
const cartDrawerTotal = document.getElementById("cart-drawer-total");
const closeCartBtn = document.getElementById("close-cart-drawer");
const cartLiveRegion = document.getElementById("cart-drawer-live-region");

const isCartPage = /cart\.html$/i.test(window.location.pathname);

// Focus Trap & Accessibility State
let lastFocusedElement = null;
let drawerCart = AppUtils.getCart();

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function announceToScreenReader(message) {
    if (!message) return;
    const liveRegion = cartLiveRegion || document.getElementById("cart-drawer-live-region");
    if (liveRegion) {
        liveRegion.textContent = "";
        void liveRegion.offsetWidth;
        liveRegion.textContent = message;
    }
}

function handleDrawerKeyDown(event) {
    if (!cartDrawer || !cartDrawer.classList.contains("active")) return;

    if (event.key === "Escape") {
        event.preventDefault();
        closeCartDrawer();
        return;
    }

    if (event.key === "Tab") {
        const focusableElements = Array.from(cartDrawer.querySelectorAll(FOCUSABLE_SELECTOR));
        if (!focusableElements.length) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
            // Shift + Tab: if on first element, wrap around to last
            if (document.activeElement === firstElement || !cartDrawer.contains(document.activeElement)) {
                event.preventDefault();
                lastElement.focus();
            }
        } else {
            // Tab: if on last element, wrap around to first
            if (document.activeElement === lastElement || !cartDrawer.contains(document.activeElement)) {
                event.preventDefault();
                firstElement.focus();
            }
        }
    }
}

function bindCartDrawerTriggers() {
    const cartLinks = document.querySelectorAll('.cart-link a[href*="cart.html"], #open-cart-drawer');

    cartLinks.forEach((link) => {
        link.setAttribute("aria-haspopup", "dialog");
        link.setAttribute("aria-expanded", "false");

        if (link.dataset.drawerBound === "true") {
            return;
        }

        link.dataset.drawerBound = "true";

        link.addEventListener("click", (event) => {
            if (!cartDrawer || isCartPage) {
                return;
            }

            event.preventDefault();
            openCartDrawer(link);
        });
    });
}

// open drawer with focus trap & ARIA management
function openCartDrawer(triggerElement = null) {
    if (!cartDrawer) {
        return;
    }

    // Save triggering element to restore focus on close
    lastFocusedElement = triggerElement || document.activeElement;

    cartDrawer.classList.add("active");
    cartDrawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    document.querySelectorAll('.cart-link a[href*="cart.html"], #open-cart-drawer').forEach((btn) => {
        btn.setAttribute("aria-expanded", "true");
    });

    // Attach keydown listener for Keyboard Focus Trap & Escape key
    document.addEventListener("keydown", handleDrawerKeyDown);

    renderCartDrawer().then(() => {
        // Set initial focus inside drawer
        const focusables = cartDrawer.querySelectorAll(FOCUSABLE_SELECTOR);
        if (closeCartBtn) {
            closeCartBtn.focus();
        } else if (focusables.length > 0) {
            focusables[0].focus();
        }

        const count = drawerCart.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
        announceToScreenReader(`Shopping cart drawer opened. ${count} item${count !== 1 ? 's' : ''} in cart.`);
    });
}

// close drawer & restore focus
function closeCartDrawer() {
    if (!cartDrawer) {
        return;
    }

    cartDrawer.classList.remove("active");
    cartDrawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    // Reset trigger ARIA state
    document.querySelectorAll('.cart-link a[href*="cart.html"], #open-cart-drawer').forEach((btn) => {
        btn.setAttribute("aria-expanded", "false");
    });

    // Remove focus trap keydown listener
    document.removeEventListener("keydown", handleDrawerKeyDown);

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function" && document.body.contains(lastFocusedElement)) {
        lastFocusedElement.focus();
    }
    lastFocusedElement = null;

    announceToScreenReader("Shopping cart drawer closed.");
}

// render cart drawer with ARIA attributes
async function renderCartDrawer() {
    if (!cartDrawerItems || !cartDrawerTotal) {
        return;
    }

    drawerCart = AppUtils.getCart();

    if (!drawerCart.length) {
        cartDrawerItems.innerHTML = `
            <p class="empty-cart" tabIndex="0">
                Your cart is empty
            </p>
        `;

        cartDrawerTotal.innerHTML = AppUtils.formatPrice(0);
        return;
    }

    cartDrawerItems.innerHTML = drawerCart.map((item, index) => {
        const qty = Math.max(1, AppUtils.safeInteger(item.qty, 1));
        const price = AppUtils.safeNumber(item.price, 0);
        const itemName = AppUtils.escapeHTML(item.name || "Product");

        return `
            <div class="drawer-item" role="group" aria-label="${itemName}">
                <img
                    src="${AppUtils.escapeHTML(AppUtils.defaultImage(item.img || item.image))}"
                    alt="${itemName}"
                    loading="lazy"
                >

                <div class="drawer-item-info">
                    <h4>${itemName}</h4>
                    <p aria-label="Unit price ${AppUtils.formatPrice(price)}">${AppUtils.formatPrice(price)}</p>

                    <div
                        class="drawer-qty-controls"
                        role="group"
                        aria-label="Quantity controls for ${itemName}"
                    >
                        <button
                            type="button"
                            class="drawer-decrease-qty"
                            data-index="${index}"
                            aria-label="Decrease quantity for ${itemName}"
                            ${qty <= 1 ? "disabled" : ""}
                        >
                            -
                        </button>

                        <span aria-live="polite" aria-atomic="true" aria-label="Current quantity ${qty}">${qty}</span>

                        <button
                            type="button"
                            class="drawer-increase-qty"
                            data-index="${index}"
                            aria-label="Increase quantity for ${itemName}"
                        >
                            +
                        </button>
                    </div>
                </div>

                <button
                    type="button"
                    class="remove-drawer-item"
                    data-index="${index}"
                    aria-label="Remove ${itemName} from cart"
                >
                    ✕
                </button>
            </div>
        `;
    }).join("");

    const { subtotal } = await AppUtils.calculateCartTotals(drawerCart);
    cartDrawerTotal.innerHTML = AppUtils.formatPrice(subtotal);
}

async function updateDrawerQty(index, delta) {
    const parsedIndex = parseInt(index, 10);

    if (isNaN(parsedIndex) || !drawerCart[parsedIndex]) {
        return;
    }

    const item = drawerCart[parsedIndex];
    const newQty = AppUtils.safeInteger(item.qty, 1) + delta;

    drawerCart = AppUtils.updateCartItemQty(parsedIndex, newQty);

    await renderCartDrawer();

    if (typeof updateCartCount === "function") {
        updateCartCount();
    }

    const updatedSubtotal = (await AppUtils.calculateCartTotals(drawerCart)).subtotal;
    announceToScreenReader(`Updated quantity of ${item.name || 'Item'} to ${newQty}. Subtotal is now ${AppUtils.formatPrice(updatedSubtotal)}.`);
}

// remove item
async function removeDrawerItem(index) {
    if (index === undefined || index === null) {
        return;
    }

    const parsedIndex = parseInt(index, 10);

    if (isNaN(parsedIndex) || !drawerCart[parsedIndex]) {
        return;
    }

    const removedItemName = drawerCart[parsedIndex].name || "Item";

    drawerCart = AppUtils.removeCartItem(parsedIndex);

    await renderCartDrawer();

    if (typeof updateCartCount === "function") {
        updateCartCount();
    }

    AppUtils.notify("Item removed from cart", "info");

    const updatedSubtotal = (await AppUtils.calculateCartTotals(drawerCart)).subtotal;
    announceToScreenReader(`Removed ${removedItemName} from cart. Cart subtotal is now ${AppUtils.formatPrice(updatedSubtotal)}.`);
}

// close cart trigger
if (closeCartBtn) {
    closeCartBtn.addEventListener("click", (event) => {
        event.preventDefault();
        closeCartDrawer();
    });
}

// outside click close
document.addEventListener("click", (event) => {
    if (cartDrawer && cartDrawer.classList.contains("active") && event.target === cartDrawer) {
        closeCartDrawer();
    }
});

// drawer event delegation
document.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".remove-drawer-item");
    const increaseBtn = event.target.closest(".drawer-increase-qty");
    const decreaseBtn = event.target.closest(".drawer-decrease-qty");

    if (increaseBtn) {
        event.preventDefault();
        updateDrawerQty(increaseBtn.dataset.index, 1);
        return;
    }

    if (decreaseBtn) {
        event.preventDefault();
        updateDrawerQty(decreaseBtn.dataset.index, -1);
        return;
    }

    if (removeBtn) {
        event.preventDefault();
        removeDrawerItem(removeBtn.dataset.index);
    }
});

document.addEventListener("componentsLoaded", bindCartDrawerTriggers);
bindCartDrawerTriggers();

// expose globally
window.openCartDrawer = openCartDrawer;
window.closeCartDrawer = closeCartDrawer;
window.renderCartDrawer = renderCartDrawer;

window.addEventListener(AppUtils.CART_UPDATED_EVENT, renderCartDrawer);
