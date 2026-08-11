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

function getProductReviewCount(
    product
) {

    return Number(
        product?.num_reviews
        ?? product?.numReviews
        ?? product?.reviewCount
        ?? 0
    );
}

function formatRatingText(
    rating,
    count
) {

    if (
        !count
    ) {

        return "No reviews yet";
    }

    return `${safeNumber(rating, 0).toFixed(1)} (${count} review${count === 1 ? "" : "s"})`;
}

// create product card html
function createProductCardHTML(
    product
) {

    return `
        <div class="product-image-wrapper">

            <img
    src="${escapeHTML(product.image)}"
    alt="${escapeHTML(product.name || 'Product image')}"
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
                <span class="rating-count">
                    ${
                        escapeHTML(
                            formatRatingText(
                                product.rating || 0,
                                getProductReviewCount(
                                    product
                                )
                            )
                        )
                    }
                </span>
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
            0
        );

    const reviewCount =
        getProductReviewCount(
            product
        );

    ratingContainer.innerHTML =
        `
            ${
                renderStars(
                    rating
                )
            }

            <span id="product-rating-text">
                ${
                    escapeHTML(
                        formatRatingText(
                            rating,
                            reviewCount
                        )
                    )
                }
            </span>
        `;
}

// recently viewed
//
// This wrote the `recentlyViewed` key directly, deduplicating with
// `Number(item.id) !== Number(product.id)` -- and `products.id` is a CHAR(36)
// UUID, so `Number(uuid)` is NaN, `NaN !== NaN` is true, and the filter
// removed nothing for any product, ever (#1497). It also capped at 8 while
// product.js capped the same key at 10 in the same page load.
//
// Both are window.RecentlyViewed's business now, and it is the only writer.
function updateRecentlyViewed(
    product
) {

    if (
        !product
        || !window.RecentlyViewed
    ) {
        return;
    }

    window.RecentlyViewed.record(
        product
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
                if (window.AppUtils && typeof window.AppUtils.handleImageError === "function") {
                    window.AppUtils.handleImageError(window.mainImage);
                }
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

    // `updateRecentlyViewed(product)` was called here. Recording a view is not
    // rendering, and this was the third write of the same product to the same
    // key in one page load (#1497) -- product.js already records it when the
    // product is fetched, which is where the view actually happens.
    //
    // The function is kept and still exported: it delegates to the store now,
    // so an external caller that has always had `window.updateRecentlyViewed`
    // keeps working and gets the deduplicated behaviour.
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
