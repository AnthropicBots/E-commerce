// loading state
function setLoadingState(
    loading = true
) {
    const containers = [
        document.getElementById(
            "featured-products"
        ),
        document.getElementById(
            "new-arrivals-products"
        )
    ];

    containers.forEach(
        (container) => {
            if (!container) {
                return;
            }
            if (loading) {
                container.innerHTML = `
                    <p class="loading-text">
                        Loading products...
                    </p>
                `;
            }
        }
    );
}

// fetch products
async function loadHomeProducts() {
    try {
        setLoadingState(
            true
        );
        const response =
            await apiRequest(
                "/products"
            );

        if (
            !response.success
        ) {
            throw new Error(
                response.message ||
                "Failed to load products"
            );
        }

        const products =
            Array.isArray(
                response.products
            )
                ? response.products
                : [];

        // global products
        window.allProducts =
            products;

        // render sections
        if (
            typeof renderFeaturedProducts ===
            "function"
        ) {
            renderFeaturedProducts(
                products
            );
        }
        if (
            typeof renderNewArrivals ===
            "function"
        ) {
            renderNewArrivals(
                products
            );
        }

        // apply filters
        if (
            typeof applyShopFilters ===
            "function"
        ) {
            applyShopFilters();
        }

        // ensure animations are applied after product HTML is injected
        if (typeof initializeScrollAnimations === "function") {
            initializeScrollAnimations();
        }
    } catch (error) {

        console.error(
            "HOME PRODUCTS ERROR:",
            error
        );

        notify(
            "Failed to load homepage products",
            "error"
        );
    }
}

// homepage initialization
document.addEventListener(
    "DOMContentLoaded",
    () => {
        loadHomeProducts();

        // Ensure scroll animations work with dynamically rendered sections
        if (typeof initializeScrollAnimations === "function") {
            initializeScrollAnimations();
        }

        if (typeof updateCartCount === "function") {
            updateCartCount();
        }
    }
);


// expose globally
window.loadHomeProducts =
    loadHomeProducts;