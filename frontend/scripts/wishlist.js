// wishlist state
let wishlist =
    AppUtils.getWishlist();
let cart =
    AppUtils.getCart();

// elements
const wishlistElements = {
    wishlistContainer:
        document.getElementById(
            "wishlist-container"
        ),
    emptyWishlist:
        document.getElementById(
            "empty-wishlist"
        )
};

// render wishlist
function renderWishlist() {
    if (
        !wishlistElements.wishlistContainer
    ) {
        return;
    }
    wishlistElements.wishlistContainer.innerHTML =
        "";
    if (
        !Array.isArray(wishlist)
        ||
        wishlist.length === 0
    ) {
        if (
            wishlistElements.emptyWishlist
        ) {
            wishlistElements.emptyWishlist.style.display =
                "block";
        }
        return;
    }

    if (
        wishlistElements.emptyWishlist
    ) {
        wishlistElements.emptyWishlist.style.display =
            "none";
    }
    const fragment =
        document.createDocumentFragment();

    wishlist.forEach(
        (product, index) => {
            const card =
                document.createElement(
                    "div"
                );

            card.classList.add(
                "wishlist-card"
            );

            card.innerHTML =
                `
                    <img
                        src="${AppUtils.defaultImage(product.image || product.img)}"
                        alt="${product.name || "Product"}"
                        loading="lazy"
                    >
                    <div class="wishlist-content">
                        <span>
                            ${product.brand || "Brand"}
                        </span>
                        <h4>
                            ${product.name || "Product"}
                        </h4>
                        <p class="wishlist-price">
                            ${AppUtils.formatPrice(product.price || 0)}
                        </p>
                        <div class="wishlist-buttons">
                            <button
                                class="add-cart-btn"
                                data-index="${index}"
                            >
                                <i class="fas fa-shopping-cart"></i>
                                Add To Cart
                            </button>
                            <button
                                class="remove-btn"
                                data-index="${index}"
                            >
                                <i class="fas fa-trash-alt"></i>
                                Remove
                            </button>
                        </div>
                    </div>
                `;

            // product navigation
            const clickable =
                card.querySelectorAll(
                    "img, h4"
                );

            clickable.forEach(
                (element) => {
                    element.addEventListener(
                        "click",
                        () => {
                            if (
                                product.id
                            ) {
                                window.location.href =
                                    `product.html?id=${product.id}`;
                            }
                        }
                    );
                }
            );
            fragment.appendChild(
                card
            );
        }
    );
    wishlistElements.wishlistContainer.appendChild(
        fragment
    );
    attachWishlistEventListeners();
}

// wishlist listeners
function attachWishlistEventListeners() {
    document
        .querySelectorAll(
            ".add-cart-btn"
        )
        .forEach((btn) => {
            btn.addEventListener(
                "click",
                async (event) => {
                    event.stopPropagation();
                    const button =
                        event.target.closest(
                            "button"
                        );

                    if (
                        !button
                    ) {
                        return;
                    }

                    const index =
                        parseInt(
                            button.dataset.index,
                            10
                        );

                    await addToCartFromWishlist(
                        index
                    );
                }
            );
        });

    document
        .querySelectorAll(
            ".remove-btn"
        )
        .forEach((btn) => {
            btn.addEventListener(
                "click",
                async (event) => {
                    event.stopPropagation();
                    const button =
                        event.target.closest(
                            "button"
                        );

                    if (
                        !button
                    ) {
                        return;
                    }

                    const index =
                        parseInt(
                            button.dataset.index,
                            10
                        );

                    await removeWishlist(
                        index
                    );
                }
            );
        });
}

// remove wishlist item
async function removeWishlist(
    index
) {
    if (
        !wishlist[index]
    ) {
        return;
    }

    const product =
        wishlist[index];

    wishlist.splice(
        index,
        1
    );

    AppUtils.saveWishlist(
        wishlist
    );

    renderWishlist();
    AppUtils.notify(
        "Removed from wishlist",
        "success"
    );

    const token =
        AppUtils.getToken();

    if (
        token
    ) {
        try {
            await AppUtils.apiRequest(
                "/wishlist/remove",
                {
                    method: "POST",
                    body:
                        JSON.stringify({
                            productId:
                                product.id
                        })
                }
            );

        } catch (error) {
            console.error(
                "WISHLIST REMOVE ERROR:",
                error
            );
        }
    }
}

// add to cart
async function addToCartFromWishlist(
    index
) {
    if (
        !wishlist[index]
    ) {
        return;
    }

    const product =
        wishlist[index];

    const item = {
        id:
            product.id,
        name:
            product.name,
        price:
            parseFloat(
                product.price
            ) || 0,
        img:
            product.image ||
            product.img,
        qty: 1
    };

    // prevent duplicates
    const existingIndex =
        cart.findIndex(
            (p) =>
                p.id === item.id
        );

    if (
        existingIndex >= 0
    ) {
        cart[
            existingIndex
        ].qty += 1;

    } else {
        cart.push(
            item
        );
    }

    AppUtils.saveCart(
        cart
    );

    AppUtils.notify(
        "Added to cart 🛍️",
        "success"
    );

    const token =
        AppUtils.getToken();

    if (
        token
    ) {
        try {
            await AppUtils.apiRequest(
                "/cart/add",
                {
                    method: "POST",
                    body:
                        JSON.stringify(
                            item
                        )
                }
            );
        } catch (error) {
            console.error(
                "CART ADD ERROR:",
                error
            );
        }
    }
}

// init
document.addEventListener(
    "DOMContentLoaded",
    () => {
        renderWishlist();
    }
);