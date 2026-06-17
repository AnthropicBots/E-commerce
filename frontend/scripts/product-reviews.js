// reviews state
let productReviews =
    [];

// review elements
const reviewForm =
    document.getElementById(
        "review-form"
    );

const reviewContainer =
    document.getElementById(
        "reviews-container"
    );

const reviewRatingInput =
    document.getElementById(
        "review-rating"
    );

// load reviews
function loadProductReviews(
    productId
) {
    const stored =
        AppUtils.getJSON(
            `reviews_${productId}`,
            []
        );

    productReviews =
        Array.isArray(
            stored
        )
            ? stored
            : [];

    renderReviews();
}

// save reviews
function saveProductReviews(
    productId
) {
    AppUtils.setJSON(
        `reviews_${productId}`,
        productReviews
    );
}

// render single review
function createReviewCard(
    review
) {
    return `
        <div class="review-card">
            <div class="review-header">
                <h4>
                    ${
                        AppUtils.escapeHTML(review.name)
                    }
                </h4>

                <div class="review-stars">
                    ${
                        renderStars(
                            review.rating
                        )
                    }
                </div>
            </div>

            <p class="review-message">
                ${
                    AppUtils.escapeHTML(review.message)
                }
            </p>

            <small class="review-date">
                ${
                    review.date
                }
            </small>
        </div>
    `;
}

// render reviews
function renderReviews() {
    if (
        !reviewContainer
    ) {
        return;
    }

    if (
        !productReviews.length
    ) {
        reviewContainer.innerHTML = `
            <p class="empty-review-text">
                No reviews yet
            </p>
        `;

        return;
    }

    reviewContainer.innerHTML =
        productReviews
            .map(
                createReviewCard
            )
            .join("");
}

// average rating
function getAverageRating() {
    if (
        !productReviews.length
    ) {
        return 0;
    }

    const total =
        productReviews.reduce(
            (
                sum,
                review
            ) => {
                return (
                    sum +
                    Number(
                        review.rating || 0
                    )
                );
            },
            0
        );

    return (
        total /
        productReviews.length
    ).toFixed(1);
}

// submit review
function submitReview(
    event
) {
    event.preventDefault();
    if (
        !window.currentProductData
    ) {
        notify(
            "Product unavailable",
            "error"
        );

        return;
    }

    const nameInput =
        document.getElementById(
            "review-name"
        );

    const messageInput =
        document.getElementById(
            "review-message"
        );

    const name =
        nameInput?.value.trim();

    const message =
        messageInput?.value.trim();

    const rating =
        parseInt(
            reviewRatingInput?.value
        ) || 5;

    if (
        !name ||
        !message
    ) {
        notify(
            "Please fill all review fields",
            "error"
        );
        return;
    }

    const review = {
        name,
        message,
        rating,
        date:
            new Date()
                .toLocaleDateString()
    };

    productReviews.unshift(
        review
    );

    saveProductReviews(
        window.currentProductData.id
    );

    renderReviews();
    notify(
        "Review submitted successfully",
        "success"
    );
    reviewForm.reset();
}

// star interaction
document
    .querySelectorAll(
        ".review-star-input i"
    )
    .forEach(
        (
            star,
            index
        ) => {
            star.addEventListener(
                "click",
                () => {
                    if (
                        reviewRatingInput
                    ) {
                        reviewRatingInput.value =
                            index + 1;
                    }

                    document
                        .querySelectorAll(
                            ".review-star-input i"
                        )
                        .forEach(
                            (
                                current,
                                currentIndex
                            ) => {
                                current.style.color =
                                    currentIndex <= index
                                        ? "gold"
                                        : "#ccc";
                            }
                        );
                }
            );
        }
    );

// form listener
if (
    reviewForm
) {
    reviewForm.addEventListener(
        "submit",
        submitReview
    );
}

// expose globally
window.loadProductReviews =
    loadProductReviews;

window.renderReviews =
    renderReviews;

window.getAverageRating =
    getAverageRating;