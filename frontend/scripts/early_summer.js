document.addEventListener("DOMContentLoaded", async () => {

    const container =
        document.getElementById(
            "summer-products"
        );

    try {

        const data =
            await AppUtils.apiRequest(
                "/products?limit=50"
            );

        const summerProducts =
            data.products.filter(
                product =>
                    product.category === "Summer"
            );

        renderProducts(
            container,
            summerProducts
        );

        window.allProducts = summerProducts;

    } catch (error) {

        console.error(error);

        container.innerHTML =
            "<p>No products available.</p>";
    }
});