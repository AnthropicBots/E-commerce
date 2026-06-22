try {
// wishlist state
let wishlist =
    AppUtils.getWishlist();
let cart =
    AppUtils.getCart();

// elements
const elements = {
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
    const wishlistContainer = document.getElementById("wishlist-container");
    const emptyWishlist = document.getElementById("empty-wishlist");

    if (
        !wishlistContainer
    ) {
        return;
    }
    wishlistContainer.innerHTML =
        "";
    
    // Clean up any corrupted data
    if (Array.isArray(wishlist)) {
        wishlist = wishlist.filter(product => product && typeof product === 'object');
        AppUtils.saveWishlist(wishlist);
    }

    if (
        !Array.isArray(wishlist)
        ||
        wishlist.length === 0
    ) {
        if (
            emptyWishlist
        ) {
            emptyWishlist.style.display =
                "block";
        }
        return;
    }
    
    if (emptyWishlist) {
        emptyWishlist.style.display = "none";
    }

    if (
        emptyWishlist
    ) {
        emptyWishlist.style.display =
            "none";
    }
    const fragment =
        document.createDocumentFragment();

    wishlist.forEach(
        (product, index) => {
            if (!product) return;
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
                        src="${AppUtils.defaultImage(product?.image || product?.img)}"
                        alt="${product?.name || "Product"}"
                        loading="lazy"
                    >
                    <div class="wishlist-content">
                        <span>
                            ${product?.brand || "Brand"}
                        </span>
                        <h4>
                            ${product?.name || "Product"}
                        </h4>
                        <p class="wishlist-price">
                            ${AppUtils.formatPrice(product?.price || 0)}
                        </p>
                        <div class="wishlist-buttons">
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
                                product?.id
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
    wishlistContainer.appendChild(
        fragment
    );
    attachWishlistEventListeners();
}

// wishlist listeners
function attachWishlistEventListeners() {
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

    // saveWishlist persists locally and syncs the whole list to the backend
    AppUtils.saveWishlist(
        wishlist
    );

    renderWishlist();
    AppUtils.notify(
        "Removed from wishlist",
        "success"
    );

    const user =
        AppUtils.getUser();

    if (
        user
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

    const user =
        AppUtils.getUser();

    if (
        user
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
    
    // Remove from wishlist
    await removeWishlist(index);
}

// init
async function initWishlist() {
    const user = AppUtils.getUser();
    if (user) {
        try {
            const response = await AppUtils.apiRequest("/wishlist");
            if (response.success && response.wishlist) {
                wishlist = response.wishlist;
                AppUtils.saveWishlist(wishlist);
            }
        } catch (error) {
            console.error("Failed to fetch wishlist:", error);
        }
    }
    renderWishlist();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWishlist);
} else {
    initWishlist();
}

} catch (err) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'position:fixed;top:10%;left:50%;transform:translate(-50%,0);background:yellow;color:black;padding:20px;z-index:99999;font-size:20px;width:80%;word-wrap:break-word;';
    errorDiv.innerText = 'TOP LEVEL ERROR: ' + err.toString() + '\n' + err.stack;
    document.addEventListener("DOMContentLoaded", () => {
        document.body.appendChild(errorDiv);
    });
}