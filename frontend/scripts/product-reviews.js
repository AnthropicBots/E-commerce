(() => {
  let productReviews = [];
  // render stars HTML for a given rating
  function renderStars(rating) {
    let stars = '';
    for (let i = 1; i <= 5; i++) {
        stars += i <= rating
            ? '<i class="fas fa-star" style="color: gold;"></i>'
            : '<i class="far fa-star" style="color: #ccc;"></i>';
    }
    return stars;
}
  let activeProductId = null;
  let selectedRating = 0;

  const reviewForm = document.getElementById("review-form");
  const reviewContainer = document.getElementById("reviews-container");
  const reviewSummary = document.getElementById("reviews-summary");
  const reviewRatingInput = document.getElementById("review-rating");
  const reviewMessageInput = document.getElementById("review-message");
  const starButtons = Array.from(
    document.querySelectorAll(".review-star-input button"),
  );



  function getCurrentUser() {
    return AppUtils.getUser ? AppUtils.getUser() : null;
  }

  function isCurrentUserAdmin() {
    return getCurrentUser()?.role === "admin";
  }

  function formatReviewDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function updateRatingDisplay(averageRating = 0, reviewCount = 0) {
    const rating = Number(averageRating || 0);
    const count = Number(reviewCount || 0);
    const currentProduct = window.currentProductData;

    if (currentProduct) {
      currentProduct.rating = rating;
      currentProduct.num_reviews = count;
    }

    if (typeof window.renderProductRating === "function" && currentProduct) {
      window.renderProductRating(currentProduct);
    }

    if (reviewSummary) {
      reviewSummary.textContent = count
        ? `${rating.toFixed(1)} average rating from ${count} review${count === 1 ? "" : "s"}`
        : "No reviews yet. Be the first to review this product.";
    }
  }

  function renderStars(rating = 0) {
    const safeRating = Math.max(
      0,
      Math.min(5, Math.round(Number(rating) || 0)),
    );

    return Array.from({ length: 5 }, (_, index) => {
      const className = index < safeRating ? "fas fa-star" : "far fa-star";
      return `<i class="${className}" aria-hidden="true"></i>`;
    }).join("");
  }

  function setSelectedRating(value) {
    selectedRating = Math.max(0, Math.min(5, Number(value) || 0));

    if (reviewRatingInput) {
      reviewRatingInput.value = selectedRating ? String(selectedRating) : "";
    }

    starButtons.forEach((button) => {
      const rating = Number(button.dataset.rating);
      const isActive = rating <= selectedRating;
      const icon = button.querySelector("i");

      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(rating === selectedRating));

      if (icon) {
        icon.className = isActive ? "fas fa-star" : "far fa-star";
      }
    });
  }

  function createReviewCard(review) {
    const canDelete = isCurrentUserAdmin();
    const reviewId = Number(review.id);

    return `
            <article class="review-box" data-review-id="${reviewId}">
                <header class="review-header">
                    <div>
                        <h4>${AppUtils.escapeHTML(review.userName || "Customer")}</h4>
                        <div class="review-stars" aria-label="${Number(review.rating) || 0} out of 5 stars">
                            ${renderStars(review.rating)}
                        </div>
                    </div>

                    ${
                      canDelete && reviewId
                        ? `<button
                                type="button"
                                class="review-delete-btn"
                                data-review-id="${reviewId}"
                                aria-label="Delete review by ${AppUtils.escapeHTML(review.userName || "customer")}"
                            >
                                Delete
                            </button>`
                        : ""
                    }
                </header>

                <p class="review-message">${AppUtils.escapeHTML(review.comment)}</p>

                <time class="review-date" datetime="${AppUtils.escapeHTML(review.createdAt || "")}">
                    ${formatReviewDate(review.createdAt)}
                </time>
            </article>
        `;
  }

  function renderReviews() {
    if (!reviewContainer) {
      return;
    }

    if (!productReviews.length) {
      reviewContainer.innerHTML = `
                <p class="empty-review-text">
                    No reviews yet
                </p>
            `;

      return;
    }

    reviewContainer.innerHTML = productReviews.map(createReviewCard).join("");
  }

  async function loadProductReviews(productId) {
    if (!productId) {
      const urlParams = new URLSearchParams(window.location.search);
      productId = urlParams.get("id");
    }
    activeProductId = Number(productId);

    if (!activeProductId || !reviewContainer) {
      return;
    }

    reviewContainer.innerHTML = `
            <p class="empty-review-text">
                Loading reviews...
            </p>
        `;

    try {
      const response = await AppUtils.apiRequest(
        `/products/${activeProductId}/reviews`,
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to load reviews");
      }

      productReviews = AppUtils.safeArray(response.reviews);
      updateRatingDisplay(response.averageRating, response.reviewCount);
      renderReviews();
    } catch (error) {
      console.error("LOAD REVIEWS ERROR:", error);
      productReviews = [];
      reviewContainer.innerHTML = `
                <p class="empty-review-text">
                    Reviews could not be loaded right now.
                </p>
            `;
    }
  }

  async function submitReview(event) {
    event.preventDefault();

    if (!activeProductId) {
      const urlParams = new URLSearchParams(window.location.search);
      activeProductId = Number(urlParams.get("id"));
    }

    if (!activeProductId || Number.isNaN(activeProductId)) {
      AppUtils.notify("Product unavailable", "error");
      return;
    }

    const user = AppUtils.requireAuth();

    if (!user) {
      return;
    }

    const rating = Number(reviewRatingInput?.value || 0);
    const comment = reviewMessageInput?.value.trim() || "";

    if (rating < 1 || rating > 5) {
      AppUtils.notify("Choose a rating from 1 to 5 stars", "error");
      return;
    }

    if (comment.length < 3 || comment.length > 1000) {
      AppUtils.notify(
        "Review comment must be between 3 and 1000 characters",
        "error",
      );
      return;
    }

    const submitButton = reviewForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
      const response = await AppUtils.apiRequest(
        `/products/${activeProductId}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            rating,
            comment,
          }),
        },
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to submit review");
      }

      AppUtils.notify("Review submitted successfully", "success");
      reviewForm.reset();
      setSelectedRating(0);
      await loadProductReviews(activeProductId);
    } catch (error) {
      console.error("SUBMIT REVIEW ERROR:", error);
      AppUtils.notify(error.message || "Failed to submit review", "error");
    } finally {
      submitButton.disabled = false;
    }
  }

  async function deleteReview(reviewId) {
    if (!activeProductId || !reviewId) {
      return;
    }

    const confirmed = window.confirm("Delete this review?");

    if (!confirmed) {
      return;
    }

    try {
      const response = await AppUtils.apiRequest(
        `/products/${activeProductId}/reviews/${reviewId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to delete review");
      }

      AppUtils.notify("Review deleted", "success");
      updateRatingDisplay(response.averageRating, response.reviewCount);
      await loadProductReviews(activeProductId);
    } catch (error) {
      console.error("DELETE REVIEW ERROR:", error);
      AppUtils.notify(error.message || "Failed to delete review", "error");
    }
  }

  starButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedRating(button.dataset.rating);
    });

    button.addEventListener("mouseenter", () => {
      const hoverRating = Number(button.dataset.rating);

      starButtons.forEach((current) => {
        const icon = current.querySelector("i");
        const isActive = Number(current.dataset.rating) <= hoverRating;

        if (icon) {
          icon.className = isActive ? "fas fa-star" : "far fa-star";
        }
      });
    });
  });

  const starInput = document.querySelector(".review-star-input");

  starInput?.addEventListener("mouseleave", () => {
    setSelectedRating(selectedRating);
  });

  reviewForm?.addEventListener("submit", submitReview);

  reviewContainer?.addEventListener("click", (event) => {
    const deleteButton = event.target.closest(".review-delete-btn");

    if (deleteButton) {
      deleteReview(Number(deleteButton.dataset.reviewId));
    }
  });

  window.loadProductReviews = loadProductReviews;
  window.renderReviews = renderReviews;
})();
