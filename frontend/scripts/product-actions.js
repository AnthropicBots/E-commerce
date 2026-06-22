// product action state
let currentProduct =
    null;

// set current product
function setCurrentProduct(
    product
) {
    currentProduct =
        product || null;
        
    if (currentProduct) {
        const wishlistBtn = document.getElementById("wishlist-btn");
        if (wishlistBtn) {
            const icon = wishlistBtn.querySelector("i");
            if (icon) {
                const exists = AppUtils.getWishlist().some(item => String(item.id) === String(currentProduct.id));
                if (exists) {
                    icon.classList.remove("far");
                    icon.classList.add("fas");
                } else {
                    icon.classList.remove("fas");
                    icon.classList.add("far");
                }
            }
        }
    }
}

// get quantity
function getSelectedQuantity() {
    const qtyInput =
        document.getElementById(
            "product-qty"
        );

    if (
        !qtyInput
    ) {
        return 1;
    }

    const qty =
        parseInt(
            qtyInput.value,
            10
        );

    return isNaN(qty)
        ? 1
        : Math.max(
            1,
            qty
        );
}

// validate stock
function validateStock(
    qty
) {
    if (
        !currentProduct
    ) {
        return false;
    }

    const stock =
        parseInt(
            currentProduct.stock,
            10
        ) || 0;

    if (
        stock <= 0
    ) {

        AppUtils.notify(
            "Product out of stock",
            "error"
        );

        return false;
    }

    if (
        qty > stock
    ) {
        AppUtils.notify(
            `Only ${stock} item(s) available`,
            "error"
        );
        return false;
    }
    return true;
}

// build cart product
function buildCartProduct() {

    if (
        !currentProduct
    ) {
        return null;
    }

    const qty =
        getSelectedQuantity();

    if (
        !validateStock(
            qty
        )
    ) {
        return null;
    }

    return {
        id:
            currentProduct.id,

        name:
            currentProduct.name,

        price:
            parseFloat(
                currentProduct.price
            ) || 0,

        image:
            currentProduct.image,

        brand:
            currentProduct.brand,

        qty,

        color:
            window.selectedColor
            || "Default",

        size:
            window.selectedSize
            || "M"
    };
}

// add to cart
function addProductToCart() {
    // cart is account-bound: guests must sign in first
    if (!AppUtils.requireLogin("Please sign in to add items to your cart")) {
        return;
    }

    const product =
        buildCartProduct();

    if (
        !product
    ) {

        AppUtils.notify(
            "Product unavailable",
            "error"
        );
        return;
    }

    const cart =
        AppUtils.getCart();

    const existing =
        cart.find(
            (item) => {
                return (
                    String(item.id)
                    ===
                    String(product.id)
                    &&
                    item.color
                    ===
                    product.color
                    &&
                    item.size
                    ===
                    product.size
                );
            }
        );

    if (
        existing
    ) {
        const updatedQty =
            existing.qty +
            product.qty;

        if (
            !validateStock(
                updatedQty
            )
        ) {
            return;
        }

        existing.qty =
            updatedQty;

    } else {
        cart.push(
            product
        );
    }

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

    if (window.Recommendations && typeof window.Recommendations.postInteraction === 'function') {
        window.Recommendations.postInteraction(product.id, "cart_add");
    }

    AppUtils.notify(
        "Added to cart",
        "success"
    );
}

// buy now
function buyNow() {
    addProductToCart();
    setTimeout(
        () => {
            window.location.href =
                "checkout.html";
        },
        500
    );
}

// wishlist
function toggleProductWishlist() {
    if (
        !currentProduct
    ) {
        return;
    }

    // wishlist is account-bound: guests must sign in first
    if (!AppUtils.requireLogin("Please sign in to use your wishlist")) {
        return;
    }

    let wishlist =
        AppUtils.getWishlist();

    const exists =
        wishlist.some(
            (item) =>
                String(item.id)
                ===
                String(
                    currentProduct.id
                )
        );

    const user = AppUtils.getUser();

    if (
        exists
    ) {
        wishlist =
            wishlist.filter(
                (item) =>

                    String(item.id)
                    !==
                    String(
                        currentProduct.id
                    )
            );

        AppUtils.notify(
            "Removed from wishlist",
            "info"
        );
        
        if (user) {
            try {
                await AppUtils.apiRequest("/wishlist/remove", {
                    method: "POST",
                    body: JSON.stringify({ productId: currentProduct.id })
                });
            } catch (e) {
                console.error("Failed to remove from wishlist backend:", e);
            }
        }

    } else {
        wishlist.push({
            id:
                currentProduct.id,

            name:
                currentProduct.name,

            price:
                currentProduct.price,

            image:
                currentProduct.image,

            brand:
                currentProduct.brand
        });

        AppUtils.notify(
            "Added to wishlist",
            "success"
        );
        
        if (user) {
            try {
                await AppUtils.apiRequest("/wishlist/add", {
                    method: "POST",
                    body: JSON.stringify({ productId: currentProduct.id })
                });
            } catch (e) {
                console.error("Failed to add to wishlist backend:", e);
            }
        }

        if (window.Recommendations && typeof window.Recommendations.postInteraction === 'function') {
            window.Recommendations.postInteraction(currentProduct.id, "wishlist_add");
        }
    }

    // saveWishlist persists locally and syncs the whole list to the backend
    AppUtils.saveWishlist(wishlist);
    
    // Update DOM icon
    const wishlistBtn = document.getElementById("wishlist-btn");
    if (wishlistBtn) {
        const icon = wishlistBtn.querySelector("i");
        if (icon) {
            if (exists) {
                icon.classList.remove("fas");
                icon.classList.add("far");
            } else {
                icon.classList.remove("far");
                icon.classList.add("fas");
            }
        }
    }
}

// action bindings
document.addEventListener(
    "DOMContentLoaded",
    () => {
        const addToCartBtn =
            document.getElementById(
                "add-to-cart-btn"
            );

        const buyNowBtn =
            document.getElementById(
                "buy-now-btn"
            );

        const wishlistBtn =
            document.getElementById(
                "wishlist-btn"
            );

        if (
            addToCartBtn
        ) {
            addToCartBtn.addEventListener(
                "click",
                (
                    event
                ) => {
                    event.preventDefault();
                    addProductToCart();
                }
            );
        }

        if (
            buyNowBtn
        ) {
            buyNowBtn.addEventListener(
                "click",
                (
                    event
                ) => {
                    event.preventDefault();

                    buyNow();
                }
            );
        }

        if (
            wishlistBtn
        ) {

            wishlistBtn.addEventListener(
                "click",
                (
                    event
                ) => {

                    event.preventDefault();

                    toggleProductWishlist();
                }
            );
        }
    }
);

// expose globally
window.setCurrentProduct =
    setCurrentProduct;

window.addProductToCart =
    addProductToCart;

window.buyNow =
    buyNow;

window.toggleProductWishlist =
    toggleProductWishlist;