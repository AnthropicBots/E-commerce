// cart drawer elements
const cartDrawer =
    document.getElementById(
        "cart-drawer"
    );

const cartDrawerItems =
    document.getElementById(
        "cart-drawer-items"
    );

const cartDrawerTotal =
    document.getElementById(
        "cart-drawer-total"
    );

const closeCartBtn =
    document.getElementById(
        "close-cart-drawer"
    );

const isCartPage =
    /cart\.html$/i.test(
        window.location.pathname
    );

// cart state
let drawerCart =
    AppUtils.getCart();

function bindCartDrawerTriggers() {
    const cartLinks =
        document.querySelectorAll(
            '.cart-link a[href*="cart.html"], #open-cart-drawer'
        );

    cartLinks.forEach(
        (link) => {
            if (
                link.dataset.drawerBound ===
                "true"
            ) {
                return;
            }

            link.dataset.drawerBound =
                "true";

            link.addEventListener(
                "click",
                (event) => {
                    if (
                        !cartDrawer
                        ||
                        isCartPage
                    ) {
                        return;
                    }

                    event.preventDefault();
                    openCartDrawer();
                }
            );
        }
    );
}

// open drawer
function openCartDrawer() {
    if (
        !cartDrawer
    ) {
        return;
    }

    cartDrawer.classList.add(
        "active"
    );

    cartDrawer.setAttribute(
        "aria-hidden",
        "false"
    );

    document.body.style.overflow =
        "hidden";

    renderCartDrawer();
}

// close drawer
function closeCartDrawer() {
    if (
        !cartDrawer
    ) {
        return;
    }

    cartDrawer.classList.remove(
        "active"
    );

    cartDrawer.setAttribute(
        "aria-hidden",
        "true"
    );

    document.body.style.overflow =
        "";
}

// render cart drawer
function renderCartDrawer() {
    if (
        !cartDrawerItems
        ||
        !cartDrawerTotal
    ) {
        return;
    }

    drawerCart =
        AppUtils.getCart();

    if (
        !drawerCart.length
    ) {

        cartDrawerItems.innerHTML =
            `
                <p class="empty-cart">
                    Your cart is empty
                </p>
            `;

        cartDrawerTotal.innerHTML =
            AppUtils.formatPrice(0);
        return;
    }

    cartDrawerItems.innerHTML =
        drawerCart.map(
            (item, index) => {
                const qty =
                    Math.max(
                        1,
                        AppUtils.safeInteger(
                            item.qty,
                            1
                        )
                    );

                const price =
                    AppUtils.safeNumber(
                        item.price,
                        0
                    );

                return `
                    <div class="drawer-item">
                        <img
                            src="${
                                AppUtils.escapeHTML(
                                    AppUtils.defaultImage(
                                        item.img || item.image
                                    )
                                )
                            }"
                            alt="${
                                AppUtils.escapeHTML(
                                    item.name || "Product"
                                )
                            }"
                            loading="lazy"
                        >

                        <div class="drawer-item-info">
                            <h4>
                                ${
                                    AppUtils.escapeHTML(
                                        item.name || "Product"
                                    )
                                }
                            </h4>

                            <p>
                                ${
                                    AppUtils.formatPrice(
                                        price
                                    )
                                }
                            </p>

                            <div
                                class="drawer-qty-controls"
                                aria-label="Quantity controls"
                            >
                                <button
                                    type="button"
                                    class="drawer-decrease-qty"
                                    data-index="${index}"
                                    aria-label="Decrease quantity"
                                    ${qty <= 1 ? "disabled" : ""}
                                >
                                    -
                                </button>

                                <span aria-live="polite">${qty}</span>

                                <button
                                    type="button"
                                    class="drawer-increase-qty"
                                    data-index="${index}"
                                    aria-label="Increase quantity"
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        <button
                            type="button"
                            class="remove-drawer-item"
                            data-index="${index}"
                            aria-label="Remove item"
                        >
                            ✕
                        </button>
                    </div>
                `;
            }
        ).join("");

    const total =
        AppUtils.calculateCartTotals(
            drawerCart
        ).subtotal;

    cartDrawerTotal.innerHTML =
        AppUtils.formatPrice(
            total
        );
}

function updateDrawerQty(
    index,
    delta
) {
    const parsedIndex =
        parseInt(
            index,
            10
        );

    if (
        isNaN(parsedIndex)
        ||
        !drawerCart[parsedIndex]
    ) {
        return;
    }

    drawerCart[parsedIndex].qty =
        Math.max(
            1,
            AppUtils.safeInteger(
                drawerCart[parsedIndex].qty,
                1
            ) + delta
        );

    drawerCart =
        AppUtils.saveCart(
            drawerCart
        );

    renderCartDrawer();

    if (
        typeof updateCartCount ===
        "function"
    ) {
        updateCartCount();
    }
}

// remove item
function removeDrawerItem(
    index
) {
    if (
        index === undefined || index === null
    ) {
        return;
    }

    const parsedIndex =
        parseInt(
            index,
            10
        );

    if (
        isNaN(parsedIndex)
        ||
        !drawerCart[parsedIndex]
    ) {
        return;
    }

    drawerCart.splice(
        parsedIndex,
        1
    );

    drawerCart =
        AppUtils.saveCart(
            drawerCart
        );

    renderCartDrawer();

    if (
        typeof updateCartCount ===
        "function"
    ) {
        updateCartCount();
    }

    AppUtils.notify(
        "Item removed from cart",
        "info"
    );
}

// close cart
if (
    closeCartBtn
) {
    closeCartBtn.addEventListener(
        "click",
        (
            event
        ) => {
            event.preventDefault();
            closeCartDrawer();
        }
    );
}

// escape close
document.addEventListener(
    "keydown",
    (
        event
    ) => {

        if (
            event.key ===
            "Escape"
        ) {
            closeCartDrawer();
        }
    }
);

// outside click close
document.addEventListener(
    "click",
    (
        event
    ) => {
        if (
            cartDrawer
            &&
            cartDrawer.classList.contains(
                "active"
            )
            &&
            event.target === cartDrawer
        ) {
            closeCartDrawer();
        }
    }
);

// drawer delegation
document.addEventListener(
    "click",
    (
        event
    ) => {
        const removeBtn =
            event.target.closest(
                ".remove-drawer-item"
            );

        const increaseBtn =
            event.target.closest(
                ".drawer-increase-qty"
            );

        const decreaseBtn =
            event.target.closest(
                ".drawer-decrease-qty"
            );

        if (
            increaseBtn
        ) {
            event.preventDefault();
            updateDrawerQty(
                increaseBtn.dataset.index,
                1
            );
            return;
        }

        if (
            decreaseBtn
        ) {
            event.preventDefault();
            updateDrawerQty(
                decreaseBtn.dataset.index,
                -1
            );
            return;
        }

        if (
            removeBtn
        ) {
            event.preventDefault();
            removeDrawerItem(
                removeBtn.dataset.index
            );
        }
    }
);

document.addEventListener(
    "componentsLoaded",
    bindCartDrawerTriggers
);

bindCartDrawerTriggers();

// expose globally
window.openCartDrawer =
    openCartDrawer;

window.renderCartDrawer =
    renderCartDrawer;

window.addEventListener(
    AppUtils.CART_UPDATED_EVENT,
    renderCartDrawer
);
