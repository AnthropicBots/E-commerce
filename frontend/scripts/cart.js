(() => {
// CART STATE
let cart =
    AppUtils.getCart();

// CART PAGE ELEMENTS
const elements = {
    cartContainer:
        document.getElementById(
            "cart-items"
        ),

    subtotalElement:
        document.getElementById(
            "subtotal"
        ),

    taxElement:
        document.getElementById(
            "tax"
        ),

    totalElement:
        document.getElementById(
            "total"
        ),

    shippingElement:
        document.getElementById(
            "shipping"
        ),

    checkoutBtn:
        document.getElementById(
            "checkout-btn"
        )
};

// SAVE CART
function saveCart() {
    AppUtils.saveCart(
        cart
    );

    if (
        typeof updateCartCount ===
        "function"
    ) {

        updateCartCount();
    }

    if (
        typeof renderCartDrawer ===
        "function"
    ) {

        renderCartDrawer();
    }
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

// SAFE HELPERS
function safePrice(
    value
) {

    const parsed =
        parseFloat(
            value
        );

    return isNaN(parsed)
        ? 0
        : parsed;
}

function safeQty(
    value
) {

    const parsed =
        parseInt(
            value,
            10
        );

    return isNaN(parsed)
        ? 1
        : Math.max(
            1,
            parsed
        );
}

// ========================================
// EMPTY CART - FIXED Continue Shopping (Issue #1206)
// ========================================
function renderEmptyCart() {
    if (
        !elements.cartContainer
    ) {
        return;
    }

    elements.cartContainer.innerHTML =
        `
            <div class="empty-cart">
                <i class="fas fa-shopping-cart empty-cart-icon"></i>
                <h2>
                    Your cart is empty
                </h2>

                <p>
                    Looks like you haven't added any items to your cart yet.
                </p>

                <p class="empty-cart-sub">
                    Start shopping to fill your cart with amazing products!
                </p>

                <button 
                    id="continue-shopping-btn" 
                    class="continue-shopping-btn"
                >
                    <i class="fas fa-arrow-left"></i>
                    Continue Shopping
                </button>
            </div>
        `;

    // ✅ FIX: Add event listener to Continue Shopping button
    const continueBtn = document.getElementById('continue-shopping-btn');
    if (continueBtn) {
        continueBtn.addEventListener('click', function(e) {
            e.preventDefault();
            window.location.href = 'shop.html';
        });
    }

    updateCartTotals(
        0
    );
}

// UPDATE TOTALS
function updateCartTotals(
    subtotal
) {
    const safeSubtotal =
        safePrice(
            subtotal
        );

    const tax =
        safeSubtotal * 0.18;

    const shipping =
        safeSubtotal > 0
        &&
        safeSubtotal < 999
            ? 49
            : 0;

    const total =
        safeSubtotal +
        tax +
        shipping;

    AppUtils.setJSON(
        "shippingCost",
        shipping
    );

    if (
        elements.subtotalElement
    ) {
        elements.subtotalElement.innerText =
            AppUtils.formatPrice(
                safeSubtotal
            );
    }

    if (
        elements.taxElement
    ) {
        elements.taxElement.innerText =
            AppUtils.formatPrice(
                tax
            );
    }

    if (
        elements.shippingElement
    ) {
        elements.shippingElement.innerText =
            shipping === 0
                ? "Free"
                : AppUtils.formatPrice(
                    shipping
                );
    }

    if (
        elements.totalElement
    ) {
        elements.totalElement.innerText =
            AppUtils.formatPrice(
                total
            );
    }
}

// ========================================
// UPDATE BUTTON STATES (Issue #348)
// ========================================
function updateButtonStates() {
    document.querySelectorAll('.cart-item').forEach((itemEl) => {
        const qtySpan = itemEl.querySelector('.cart-qty-controls span');
        const decreaseBtn = itemEl.querySelector('.decrease-qty');
        if (!qtySpan || !decreaseBtn) return;
        const qty = parseInt(qtySpan.textContent, 10);
        decreaseBtn.disabled = (qty <= 1);
        if (qty <= 1) {
            decreaseBtn.style.opacity = '0.5';
            decreaseBtn.style.cursor = 'not-allowed';
            decreaseBtn.title = 'Minimum quantity is 1';
        } else {
            decreaseBtn.style.opacity = '1';
            decreaseBtn.style.cursor = 'pointer';
            decreaseBtn.title = '';
        }
    });
}

// RENDER CART
function renderCart() {
    if (
        !elements.cartContainer
    ) {
        return;
    }

    cart =
        AppUtils.getCart();

    if (
       !AppUtils.safeArray(
           cart
       ).length
    ) {

        renderEmptyCart();

        return;
    }

    elements.cartContainer.innerHTML =
        "";

    const fragment =
        document.createDocumentFragment();

    let subtotal =
        0;

    cart.forEach(
        (
            item,
            index
        ) => {

            const price =
                safePrice(
                    item.price
                );

            const qty =
                safeQty(
                    item.qty
                );

            subtotal +=
                price * qty;

            const cartItem =
                document.createElement(
                    "div"
                );

            cartItem.classList.add(
                "cart-item"
            );

            cartItem.innerHTML =
                `
                    <img
                        src="${escapeHTML(
                            AppUtils.defaultImage(
                                item.img || item.image
                            )
                        )}"
                        alt="${escapeHTML(
                            item.name || "Product"
                        )}"
                        loading="lazy"
                    >

                    <div class="cart-item-info">

                        <h3>
                            ${escapeHTML(
                                item.name || "Product"
                            )}
                        </h3>

                        <p>
                            Price:
                            ${
                                AppUtils.formatPrice(
                                    price
                                )
                            }
                        </p>

                        ${
                            item.color
                                ? `
                                    <p>
                                        Color:
                                        ${escapeHTML(item.color)}
                                    </p>
                                `
                                : ""
                        }

                        ${
                            item.size
                                ? `
                                    <p>
                                        Size:
                                        ${escapeHTML(item.size)}
                                    </p>
                                `
                                : ""
                        }

                        <div class="cart-qty-controls">

                            <button
                                type="button"
                                data-index="${index}"
                                class="decrease-qty"
                                aria-label="Decrease quantity"
                            >
                                -
                            </button>

                            <span>
                                ${qty}
                            </span>

                            <button
                                type="button"
                                data-index="${index}"
                                class="increase-qty"
                                aria-label="Increase quantity"
                            >
                                +
                            </button>

                        </div>
                    </div>

                    <div class="cart-item-actions">

                        <button
                            type="button"
                            class="move-wishlist-btn"
                            data-index="${index}"
                        >
                            Move to Wishlist
                        </button>

                        <button
                            type="button"
                            class="remove-btn"
                            data-index="${index}"
                        >
                            Remove
                        </button>

                    </div>
                `;

            fragment.appendChild(
                cartItem
            );
        }
    );

    elements.cartContainer.appendChild(
        fragment
    );

    // Update button states after rendering
    updateButtonStates();

    updateCartTotals(
        subtotal
    );
}

// CART EVENT DELEGATION
document.addEventListener(
    "click",
    async (
        event
    ) => {

        // increase qty
        const increaseBtn =
            event.target.closest(
                ".increase-qty"
            );

        if (
            increaseBtn
        ) {

            const index =
                parseInt(
                    increaseBtn.dataset.index,
                    10
                );

            if (
                !cart[index]
            ) {
                return;
            }

            cart[index].qty =
                Math.min(
                    10,
                    safeQty(
                        cart[index].qty
                    ) + 1
                );

            saveCart();

            renderCart();

            return;
        }

        // ========================================
        // decrease qty (Issue #348 - min 1 fix)
        // ========================================
        const decreaseBtn =
            event.target.closest(
                ".decrease-qty"
            );

        if (
            decreaseBtn
        ) {

            const index =
                parseInt(
                    decreaseBtn.dataset.index,
                    10
                );

            if (
                !cart[index]
            ) {
                return;
            }

            const currentQty =
                safeQty(
                    cart[index].qty
                );

            // ✅ CHECK: if quantity is 1 or less, show toast and return
            if (
                currentQty <= 1
            ) {

                AppUtils.notify(
                    "Minimum quantity is 1",
                    "warning"
                );

                // Disable the button visually
                decreaseBtn.disabled = true;
                decreaseBtn.style.opacity = '0.5';
                decreaseBtn.style.cursor = 'not-allowed';

                return;
            }

            // Decrease quantity
            cart[index].qty = currentQty - 1;

            saveCart();

            renderCart();

            return;
        }

        // remove item
        const removeBtn =
            event.target.closest(
                ".remove-btn"
            );

        if (
            removeBtn
        ) {

            const index =
                parseInt(
                    removeBtn.dataset.index,
                    10
                );

            if (
                !cart[index]
            ) {
                return;
            }

            cart.splice(
                index,
                1
            );

            saveCart();

            renderCart();

            AppUtils.notify(
                "Item removed 🗑️",
                "success"
            );

            return;
        }

        // move wishlist
        const wishlistBtn =
            event.target.closest(
                ".move-wishlist-btn"
            );

        if (
            wishlistBtn
        ) {

            const index =
                parseInt(
                    wishlistBtn.dataset.index,
                    10
                );

            if (
                !cart[index]
            ) {
                return;
            }

            const wishlist =
                AppUtils.getWishlist();

            const exists =
                wishlist.find(
                    (item) =>

                        item.id ===
                        cart[index].id
                        &&
                        item.color ===
                        cart[index].color
                        &&
                        item.size ===
                        cart[index].size
                );

            if (
                !exists
            ) {

                wishlist.push(
                    cart[index]
                );
            }

            AppUtils.saveWishlist(
                wishlist
            );

            cart.splice(
                index,
                1
            );

            saveCart();

            renderCart();

            AppUtils.notify(
                "Moved to wishlist ❤️",
                "success"
            );
        }
    }
);

// ADD TO CART
async function addToCartFromProduct(
    product
) {
    const item = {
        id:
            product.id,

        name:
            product.name,

        price:
            safePrice(
                product.price
            ),

        img:
            product.img ||
            product.image,

        color:
            product.color || null,

        size:
            product.size || null,

        qty:
            safeQty(
                product.qty
            )
    };

    // duplicate check
    const existingIndex =
        cart.findIndex(
            (p) =>
                p.id === item.id
                &&
                p.color === item.color
                &&
                p.size === item.size
        );

    if (
        existingIndex >= 0
    ) {
        cart[
            existingIndex
        ].qty += item.qty;

    } else {
        cart.push(
            item
        );
    }

    saveCart();

    AppUtils.notify(
        "Added to cart 🛍️",
        "success"
    );

    if (
        elements.cartContainer
    ) {
        renderCart();
    }
}

// CHECKOUT BUTTON
if (
    elements.checkoutBtn
) {
    elements.checkoutBtn.addEventListener(
        "click",
        () => {
            if (
                !cart.length
            ) {
                AppUtils.notify(
                    "Your cart is empty.",
                    "warning"
                );
                return;
            }

            window.location.href =
                "checkout.html";
        }
    );
}

// ========================================
// CONTINUE SHOPPING - FIX (Issue #1206)
// ========================================

function setupContinueShopping() {
    const continueBtn = document.getElementById('continue-shopping-btn');
    
    if (!continueBtn) {
        // Button might not exist yet (empty cart not rendered)
        return;
    }
    
    // Remove existing listeners to avoid duplicates
    const newBtn = continueBtn.cloneNode(true);
    continueBtn.parentNode.replaceChild(newBtn, continueBtn);
    
    newBtn.addEventListener('click', function(e) {
        e.preventDefault();
        window.location.href = 'shop.html';
    });
}

// INIT
document.addEventListener(
    "DOMContentLoaded",
    () => {
        renderCart();
        // Setup continue shopping after render
        setTimeout(setupContinueShopping, 100);
    }
);

// Also setup when cart is rendered (for dynamic updates)
const originalRenderCart = renderCart;
renderCart = function() {
    originalRenderCart();
    setTimeout(setupContinueShopping, 100);
};

})();