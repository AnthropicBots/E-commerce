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

    const existing =
        AppUtils.getCart().find(
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

    const nextQty =
        (
            existing
                ? existing.qty
                : 0
        ) + product.qty;

    if (
        !validateStock(
            nextQty
        )
    ) {
        return;
    }

    AppUtils.addCartItem(
        product
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

    if (
        typeof openCartDrawer ===
        "function"
    ) {

        openCartDrawer();
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
async function toggleProductWishlist() {
    if (
        !currentProduct
    ) {
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

    const token = AppUtils.getToken();

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
          "Added to wishlist ❤️",
            "success"
                        );
        
        if (token) {
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
            "Added to wishlist ❤️",
            "success"
        );
        
        if (token) {
            try {
                await AppUtils.apiRequest("/wishlist/add", {
                    method: "POST",
                    body: JSON.stringify({ productId: currentProduct.id })
                });
            } catch (e) {
                console.error("Failed to add to wishlist backend:", e);
            }
        }
    }

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

// =====================================
// SHARE FEATURE (WhatsApp + Copy Link)
// =====================================

// build the share text used by WhatsApp / clipboard
function buildProductShareText() {
    const productName =
        (currentProduct && currentProduct.name)
            ? currentProduct.name
            : (document.title || "Check out this product");

    const productUrl = window.location.href;

    return `Check out ${productName} on AnthropicBots E-Commerce: ${productUrl}`;
}

// share product on WhatsApp via https://wa.me/?text=
function shareOnWhatsApp() {
    const text = buildProductShareText();

    const whatsappUrl =
        `https://wa.me/?text=${encodeURIComponent(text)}`;

    // open in a new tab so the user keeps the product page open
    const win = window.open(whatsappUrl, "_blank", "noopener,noreferrer");

    if (!win) {
        // pop-up was blocked — fall back to navigation in same tab
        window.location.href = whatsappUrl;
    }

    if (typeof AppUtils !== "undefined" && AppUtils.notify) {
        AppUtils.notify("Opening WhatsApp...", "info");
    }
}

// copy current product URL to clipboard using navigator.clipboard
async function copyProductLink() {
    const url = window.location.href;

    // prefer the modern async Clipboard API
    if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
    ) {
        try {
            await navigator.clipboard.writeText(url);

            if (typeof AppUtils !== "undefined" && AppUtils.notify) {
                AppUtils.notify("Product link copied to clipboard!", "success");
            }
            return;
        } catch (err) {
            console.warn("Clipboard API failed, falling back to legacy copy:", err);
            // fall through to legacy method
        }
    }

    // legacy fallback for non-secure contexts / older browsers
    try {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);

        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);

        if (typeof AppUtils !== "undefined" && AppUtils.notify) {
            if (ok) {
                AppUtils.notify("Product link copied to clipboard!", "success");
            } else {
                AppUtils.notify("Could not copy link. Please copy manually.", "error");
            }
        }
    } catch (err) {
        console.error("Legacy copy failed:", err);
        if (typeof AppUtils !== "undefined" && AppUtils.notify) {
            AppUtils.notify("Could not copy link. Please copy manually.", "error");
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

        const whatsappShareBtn =
            document.getElementById(
                "whatsapp-share-btn"
            );

        const copyLinkBtn =
            document.getElementById(
                "copy-link-btn"
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

        if (whatsappShareBtn) {
            whatsappShareBtn.addEventListener(
                "click",
                (event) => {
                    event.preventDefault();
                    shareOnWhatsApp();
                }
            );
        }

        if (copyLinkBtn) {
            copyLinkBtn.addEventListener(
                "click",
                (event) => {
                    event.preventDefault();
                    copyProductLink();
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

window.shareOnWhatsApp =
    shareOnWhatsApp;

window.copyProductLink =
    copyProductLink;
