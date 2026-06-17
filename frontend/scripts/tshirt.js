document.addEventListener("DOMContentLoaded", async () => {

    const container =
        document.getElementById(
            "tshirt-products"
        );

    try {

        const data =
            await AppUtils.apiRequest(
                "/products?limit=50"
            );

        const tshirtProducts =
            data.products.filter(
                product =>
                    product.category === "T-Shirt"
            );

        renderProducts(
            container,
            tshirtProducts
        );

        window.allProducts = tshirtProducts;

    } catch (error) {

        console.error(error);

        container.innerHTML =
            "<p>No products available.</p>";
    }
});