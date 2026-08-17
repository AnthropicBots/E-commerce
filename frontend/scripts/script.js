let allProducts = [];

const fallbackProducts = [
  {
    id: "fb1",
    name: "Classic Cotton Hoodie",
    category: "Hoodies",
    price: 29.99,
    image: "assets/images/f1.png",
    featured: 1,
    stock: 20,
    rating: 4.5,
  },
  {
    id: "fb2",
    name: "Summer Floral Tee",
    category: "T-Shirts",
    price: 19.99,
    image: "assets/images/f2.png",
    featured: 0,
    stock: 18,
    rating: 4.0,
  },
  {
    id: "fb3",
    name: "Sporty Windbreaker",
    category: "Jackets",
    price: 49.99,
    image: "assets/images/banner.png",
    featured: 0,
    stock: 15,
    rating: 4.2,
  },
  {
    id: "fb4",
    name: "Denim Jacket",
    category: "Jackets",
    price: 59.99,
    image: "assets/images/b7.jpg",
    featured: 1,
    stock: 12,
    rating: 4.7,
  },
];



let isLoading = false;

const featuredContainer = document.getElementById("featured-products");
const arrivalsContainer = document.getElementById("new-arrivals-container");

function renderLoadingState() {
  if (featuredContainer) {
    AppUtils.renderSkeletonState(featuredContainer, 4);
  }
  if (arrivalsContainer) {
    AppUtils.renderSkeletonState(arrivalsContainer, 4);
  }
}

async function fetchAllProducts() {
  if (isLoading) return;
  isLoading = true;

  renderLoadingState();

  try {
    const data = await AppUtils.apiRequest("/products?limit=50");

    if (data && data.success) {
      allProducts = AppUtils.safeArray(data.products);
    } else {
      allProducts = fallbackProducts.slice();
    }
  } catch (error) {
    console.error("PRODUCT FETCH ERROR:", error);
    allProducts = fallbackProducts.slice();
  }
  {
    window.allProducts = allProducts;
    renderHomepageProducts();
    isLoading = false;
  }
}

function renderHomepageProducts() {
  if (!AppUtils.safeArray(allProducts).length) {
    renderEmptyState();
    return;
  }

  if (featuredContainer) {
    const featuredProducts = allProducts.filter(
      (product) => Number(product.featured) === 1,
    );
    renderProducts(featuredContainer, featuredProducts.slice(0, 8));
  }

  if (arrivalsContainer) {
    const newArrivals = allProducts.filter(
      (product) => Number(product.featured) !== 1,
    );
    renderProducts(arrivalsContainer, newArrivals.slice(0, 8));
  }
}

function renderEmptyState() {
  const containers = [featuredContainer, arrivalsContainer];
  containers.forEach((container) => {
    if (container) {
      container.innerHTML = `
                <p class="empty-products">
                    No products available.
                </p>
            `;
    }
  });
}

function renderProducts(container, products = []) {
  if (!container) return;

  container.innerHTML = "";

  if (!AppUtils.safeArray(products).length) {
    container.innerHTML = `
            <p class="empty-products">
                No products available.
            </p>
        `;
    return;
  }

  const fragment = document.createDocumentFragment();
  const wishlistIds = new Set(AppUtils.getWishlist().map((item) => String(item.id)));

  AppUtils.safeArray(products).forEach((product) => {
    if (!product || !product.id) return;

    const card = document.createElement("div");
    card.innerHTML =
      typeof createProductCard === "function" ? createProductCard(product, wishlistIds) : "";

    const productElement = card.firstElementChild;
    if (productElement) {
      fragment.appendChild(productElement);
    }
  });

  container.appendChild(fragment);
  initializeProductCardFeatures();
}

