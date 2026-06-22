// escape html helper
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

// safe number
function safeNumber(
    value,
    fallback = 0
) {

    const parsed =
        Number(value);

    return Number.isFinite(
        parsed
    )
        ? parsed
        : fallback;
}

// render stars
function renderStars(
    rating = 0
) {

    let stars = "";

    const safeRating =
        Math.max(
            0,
            Math.min(
                5,
                Math.round(
                    safeNumber(
                        rating,
                        0
                    )
                )
            )
        );

    for (
        let index = 0;
        index < 5;
        index++
    ) {

        stars +=
            index < safeRating
                ? `
                    <i class="fas fa-star"></i>
                `
                : `
                    <i class="far fa-star"></i>
                `;
    }

    return stars;
}

// create product card html
function createProductCardHTML(
    product
) {

    return `
        <div class="product-image-wrapper">

            <img
                src="${
                    escapeHTML(
                        AppUtils.defaultImage(
                            product.image
                        )
                    )
                }"

                alt="${
                    escapeHTML(
                        product.name
                    )
                }"

                loading="lazy"
            >
        </div>

        <div class="des">

            <span>
                ${
                    escapeHTML(
                        product.brand
                        || "Fashion"
                    )
                }
            </span>

            <h5>
                ${
                    escapeHTML(
                        product.name
                    )
                }
            </h5>

            <div class="star">
                ${
                    renderStars(
                        product.rating || 4
                    )
                }
            </div>

            <h4>
                ${
                    AppUtils.formatPrice(
                        product.price || 0
                    )
                }
            </h4>
        </div>

        <div class="product-actions">

            <button
                type="button"

                class="add-cart-btn"

                data-id="${
                    encodeURIComponent(
                        product.id
                    )
                }"
            >
                Add Cart
            </button>
        </div>
    `;
}

// render product card
function renderProductCard(
    product,
    container
) {

    if (
        !product
        ||
        !container
    ) {

        return;
    }

    const card =
        document.createElement(
            "div"
        );

    card.classList.add(
        "pro"
    );

    card.dataset.productId =
        product.id;

    card.innerHTML =
        createProductCardHTML(
            product
        );

    container.appendChild(
        card
    );
}

// gallery
function renderProductGallery(
    product
) {

    if (
        !window.mainImage
    ) {

        return;
    }

    const galleryImages =
        AppUtils.safeArray(
            product.images
        ).length
            ? product.images
            : [product.image];

    window.mainImage.src =
        AppUtils.defaultImage(
            galleryImages[0]
        );

    const imageGroup =
        document.querySelector(
            ".small-image-group"
        );

    if (
        !imageGroup
    ) {

        return;
    }

    const thumbs =
        document.querySelectorAll(
            ".small-image"
        );

    // single image
    if (
        galleryImages.length <= 1
    ) {

        imageGroup.style.display =
            "none";

        return;
    }

    imageGroup.style.display =
        "flex";

    thumbs.forEach(
        (
            image,
            index
        ) => {

            image.src =
                AppUtils.defaultImage(
                    galleryImages[index]
                    || galleryImages[0]
                );

            image.loading =
                "lazy";

            image.onclick =
                () => {

                    window.mainImage.src =
                        AppUtils.defaultImage(
                            galleryImages[index]
                            || galleryImages[0]
                        );
                };
        }
    );
}

// rating
function renderProductRating(
    product
) {

    const ratingContainer =
        document.querySelector(
            ".product-rating"
        );

    if (
        !ratingContainer
    ) {

        return;
    }

    const rating =
        safeNumber(
            product.rating,
            4.5
        );

    ratingContainer.innerHTML =
        `
            ${
                renderStars(
                    rating
                )
            }

            <span id="product-rating-text">
                (
                    ${rating}
                    Ratings
                )
            </span>
        `;
}

// recently viewed
function updateRecentlyViewed(
    product
) {

    let viewed =
        AppUtils.getJSON(
            "recentlyViewed",
            []
        );

    viewed =
        AppUtils.safeArray(
            viewed
        ).filter(
            (
                item
            ) => {

                return (
                    Number(
                        item.id
                    ) !==
                    Number(
                        product.id
                    )
                );
            }
        );

    viewed.unshift({

        id:
            product.id,

        name:
            product.name,

        brand:
            product.brand,

        category:
            product.category,

        price:
            product.price,

        image:
            product.image
    });

    viewed =
        viewed.slice(
            0,
            8
        );

    AppUtils.setJSON(
        "recentlyViewed",
        viewed
    );
}

// main product render
function renderProduct(
    product
) {

    if (
        !product
    ) {

        return;
    }

    // category
    if (
        window.productCategory
    ) {

        window.productCategory.innerText =
            `Home / ${
                product.category
                || "Category"
            }`;
    }

    // name
    if (
        window.productName
    ) {

        window.productName.innerText =
            product.name
            || "Product";
    }

    // discounted price
    if (
        window.productPrice
    ) {

        const discountedPrice =
            safeNumber(
                product.price
            ) *
            (
                1 -
                (
                    safeNumber(
                        product.discount_percent
                    ) / 100
                )
            );

        window.productPrice.innerText =
            AppUtils.formatPrice(
                discountedPrice
            );
    }

    // original price
    if (
        window.productOriginalPrice
    ) {

        window.productOriginalPrice.innerText =
            AppUtils.formatPrice(
                product.original_price
                || product.price
            );
    }

    // discount
    if (
        window.productDiscount
    ) {

        window.productDiscount.innerText =
            `${
                safeNumber(
                    product.discount_percent
                )
            }% OFF`;
    }

    // brand
    if (
        window.productBrand
    ) {

        window.productBrand.innerText =
            product.brand
            || "Brand";
    }

    // description
    if (
        window.productDescription
    ) {

        window.productDescription.innerText =
            product.description
            || "Premium quality product.";
    }

    // stock
    if (
        window.productStock
    ) {

        window.productStock.innerText =
            safeNumber(
                product.stock
            ) > 0
                ? `${product.stock} Available`
                : "Out Of Stock";
    }

    // main image
    if (
        window.mainImage
    ) {

        window.mainImage.src =
            AppUtils.defaultImage(
                product.image
            );

        window.mainImage.alt =
            escapeHTML(
                product.name
                || "Product"
            );

        window.mainImage.loading =
            "eager";

        window.mainImage.onerror =
            () => {

                window.mainImage.src =
                    "/assets/images/f1.jpg";
            };
    }

    // page title
    document.title =
        `${
            escapeHTML(
                product.name
            )
        } | AnthropicBots E-Commerce`;

    renderProductGallery(
        product
    );

    renderProductRating(
        product
    );

    updateRecentlyViewed(
        product
    );
}



// expose globally
window.renderProduct =
    renderProduct;

window.renderProductCard =
    renderProductCard;

window.renderProductGallery =
    renderProductGallery;

window.renderProductRating =
    renderProductRating;

window.updateRecentlyViewed =
    updateRecentlyViewed;

    window.allProducts = window.allProducts || [];