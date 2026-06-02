
// global state
let allProducts = [];

// loading state
let isLoading =
    false;

// containers
const featuredContainer =
    document.getElementById(
        "featured-products"
    );

const arrivalsContainer =
    document.getElementById(
        "new-arrivals-container"
    );

// loading skeleton
function renderLoadingState() {

    const loadingHTML =
        `
            <div class="loading-products">
                Loading products...
            </div>
        `;

    if (
        featuredContainer
    ) {

        featuredContainer.innerHTML =
            loadingHTML;
    }

    if (
        arrivalsContainer
    ) {

        arrivalsContainer.innerHTML =
            loadingHTML;
    }
}

// fetch products
async function fetchAllProducts() {

    if (
        isLoading
    ) {

        return;
    }

    isLoading =
        true;

    renderLoadingState();

    try {

        const data =
            await AppUtils.apiRequest(
                "/products?limit=50"
            );

        if (
            data.success
        ) {

            allProducts =
                AppUtils.safeArray(
                    data.products
                );

            window.allProducts =
                allProducts;

            renderHomepageProducts();
<<<<<<< HEAD

        } else {

            renderEmptyState();
=======
            renderRecentlyViewedProducts();
>>>>>>> cc215fb (feat(ui): redesign e-commerce landing page with premium UX and product experience)
        }

    } catch (error) {

        console.error(
            "PRODUCT FETCH ERROR:",
            error
        );

        renderEmptyState();
<<<<<<< HEAD

    } finally {

        isLoading =
            false;
=======
        renderRecentlyViewedProducts();
>>>>>>> cc215fb (feat(ui): redesign e-commerce landing page with premium UX and product experience)
    }
}

// render homepage products
function renderHomepageProducts() {

    if (
        !AppUtils.safeArray(
            allProducts
        ).length
    ) {

        renderEmptyState();

        return;
    }

    // featured products
    if (
        featuredContainer
    ) {

        const featuredProducts =
            allProducts.filter(
                (
                    product
                ) => {

                    return (
                        Number(
                            product.featured
                        ) === 1
                    );
                }
            );

        renderProducts(
            featuredContainer,
            featuredProducts.slice(
                0,
                8
            )
        );
    }

    // new arrivals
    if (
        arrivalsContainer
    ) {

        const newArrivals =
            allProducts.filter(
                (
                    product
                ) => {

                    return (
                        Number(
                            product.featured
                        ) !== 1
                    );
                }
            );

        renderProducts(
            arrivalsContainer,
            newArrivals.slice(
                0,
                8
            )
        );
    }
}

// empty state
function renderEmptyState() {

    const containers = [

        featuredContainer,

        arrivalsContainer
    ];

    containers.forEach(
        (
            container
        ) => {

            if (
                container
            ) {

                container.innerHTML =
                    `
                        <p class="empty-products">
                            No products available.
                        </p>
                    `;
            }
        }
    );
}

// render products
function renderProducts(
    container,
    products = []
) {

    if (
        !container
    ) {

        return;
    }

    container.innerHTML =
        "";

    if (
        !AppUtils.safeArray(
            products
        ).length
    ) {

        container.innerHTML =
            `
                <p class="empty-products">
                    No products available.
                </p>
            `;

        return;
    }

    const fragment =
        document.createDocumentFragment();

    AppUtils.safeArray(
        products
    ).forEach(
        (
            product
        ) => {

            if (
                !product
                ||
                !product.id
            ) {

                return;
            }

            const card =
                document.createElement(
                    "div"
                );

            card.innerHTML =
                createProductCard(
                    product
                );

            const productElement =
                card.firstElementChild;

            if (
                productElement
            ) {

                fragment.appendChild(
                    productElement
                );
            }
        }
    );

    container.appendChild(
        fragment
    );

    initializeProductCardFeatures();
}

