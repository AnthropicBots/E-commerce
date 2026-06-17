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
  const loadingHTML = `
        <div class="loading-products">
            Loading products...
        </div>
    `;

  if (featuredContainer) {
    featuredContainer.innerHTML = loadingHTML;
  }
  if (arrivalsContainer) {
    arrivalsContainer.innerHTML = loadingHTML;
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

  AppUtils.safeArray(products).forEach((product) => {
    if (!product || !product.id) return;

    const card = document.createElement("div");
    card.innerHTML =
      typeof createProductCard === "function" ? createProductCard(product) : "";

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
    typeof escapeHTML === "function" ? escapeHTML(imageSrc) : imageSrc;
  image.alt =
    typeof escapeHTML === "function"
      ? escapeHTML(imageAlt || "Product Image")
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
  fetchAllProducts();
});

const newsletterForm = document.querySelector("#newsletter .form");
if (newsletterForm) {
  newsletterForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const input = newsletterForm.querySelector("input");
    const email = input?.value.trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !validEmail.test(email)) {
      if (typeof notify === "function")
        notify("Please enter a valid email", "error");
      return;
    }

    if (typeof notify === "function")
      notify("Newsletter subscription successful!", "success");
    newsletterForm.reset();
  });
}
