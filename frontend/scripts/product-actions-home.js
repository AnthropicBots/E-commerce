(function(){
// save cart
function saveHomeCart(cart) {
    AppUtils.saveCart(
        cart
    );

    if (
        typeof updateCartCount ===
        "function"
    ) {
        updateCartCount();
    }
}

// save wishlist
function saveHomeWishlist(wishlist) {
    AppUtils.saveWishlist(
        wishlist
    );
}

// add to cart
function addToCart(
    product
) {
    if (
        !product
        ||
        !product.id
    ) {
        return;
    }

    // cart is account-bound: guests must sign in first
    if (!AppUtils.requireLogin("Please sign in to add items to your cart")) {
        return;
    }

    const cart = AppUtils.getCart();

    const existing =
        cart.find(
            (item) =>
                String(item.id)
                === String(product.id)
        );

    if (
        existing
    ) {
        existing.qty =
            Math.max(
                1,
                Number(
                    existing.qty || 1
                ) + 1
            );

    } else {
        cart.push({
            ...product,
            qty: 1
        });
    }

    saveHomeCart(cart);

    AppUtils.notify(
        `${product.name} added to cart`,
        "success"
    );

    // flip the "Add Cart" button into a quantity counter
    refreshCartControls(product.id);
}

// build the markup for a card's cart control: an "Add Cart"
// button when the item isn't in the cart, otherwise a − qty + counter
function buildCartControlHTML(productId) {
    const cart = AppUtils.getCart();

    const item =
        cart.find(
            (entry) =>
                String(entry.id)
                === String(productId)
        );

    const qty = item ? Number(item.qty) || 0 : 0;

    // resolve stock from the cart item or the product catalog
    const product =
        item
        || getProductById(productId, window.allProducts || []);

    const stock = product ? Number(product.stock) : NaN;
    const hasStockInfo = !isNaN(stock);

    if (qty > 0) {
        // can't increase past available stock
        const atMax = hasStockInfo && qty >= stock;

        return `
            <div class="qty-counter">
                <button type="button" class="qty-decrease" data-id="${productId}" aria-label="Decrease quantity">&minus;</button>
                <span class="qty-value">${qty}</span>
                <button type="button" class="qty-increase" data-id="${productId}" aria-label="Increase quantity"${atMax ? " disabled" : ""}>+</button>
            </div>
        `;
    }

    // no stock -> disable the Add Cart button
    if (hasStockInfo && stock <= 0) {
        return `<button type="button" class="add-cart-btn" data-id="${productId}" disabled>Out Of Stock</button>`;
    }

    return `<button type="button" class="add-cart-btn" data-id="${productId}">Add Cart</button>`;
}

// re-render every cart control on the page that matches this product
function refreshCartControls(productId) {
    const controls =
        document.querySelectorAll(
            `.cart-control[data-id="${productId}"]`
        );

    controls.forEach((control) => {
        control.innerHTML =
            buildCartControlHTML(productId);
    });
}

// adjust the quantity of an item already in the cart
function changeCartQty(productId, delta) {
    const cart = AppUtils.getCart();

    const index =
        cart.findIndex(
            (entry) =>
                String(entry.id)
                === String(productId)
        );

    // not in cart yet: a "+" with no item just adds it fresh
    if (index === -1) {
        if (delta > 0) {
            const product =
                getProductById(
                    productId,
                    window.allProducts || []
                );

            if (product) {
                addToCart(product);
            }
        }
        return;
    }

    let qty =
        (Number(cart[index].qty) || 0) + delta;

    // respect stock when increasing, if the item carries stock info
    const stock = Number(cart[index].stock);

    if (
        delta > 0
        &&
        stock
        &&
        qty > stock
    ) {
        AppUtils.notify(
            `Only ${stock} in stock`,
            "error"
        );
        return;
    }

    if (qty <= 0) {
        cart.splice(index, 1);
    } else {
        cart[index].qty = qty;
    }

    saveHomeCart(cart);
    refreshCartControls(productId);
}

// add to wishlist
async function toggleWishlist(
    product
) {
    if (
        !product
        ||
        !product.id
    ) {
        return;
    }

    // wishlist is account-bound: guests must sign in first
    if (!AppUtils.requireLogin("Please sign in to use your wishlist")) {
        return;
    }

    let wishlist = AppUtils.getWishlist();

    const exists =
        wishlist.some(
            (item) =>
                String(item.id)
                === String(product.id)
        );

    const user = AppUtils.getUser();

    if (
        exists
    ) {
        wishlist =
            wishlist.filter(
                (item) =>
                    String(item.id)
                    !== String(product.id)
            );

        AppUtils.notify(
            "Removed from wishlist",
            "info"
        );
        
        if (user) {
            try {
                await AppUtils.apiRequest("/wishlist/remove", {
                    method: "POST",
                    body: JSON.stringify({ productId: product.id })
                });
            } catch (e) {
                console.error("Failed to remove from wishlist backend:", e);
            }
        }
    } else {
        wishlist.push(
            product
        );

        AppUtils.notify(
            "Added to wishlist",
            "success"
        );
        
        if (user) {
            try {
                await AppUtils.apiRequest("/wishlist/add", {
                    method: "POST",
                    body: JSON.stringify({ productId: product.id })
                });
            } catch (e) {
                console.error("Failed to add to wishlist backend:", e);
            }
        }
    }

    // saveWishlist persists locally and syncs the whole list to the backend
    saveHomeWishlist(wishlist);

    // Update DOM icons dynamically
    const buttons = document.querySelectorAll(`.wishlist-btn[data-id="${product.id}"], .wishlist-btn-shop[data-id="${product.id}"]`);
    buttons.forEach(btn => {
        const icon = btn.querySelector("i");
        if (icon) {
            if (exists) {
                icon.classList.remove("fas");
                icon.classList.add("far");
            } else {
                icon.classList.remove("far");
                icon.classList.add("fas");
            }
        }
    });
}

// get product by id
function getProductById(
    id,
    products = []
) {
    return products.find(
        (product) =>
            String(product.id)
            === String(id)
    );
}

// action delegation
document.addEventListener(
    "click",
    (event) => {
        const addCartBtn =
            event.target.closest(
                ".add-cart-btn"
            );

        const qtyIncreaseBtn =
            event.target.closest(
                ".qty-increase"
            );

        const qtyDecreaseBtn =
            event.target.closest(
                ".qty-decrease"
            );

        const wishlistBtn =
            event.target.closest(
                ".wishlist-btn"
            );

        // quantity increase
        if (qtyIncreaseBtn) {
            event.preventDefault();
            changeCartQty(qtyIncreaseBtn.dataset.id, 1);
            return;
        }

        // quantity decrease
        if (qtyDecreaseBtn) {
            event.preventDefault();
            changeCartQty(qtyDecreaseBtn.dataset.id, -1);
            return;
        }

        const viewBtn =
            event.target.closest(
                ".view-product-btn"
            );

        // add cart
        if (
            addCartBtn
        ) {
            event.preventDefault();

            const id =
                addCartBtn.dataset.id;

            if (
                !id
            ) {
                return;
            }

            const product =
                getProductById(
                    id,
                    window.allProducts || []
                );

            if (
                product
            ) {
                addToCart(
                    product
                );
            }
        }

        // wishlist
        if (
            wishlistBtn
        ) {
            event.preventDefault();

            const id =
                wishlistBtn.dataset.id;

            if (
                !id
            ) {
                return;
            }

            const product =
                getProductById(
                    id,
                    window.allProducts || []
                );

            if (
                product
            ) {
                toggleWishlist(
                    product
                );
            }
        }

        // product page
        if (
            viewBtn
        ) {
            event.preventDefault();

            const id =
                viewBtn.dataset.id;

            if (
                !id
            ) {
                return;
            }

            window.location.href =
                `product.html?id=${id}`;
        }
        const compareBtn =
    event.target.closest(".compare-btn");

if (compareBtn) {

    event.preventDefault();

    const id = compareBtn.dataset.id;

    let compareProducts =
    AppUtils.getJSON(
        "compareProducts",
        []
    );
    if (compareProducts.includes(id)) {
    AppUtils.notify(
        "Product already selected",
        "info"
    );
    return;
}
    if (compareProducts.length >= 3) {
    AppUtils.notify(
        "You can compare up to 3 products only",
        "warning"
    );
    return;
}

    compareProducts.push(id);

    AppUtils.setJSON(
    "compareProducts",
    compareProducts
);

   AppUtils.notify(
    "Added for comparison",
    "success"
);
}

        // card click -> product detail page
        // (ignore clicks on the action buttons / links inside the card)
        const productCard =
            event.target.closest(
                ".pro[data-id]"
            );

        if (
            productCard
            &&
            !event.target.closest(
                "button, a"
            )
        ) {
            window.location.href =
                `product.html?id=${productCard.dataset.id}`;
        }
    }
);

// expose globally
window.addToCart =
    addToCart;

window.toggleWishlist =
    toggleWishlist;

window.buildCartControlHTML =
    buildCartControlHTML;

window.refreshCartControls =
    refreshCartControls;

window.changeCartQty =
    changeCartQty;
})()