function createQuickViewModal(imageSrc, imageAlt) {
  const modal = document.createElement("div");
  modal.className = "quick-view-modal";
  modal.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        padding: 20px;
    `;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  const box = document.createElement("div");
  box.style.cssText = `
        background: white;
        padding: 20px;
        border-radius: 12px;
        max-width: 420px;
        width: 100%;
        text-align: center;
        position: relative;
    `;

  const image = document.createElement("img");
  image.src =
    typeof AppUtils !== "undefined" && typeof AppUtils.escapeHTML === "function" ? AppUtils.escapeHTML(imageSrc) : imageSrc;
  image.alt =
    typeof AppUtils !== "undefined" && typeof AppUtils.escapeHTML === "function"
      ? AppUtils.escapeHTML(imageAlt || "Product Image")
      : imageAlt || "Product Image";
  image.style.cssText = `
        width: 100%;
        max-height: 450px;
        object-fit: contain;
    `;

  const closeButton = document.createElement("button");
  closeButton.innerHTML = "&times;";
  closeButton.setAttribute("aria-label", "Close modal");
  closeButton.style.cssText = `
        position: absolute;
        top: 10px;
        right: 14px;
        border: none;
        background: transparent;
        font-size: 28px;
        cursor: pointer;
    `;

  box.appendChild(closeButton);
  box.appendChild(image);
  modal.appendChild(box);

  return { modal, closeButton };
}

function initializeProductCardFeatures() {
  const productCards = document.querySelectorAll(".pro");

  AppUtils.safeArray([...productCards]).forEach((card) => {
    const img = card.querySelector("img");
    if (!img || img.dataset.modalBound) return;

    img.dataset.modalBound = "true";
    img.addEventListener("click", () => {
      const { modal, closeButton } = createQuickViewModal(img.src, img.alt);

      document.body.appendChild(modal);
      document.body.style.overflow = "hidden";

      function closeModal() {
        document.body.style.overflow = "";
        modal.remove();
        document.removeEventListener("keydown", handleEscape);
      }

      function handleEscape(event) {
        if (event.key === "Escape") {
          closeModal();
        }
      }

      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeModal();
        }
      });

      closeButton.addEventListener("click", closeModal);
      document.addEventListener("keydown", handleEscape);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (featuredContainer || arrivalsContainer) {
    fetchAllProducts();
  }

  // Homepage search bar
  const productSearch = document.getElementById("product-search"); if (productSearch) { productSearch.addEventListener("input", () => { const query = productSearch.value.trim().toLowerCase(); if (!query) { renderHomepageProducts(); return; } const filtered = allProducts.filter((p) => p.name?.toLowerCase().includes(query) || p.category?.toLowerCase().includes(query)); if (featuredContainer) { renderProducts(featuredContainer, filtered.slice(0, 8)); } }); }
});




// ===== NEWSLETTER =====
//
// The one handler for the newsletter form, covering all eight pages that carry
// it (#1459).
//
// There were three, and none of them sent the address anywhere:
//
//   this file    an 800ms fake delay, then localStorage.setItem(
//                "newsletter_subscribers", ...). The address never left the
//                browser, and "You're already subscribed!" meant "this browser
//                typed it before" -- clear site data and you were new again.
//
//   ui.js:290    a 1500ms setTimeout and a green tick reading "Thanks for
//                subscribing! Check your inbox." Nothing stored at all, for a
//                mail nothing in the repository could send.
//
//   blog.js:386  no delay, no storage, no request. Validate, clear the box,
//                claim success.
//
// Two of them were also bound to the same element: index.html's form matches
// both `#newsletter .form` and `#newsletter-form`, so one submit ran both and
// congratulated the visitor twice, 700ms apart, in two different UI idioms.
//
// The other two are deleted. This is the only one left, and it posts.

const NEWSLETTER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Report the outcome using whatever this page has to report it with.
 *
 * index.html has a `#newsletter-feedback` element under the form; the other
 * seven do not and get a toast instead. Handling both is what lets one handler
 * cover all eight pages without touching their markup.
 *
 * @param {HTMLElement|null} feedback
 * @param {string} message
 * @param {"success"|"error"} tone
 */
function showNewsletterFeedback(feedback, message, tone) {
  if (feedback) {
    feedback.style.display = "block";
    feedback.className =
      `newsletter-feedback-message newsletter-feedback-${tone}`;
    // textContent, not innerHTML: the server's message is the only thing
    // that goes in here today, but a form's own feedback element is not
    // where anyone should have to think about that.
    feedback.textContent = message;
    return;
  }

  if (typeof notify === "function") {
    notify(message, tone);
  }
}

/**
 * Bind the sign-up form wherever it appears on this page.
 */
function initNewsletterForms() {
  // Two selectors, because the markup is not consistent between pages:
  // index.html has `<form class="form" id="newsletter-form">`, and the rest
  // have `<form class="form">` inside `<section id="newsletter">`.
  //
  // A Set, because on index.html both selectors find the same element -- and
  // binding it twice is exactly the bug this replaces.
  const forms = new Set([
    ...document.querySelectorAll("#newsletter form"),
    ...document.querySelectorAll("#newsletter-form")
  ]);

  forms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const input =
        form.querySelector('input[type="email"]')
        || form.querySelector("input");
      const button = form.querySelector("button");
      const feedback = document.getElementById("newsletter-feedback");
      const email = (input?.value || "").trim();

      if (!email) {
        showNewsletterFeedback(
          feedback,
          "Please enter your email address.",
          "error"
        );
        input?.focus();
        return;
      }

      if (!NEWSLETTER_EMAIL_PATTERN.test(email)) {
        showNewsletterFeedback(
          feedback,
          "Please enter a valid email address.",
          "error"
        );
        input?.focus();
        return;
      }

      const originalLabel = button ? button.textContent : "";
      if (button) {
        button.textContent = "Subscribing...";
        button.disabled = true;
      }
      if (input) {
        input.disabled = true;
      }

      try {
        const response = await AppUtils.apiRequest(
          "/newsletter/subscribe",
          {
            method: "POST",
            body: JSON.stringify({
              email,
              // Part of the consent record: which page the
              // visitor was on when they signed up.
              source: window.location.pathname
            })
          }
        );

        // Branch on what the server said, not on "the await returned".
        // apiRequest resolves with { success: false } on a non-2xx
        // rather than rejecting, so treating arrival as success is how
        // the contact form used to report a 404 as a win (#1445).
        if (response && response.success) {
          showNewsletterFeedback(
            feedback,
            response.message
            || "Check your email for a link to confirm your subscription.",
            "success"
          );
          form.reset();
        } else {
          showNewsletterFeedback(
            feedback,
            (response && response.message)
            || "Something went wrong. Please try again.",
            "error"
          );
        }
      } catch (error) {
        console.error("NEWSLETTER SUBSCRIBE ERROR:", error);
        showNewsletterFeedback(
          feedback,
          "Something went wrong. Please try again.",
          "error"
        );
      } finally {
        if (button) {
          button.textContent = originalLabel;
          button.disabled = false;
        }
        if (input) {
          input.disabled = false;
        }
      }
    });
  });
}

initNewsletterForms();
