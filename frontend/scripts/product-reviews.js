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



  // Paging and ordering state for the public list.
  let reviewPage = 1;
  let reviewSort = "newest";

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

  function sanitizeUserText(text) {
    if (!text) return "";
    const str = String(text);
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
      return window.DOMPurify.sanitize(str, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
    }
    return typeof AppUtils !== "undefined" && AppUtils.escapeHTML 
      ? AppUtils.escapeHTML(str) 
      : str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function createReviewCard(review) {
    const canDelete = isCurrentUserAdmin();
    const reviewId = Number(review.id);
    const safeUserName = sanitizeUserText(review.userName || "Customer");
    const safeComment = sanitizeUserText(review.comment);
    const safeDate = sanitizeUserText(review.createdAt || "");
    const reviewImages = AppUtils.safeArray(review.images);
    const imagesHtml = reviewImages.length > 0
      ? `<div class="review-images">
          ${reviewImages.map((img) => `<img src="${AppUtils.escapeHTML(img)}" alt="Review photo" loading="lazy" class="review-img" onclick="window.open(this.src, '_blank')">`).join("")}
         </div>`
      : "";

    return `
            <article class="review-box" data-review-id="${reviewId}">
                <header class="review-header">
                    <div>
                        <h4>${safeUserName}</h4>
                        <div class="review-stars" aria-label="${Number(review.rating) || 0} out of 5 stars">
                            ${renderStars(review.rating)}
                        </div>
                        ${
                          review.isVerified
                            ? `<span class="review-verified-badge">
                            <i class="fas fa-check-circle" aria-hidden="true"></i>
                            Verified Purchase
                        </span>`
                            : ""
                        }
                    </div>

                    ${
                      canDelete && reviewId
                        ? `<button
                                type="button"
                                class="review-delete-btn"
                                data-review-id="${reviewId}"
                                aria-label="Delete review by ${safeUserName}"
                            >
                                Delete
                            </button>`
                        : ""
                    }
                </header>

                <p class="review-message">${safeComment}</p>

                ${imagesHtml}

                <time class="review-date" datetime="${safeDate}">
                    ${formatReviewDate(review.createdAt)}
                </time>

                ${renderReviewActions(review, reviewId)}
            </article>
        `;
  }

  /**
   * Helpful / report controls.
   *
   * `helpful_count` and `reported_count` were columns with no writer and no
   * reader, so a shopper had no way to say a review was useful and no way to
   * flag an abusive one (#1349).
   *
   * A shopper's own review gets neither control: voting for yourself is not
   * signal, and the backend refuses both anyway — this just avoids offering a
   * button that can only fail.
   */
  function renderReviewActions(review, reviewId) {
    if (!reviewId) return "";

    if (isOwnReview(review)) {
      return `
            <footer class="review-actions">
                <span class="review-own-note">Your review</span>
            </footer>
        `;
    }

    const votedClass = review.viewerHasVotedHelpful ? " is-active" : "";
    const helpfulCount = Number(review.helpfulCount) || 0;

    return `
            <footer class="review-actions">
                <button
                    type="button"
                    class="review-helpful-btn${votedClass}"
                    data-review-id="${reviewId}"
                    aria-pressed="${review.viewerHasVotedHelpful ? "true" : "false"}"
                >
                    <i class="far fa-thumbs-up" aria-hidden="true"></i>
                    Helpful${helpfulCount > 0 ? ` (${helpfulCount})` : ""}
                </button>

                ${
                  review.viewerHasReported
                    ? `<span class="review-reported-note">Reported</span>`
                    : `<button
                    type="button"
                    class="review-report-btn"
                    data-review-id="${reviewId}"
                >
                    Report
                </button>`
                }
            </footer>
        `;
  }

  /** Whether the signed-in shopper wrote this review. */
  function isOwnReview(review) {
    const user = getCurrentUser();
    return Boolean(user && review.userId && String(user.id) === String(review.userId));
  }

  /**
   * Rating histogram.
   *
   * "4.2 stars" from a hundred reviews and "4.2 stars" from two are the same
   * number and very different information. The endpoint returns the
   * distribution now, so show it.
   */
  function renderRatingBreakdown(distribution, total) {
    const container = document.getElementById("review-breakdown");
    if (!container || !distribution) return;

    if (!total) {
      container.innerHTML = "";
      return;
    }

    const rows = [5, 4, 3, 2, 1]
      .map((star) => {
        const count = Number(distribution[star]) || 0;
        const percent = total > 0 ? Math.round((count / total) * 100) : 0;

        return `
            <div class="rating-bar-row">
                <span class="rating-bar-label">${star} star</span>
                <span class="rating-bar-track">
                    <span class="rating-bar-fill" style="width: ${percent}%"></span>
                </span>
                <span class="rating-bar-count">${count}</span>
            </div>
        `;
      })
      .join("");

    container.innerHTML = `<div class="rating-bars">${rows}</div>`;
  }

  /**
   * Sort control and pager.
   *
   * The list was ordered strictly by recency and returned every review a
   * product had ever received in one unbounded response (#1349).
   */
  function renderReviewControls(pagination, sort) {
    const container = document.getElementById("review-controls");
    if (!container) return;

    if (!pagination || pagination.total === 0) {
      container.innerHTML = "";
      return;
    }

    const options = [
      ["newest", "Most recent"],
      ["helpful", "Most helpful"],
      ["highest", "Highest rated"],
      ["lowest", "Lowest rated"]
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}"${value === sort ? " selected" : ""}>${label}</option>`
      )
      .join("");

    container.innerHTML = `
        <div class="review-controls-bar">
            <label class="review-sort">
                <span>Sort by</span>
                <select id="review-sort-select">${options}</select>
            </label>
            <span class="review-count-note">
                ${pagination.total} review${pagination.total === 1 ? "" : "s"}
            </span>
        </div>
        ${
          pagination.pages > 1
            ? `<nav class="review-pager" aria-label="Review pages">
            <button type="button" data-page="${pagination.page - 1}" ${
              pagination.page <= 1 ? "disabled" : ""
            }>Previous</button>
            <span>Page ${pagination.page} of ${pagination.pages}</span>
            <button type="button" data-page="${pagination.page + 1}" ${
              pagination.page >= pagination.pages ? "disabled" : ""
            }>Next</button>
        </nav>`
            : ""
        }
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

  function checkCanReviewVisibility(productId) {
    if (!reviewForm) return;
    const canReviewList = AppUtils.getJSON("can-review", []);
    const strId = String(productId ?? "").trim();
    const hasBought = Array.isArray(canReviewList) && canReviewList.some(id => String(id).trim() === strId);
    
    const currentUser = getCurrentUser();
    let promptEl = document.getElementById("review-purchase-prompt");

    if (!currentUser) {
        reviewForm.style.display = "none";
        if (!promptEl) {
            promptEl = document.createElement("p");
            promptEl.id = "review-purchase-prompt";
            promptEl.className = "review-prompt-text";
            promptEl.style.color = "#777";
            promptEl.style.margin = "15px 0";
            reviewForm.parentNode.insertBefore(promptEl, reviewForm);
        }
        promptEl.textContent = "Please sign in and purchase this product to leave a review.";
        promptEl.style.display = "block";
    } else if (!hasBought && currentUser.role !== "admin") {
        reviewForm.style.display = "none";
        if (!promptEl) {
            promptEl = document.createElement("p");
            promptEl.id = "review-purchase-prompt";
            promptEl.className = "review-prompt-text";
            promptEl.style.color = "#777";
            promptEl.style.margin = "15px 0";
            reviewForm.parentNode.insertBefore(promptEl, reviewForm);
        }
        promptEl.textContent = "Only verified purchasers of this item can leave a review.";
        promptEl.style.display = "block";
    } else {
        reviewForm.style.display = "block";
        if (promptEl) promptEl.style.display = "none";
    }
  }

  async function loadProductReviews(productId) {
    if (!productId) {
      const urlParams = new URLSearchParams(window.location.search);
      productId = urlParams.get("id");
    }
    activeProductId = productId;

    if (!activeProductId || !reviewContainer) {
      return;
    }

    checkCanReviewVisibility(activeProductId);

    reviewContainer.innerHTML = `
            <p class="empty-review-text">
                Loading reviews...
            </p>
        `;

    try {
      const query = new URLSearchParams({
        page: String(reviewPage),
        sort: reviewSort
      });

      const response = await AppUtils.apiRequest(
        `/products/${activeProductId}/reviews?${query.toString()}`,
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to load reviews");
      }

      productReviews = AppUtils.safeArray(response.reviews);
      updateRatingDisplay(response.averageRating, response.reviewCount);
      renderRatingBreakdown(response.ratingDistribution, response.reviewCount);
      renderReviewControls(response.pagination, response.sort || reviewSort);
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
    let rawComment = reviewMessageInput?.value.trim() || "";
    const comment = sanitizeUserText(rawComment);

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
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await AppUtils.apiRequest(
        `/products/${activeProductId}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            rating,
            comment,
            images: selectedReviewImages
          }),
        },
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to submit review");
      }

      AppUtils.notify("Review submitted successfully", "success");
      reviewForm.reset();
      selectedReviewImages = [];
      renderImagePreviews();
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

  const reviewImagesInput = document.getElementById("review-images");
  const reviewImagesPreview = document.getElementById("review-images-preview");
  let selectedReviewImages = [];

  function renderImagePreviews() {
    if (!reviewImagesPreview) return;
    if (!selectedReviewImages.length) {
      reviewImagesPreview.innerHTML = "";
      return;
    }

    reviewImagesPreview.innerHTML = selectedReviewImages
      .map(
        (src, index) => `
        <div class="review-preview-thumb">
          <img src="${AppUtils.escapeHTML(src)}" alt="Preview ${index + 1}">
          <button type="button" class="remove-thumb-btn" data-index="${index}" title="Remove photo">&times;</button>
        </div>
      `
      )
      .join("");
  }

  if (reviewImagesPreview) {
    reviewImagesPreview.addEventListener("click", (e) => {
      const removeBtn = e.target.closest(".remove-thumb-btn");
      if (removeBtn) {
        const idx = Number(removeBtn.dataset.index);
        selectedReviewImages.splice(idx, 1);
        renderImagePreviews();
      }
    });
  }

  if (reviewImagesInput) {
    reviewImagesInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      if (selectedReviewImages.length + files.length > 5) {
        AppUtils.notify("You can attach up to 5 photos per review", "warning");
      }

      const remainingSlots = 5 - selectedReviewImages.length;
      const filesToRead = files.slice(0, remainingSlots);

      filesToRead.forEach((file) => {
        if (!file.type.startsWith("image/")) {
          AppUtils.notify(`File ${file.name} is not a valid image`, "error");
          return;
        }

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
          if (loadEvent.target?.result) {
            selectedReviewImages.push(loadEvent.target.result);
            renderImagePreviews();
          }
        };
        reader.onerror = () => {
          AppUtils.notify(`Failed to read file ${file.name}`, "error");
        };
        reader.readAsDataURL(file);
      });

      reviewImagesInput.value = "";
    });
  }

  reviewForm?.addEventListener("submit", submitReview);

  /**
   * Mark a review helpful, or withdraw the vote.
   *
   * Optimistic UI is deliberately avoided: the server is the only thing that
   * knows whether this user has already voted, and showing a count that the
   * next reload contradicts is worse than a brief wait.
   */
  async function toggleHelpful(reviewId, alreadyVoted) {
    if (!AppUtils.requireAuth()) return;

    try {
      const response = await AppUtils.apiRequest(
        `/products/${activeProductId}/reviews/${reviewId}/helpful`,
        { method: alreadyVoted ? "DELETE" : "POST" },
      );

      if (!response.success) {
        throw new Error(response.message || "Could not record your vote");
      }

      await loadProductReviews(activeProductId);
    } catch (error) {
      console.error("REVIEW HELPFUL ERROR:", error);
      AppUtils.notify(error.message || "Could not record your vote", "error");
    }
  }

  /**
   * The reasons a review may be reported.
   *
   * Fetched from the server, which owns the list, and cached for the page.
   * This used to be a hardcoded string inside the prompt below, which is
   * exactly the drift `GET /products/reviews/moderation/reasons` exists to
   * prevent — it was unreachable until #1493, so the copy was the only option.
   *
   * The hardcoded list stays as the fallback and nothing more: a shopper who
   * wants to report a review should not be stopped by one failed request.
   */
  const FALLBACK_REPORT_REASONS = [
    "spam",
    "offensive",
    "off_topic",
    "fake",
    "personal_info",
    "other",
  ];

  let reportReasonsCache = null;

  async function getReportReasons() {
    if (reportReasonsCache) return reportReasonsCache;

    try {
      const response = await AppUtils.apiRequest(
        "/products/reviews/moderation/reasons",
      );

      const reasons = AppUtils.safeArray(response?.reasons)
        .map((reason) =>
          typeof reason === "string" ? reason : reason?.value || reason?.id,
        )
        .filter(Boolean);

      reportReasonsCache = reasons.length ? reasons : FALLBACK_REPORT_REASONS;
    } catch (error) {
      console.error("REVIEW REPORT REASONS ERROR:", error);
      reportReasonsCache = FALLBACK_REPORT_REASONS;
    }

    return reportReasonsCache;
  }

  /**
   * Report a review.
   *
   * The confirmation names what reporting does — sends it to a moderator —
   * because a button labelled only "Report" reads to some shoppers as "delete
   * this", and the distinction matters.
   */
  async function reportReview(reviewId) {
    if (!AppUtils.requireAuth()) return;

    const reasons = await getReportReasons();

    const reason = window.prompt(
      "Why are you reporting this review?\n\n" +
        `${reasons.join(", ")}\n\n` +
        "It will be sent to a moderator to look at.",
      reasons[0],
    );

    if (reason === null) return;

    try {
      const response = await AppUtils.apiRequest(
        `/products/${activeProductId}/reviews/${reviewId}/report`,
        {
          method: "POST",
          body: JSON.stringify({ reason: sanitizeUserText(reason) }),
        },
      );

      if (!response.success) {
        throw new Error(response.message || "Could not report this review");
      }

      AppUtils.notify(response.message, "success");
      await loadProductReviews(activeProductId);
    } catch (error) {
      console.error("REPORT REVIEW ERROR:", error);
      AppUtils.notify(error.message || "Could not report this review", "error");
    }
  }

  reviewContainer?.addEventListener("click", (event) => {
    const deleteButton = event.target.closest(".review-delete-btn");

    if (deleteButton) {
      deleteReview(Number(deleteButton.dataset.reviewId));
      return;
    }

    const helpfulButton = event.target.closest(".review-helpful-btn");

    if (helpfulButton) {
      toggleHelpful(
        Number(helpfulButton.dataset.reviewId),
        helpfulButton.classList.contains("is-active"),
      );
      return;
    }

    const reportButton = event.target.closest(".review-report-btn");

    if (reportButton) {
      reportReview(Number(reportButton.dataset.reviewId));
    }
  });

  // Sorting and paging are delegated from a container that is re-rendered on
  // every load, so binding per-control would leak listeners.
  document
    .getElementById("review-controls")
    ?.addEventListener("change", (event) => {
      if (event.target.id !== "review-sort-select") return;

      reviewSort = event.target.value;
      reviewPage = 1;
      loadProductReviews(activeProductId);
    });

  document
    .getElementById("review-controls")
    ?.addEventListener("click", (event) => {
      const pageButton = event.target.closest("[data-page]");
      if (!pageButton || pageButton.disabled) return;

      const nextPage = Number(pageButton.dataset.page);
      if (!nextPage || nextPage < 1) return;

      reviewPage = nextPage;
      loadProductReviews(activeProductId);
    });

  window.loadProductReviews = loadProductReviews;
  window.renderReviews = renderReviews;
})();
