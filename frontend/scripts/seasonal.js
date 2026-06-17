document.addEventListener("DOMContentLoaded", async () => {

    const container =
        document.getElementById(
            "seasonal-products"
        );

    try {

        const data =
            await AppUtils.apiRequest(
                "/products?limit=50"
            );

        const seasonalProducts =
            data.products.filter(
                product =>
                    product.category === "Seasonal"
            );

        renderProducts(
            container,
            seasonalProducts
        );

        window.allProducts = seasonalProducts;

    } catch (error) {

        console.error(error);

        container.innerHTML =
            "<p>No products available.</p>";
    }
});