// quick view modal
function createQuickViewModal(
    imageSrc,
    imageAlt
) {

    const modal =
        document.createElement(
            "div"
        );

    modal.className =
        "quick-view-modal";

    modal.style.cssText =
        `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            padding: 20px;
        `;

    modal.setAttribute(
        "role",
        "dialog"
    );

    modal.setAttribute(
        "aria-modal",
        "true"
    );

    const box =
        document.createElement(
            "div"
        );

    box.style.cssText =
        `
            background: white;
            padding: 20px;
            border-radius: 12px;
            max-width: 420px;
            width: 100%;
            text-align: center;
            position: relative;
        `;

    const image =
        document.createElement(
            "img"
        );

    image.src =
        escapeHTML(
            imageSrc
        );

    image.alt =
        escapeHTML(
            imageAlt
            || "Product Image"
        );

    image.style.cssText =
        `
            width: 100%;
            max-height: 450px;
            object-fit: contain;
        `;

    const closeButton =
        document.createElement(
            "button"
        );

    closeButton.innerHTML =
        "&times;";

    closeButton.setAttribute(
        "aria-label",
        "Close modal"
    );

    closeButton.style.cssText =
        `
            position: absolute;
            top: 10px;
            right: 14px;
            border: none;
            background: transparent;
            font-size: 28px;
            cursor: pointer;
        `;

    box.appendChild(
        closeButton
    );

    box.appendChild(
        image
    );

    modal.appendChild(
        box
    );

    return {
        modal,
        closeButton
    };
}

// product card features
function initializeProductCardFeatures() {

    const productCards =
        document.querySelectorAll(
            ".pro"
        );

    AppUtils.safeArray(
        [
            ...productCards
        ]
    ).forEach(
        (
            card
        ) => {

            const img =
                card.querySelector(
                    "img"
                );

            if (
                !img
            ) {

                return;
            }

            // avoid duplicate listeners
            if (
                img.dataset.modalBound
            ) {

                return;
            }

            img.dataset.modalBound =
                "true";

            img.addEventListener(
                "click",
                () => {

                    const {
                        modal,
                        closeButton
                    } =
                        createQuickViewModal(
                            img.src,
                            img.alt
                        );

                    document.body.appendChild(
                        modal
                    );

                    document.body.style.overflow =
                        "hidden";

                    function closeModal() {

                        document.body.style.overflow =
                            "";

                        modal.remove();

                        document.removeEventListener(
                            "keydown",
                            handleEscape
                        );
                    }

                    function handleEscape(
                        event
                    ) {

                        if (
                            event.key ===
                            "Escape"
                        ) {

                            closeModal();
                        }
                    }

                    modal.addEventListener(
                        "click",
                        (
                            event
                        ) => {

                            if (
                                event.target === modal
                            ) {

                                closeModal();
                            }
                        }
                    );

                    closeButton.addEventListener(
                        "click",
                        closeModal
                    );

                    document.addEventListener(
                        "keydown",
                        handleEscape
                    );
                }
            );
        }
    );
}

<<<<<<< HEAD

// navbar auth sync
function syncNavbarAuth() {

    const user =
        AppUtils.getUser();

    const authButtons =
        document.querySelectorAll(
            "[data-auth-state]"
        );

    authButtons.forEach(
        (
            element
        ) => {

            const requiredState =
                element.dataset.authState;

            if (
                requiredState === "authenticated"
            ) {

                element.style.display =
                    user
                        ? ""
                        : "none";
            }

            if (
                requiredState === "guest"
            ) {

                element.style.display =
                    user
                        ? "none"
                        : "";
            }
        }
    );
}

// init
document.addEventListener(
    "DOMContentLoaded",
    () => {

        syncNavbarAuth();

        fetchAllProducts();
    }
);
=======
// render recently viewed products on homepage
function renderRecentlyViewedProducts() {
    const container = document.getElementById("recently-viewed-container");
    const section = document.getElementById("recently-viewed");
    
    if (!container || !section) {
        return;
    }
    
    const recentlyViewed = AppUtils.getJSON("recentlyViewed") || [];
    
    if (recentlyViewed.length === 0) {
        section.classList.add("hidden");
        return;
    }
    
    section.classList.remove("hidden");
    container.innerHTML = "";
    
    const fragment = document.createDocumentFragment();
    
    // Display up to 4 recently viewed products
    recentlyViewed.slice(0, 4).forEach((product) => {
        const card = document.createElement("div");
        card.innerHTML = createProductCard(product);
        const productElement = card.firstElementChild;
        if (productElement) {
            fragment.appendChild(productElement);
        }
    });
    
    container.appendChild(fragment);
    initializeProductCardFeatures();
}
>>>>>>> cc215fb (feat(ui): redesign e-commerce landing page with premium UX and product experience)
