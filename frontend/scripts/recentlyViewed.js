import {
    getJSON,
    $,
    defaultImage
} from "./utils.js";

// LOAD RECENTLY VIEWED PRODUCTS
const recentlyViewed =
    getJSON("recentlyViewed") || [];

// ELEMENTS
const elements = {
    recentContainer:
        $("#recently-viewed-container"),

    recentCount:
        $("#recently-viewed-count")
};

// EMPTY STATE HELPER
const renderEmptyState = (
    container,
    message
) => {
    if(container){
        container.innerHTML =
            `<p>${message}</p>`;
    }
};

// DISPLAY COUNT
if (elements.recentCount) {
    elements.recentCount.innerText =
        recentlyViewed.length;
}

// DISPLAY PRODUCTS
if (elements.recentContainer) {
    elements.recentContainer.innerHTML = "";
    if (recentlyViewed.length === 0) {
        renderEmptyState(
            elements.recentContainer,
            "No recently viewed products."
        );
    } else {
        recentlyViewed.forEach((product) => {
            const div =
                document.createElement("div");
            div.classList.add(
                "recent-product-item"
            );
            div.innerHTML = `
                <img
                    src="${defaultImage(product.image)}"
                    alt="${AppUtils.escapeHTML(product.name || "Product")}"
                >
                <h4>
                    ${AppUtils.escapeHTML(product.name || "Product")}
                </h4>
                <p>
                    ₹${(
                        parseFloat(product.price) || 0
                    ).toFixed(2)}
                </p>
            `;
            elements.recentContainer.appendChild(
                div
            );
        });
    }
}