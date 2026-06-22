const Recommendations = (() => {
  const postInteraction = async (productId, type) => {
    const user = window.AppUtils.getUser();
    if (!user) return; // Only log for authenticated users

    try {
      await window.AppUtils.apiRequest("/recommendations/interaction", {
        method: "POST",
        body: JSON.stringify({ productId, type }),
      });
    } catch (error) {
      console.error("Failed to post interaction", error);
    }
  };

  const loadRecommendations = async (
    containerId = "recommended-products-container"
  ) => {
    const container = window.AppUtils.$(containerId);
    if (!container) return;

    const user = window.AppUtils.getUser();
    if (!user) {
      // If not logged in, hide recommendations section
      const section = container.closest("section");
      if (section) section.style.display = "none";
      return;
    }

    try {
      const response = await window.AppUtils.apiRequest(
        "/recommendations?limit=8"
      );

      if (
        response &&
        response.success &&
        response.data &&
        response.data.length > 0
      ) {
        // Ensure UI functions are available and use the correct arguments
        if (typeof window.createProductCard === "function") {
          container.innerHTML = response.data
            .map(window.createProductCard)
            .join("");

          if (typeof window.addProductCardAnimations === "function") {
            window.addProductCardAnimations(`#${containerId}`);
          }
        } else if (typeof window.renderProducts === "function") {
          // script.js defines: renderProducts(container, products)
          window.renderProducts(container, response.data);
        } else if (typeof window.renderProductCard === "function") {
          // product-render.js defines: renderProductCard(product, container)
          container.innerHTML = "";
          response.data.forEach((product) =>
            window.renderProductCard(product, container)
          );
        } else {
          console.warn(
            "No compatible product renderer found, skipping render."
          );
        }
      } else {
        // Hide if no recommendations
        const section = container.closest("section");
        if (section) section.style.display = "none";
      }
    } catch (error) {
      console.error("Failed to load recommendations", error);
      const section = container.closest("section");
      if (section) section.style.display = "none";
    }
  };

  const initViewTracking = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get("id");

    if (window.location.pathname.includes("product.html") && productId) {
      // Record a view
      postInteraction(parseInt(productId, 10), "view");
    }
  };

  // Wait for DOM
  document.addEventListener("DOMContentLoaded", () => {
    initViewTracking();
    loadRecommendations();
  });

  return {
    postInteraction,
    loadRecommendations,
  };
})();

window.Recommendations = Recommendations;