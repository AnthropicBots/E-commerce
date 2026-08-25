(function(){
// cart storage
let cart =
    AppUtils.getCart();

// wishlist storage
let wishlist =
    AppUtils.getWishlist();

// refresh shared cart count
function refreshHomeCartCount() {
    if (
        typeof updateCartCount ===
        "function"
    ) {
        updateCartCount();
    }
}

// save wishlist
function saveHomeWishlist() {
    AppUtils.saveWishlist(
        wishlist
    );
}

// add to cart
async function addToCart(
    product
) {
    if (
        !product
        ||
        !product.id
    ) {
        return;
    }

    // Captured before awaiting: window.event only means anything while the
    // click is still on the stack.
    const feedbackBtn =
        (
            window.event
            &&
            window.event.target
        )
            ? window.event.target.closest('.add-cart-btn')
            : null;

    const countBefore =
        AppUtils.getCartCount();

    cart =
        await AppUtils.addCartItem({
            ...product,
            qty: 1
        });

    refreshHomeCartCount();

    // A refused add has already told the shopper why.
    if (
        AppUtils.getCartCount(cart)
        <=
        countBefore
    ) {
        return;
    }

    if (
        typeof renderCartDrawer ===
        "function"
    ) {
        renderCartDrawer();
    }

    if (
        typeof openCartDrawer ===
        "function"
    ) {
        openCartDrawer();
    }

    AppUtils.notify(
        `${product.name} added to cart`,
        "success"
    );

    if (feedbackBtn) {
        feedbackBtn.classList.add('added-feedback');
        const originalText = feedbackBtn.innerHTML;
        feedbackBtn.innerHTML = '<i class="fas fa-check"></i> Added';
        setTimeout(() => {
            feedbackBtn.classList.remove('added-feedback');
            feedbackBtn.innerHTML = originalText;
        }, 2000);
    }
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

    const exists =
        wishlist.some(
            (item) =>
                String(item.id)
                === String(product.id)
        );

    const token = AppUtils.getToken();

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
        
        if (token) {
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
            "Added to wishlist ❤️",
            "success"
        );
        
        if (token) {
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
    saveHomeWishlist();

    // Update DOM icons dynamically
    const buttons = document.querySelectorAll(`.wishlist-btn[data-id="${product.id}"], .wishlist-btn-shop[data-id="${product.id}"]`);
    buttons.forEach(btn => {
        const icon = btn.querySelector("i");
        if (icon) {
            if (exists) {
                icon.classList.remove("fas");
                icon.classList.add("far");
                btn.classList.remove("wishlisted-feedback");
            } else {
                icon.classList.remove("far");
                icon.classList.add("fas");
                btn.classList.add("wishlisted-feedback");
                setTimeout(() => btn.classList.remove("wishlisted-feedback"), 800);
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

        const wishlistBtn =
            event.target.closest(
                ".wishlist-btn"
            );

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
                ).catch(
                    (error) => {
                        console.error(
                            "ADD TO CART ERROR:",
                            error
                        );
                    }
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
            viewBtn && !event.target.closest('.quick-view-btn')
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
        
        // Quick view
        const quickViewBtn = event.target.closest(".quick-view-btn");
        if (quickViewBtn) {
            event.preventDefault();
            event.stopPropagation();
            
            const id = quickViewBtn.dataset.id;
            if (id) {
                // In a real app, this would open a modal.
                // For now, we can redirect or show a toast if modal isn't implemented.
                window.location.href = `product.html?id=${id}`;
            }
        }
        
        const compareBtn =
    event.target.closest(".compare-btn");

if (compareBtn) {
    event.preventDefault();
    const id = compareBtn.dataset.id;
    if (id) {
        if (typeof AppUtils !== "undefined" && typeof AppUtils.addToCompare === "function") {
            AppUtils.addToCompare(id);
        } else if (typeof addToCompare === "function") {
            addToCompare(id);
        }
    }
}
    }
);

// expose globally
window.addToCart =
    addToCart;

window.toggleWishlist =
    toggleWishlist;
})()
