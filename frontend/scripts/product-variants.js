// product variants state
const productVariants = {};

let selectedColor =
    null;

let selectedSize =
    null;

// variant elements
const colorButtons =
    document.querySelectorAll(
        ".color-btn"
    );

const sizeButtons =
    document.querySelectorAll(
        ".size-btn"
    );

// setup variants
function setupVariants(
    product
) {
    if (
        !product
        ||
        !Array.isArray(
            product.variants
        )
        ||
        product.variants.length === 0
    ) {

       
        const variantStockEl =
            document.getElementById(
                "variant-stock"
            );

        if (
            variantStockEl
        ) {

            variantStockEl.innerText =
                Number(
                    product.stock
                ) || 0;

            variantStockEl.style.color =
                Number(
                    product.stock
                ) <= 3
                    ? "red"
                    : "#088178";
        }

        return;
    }

    Object.keys(
        productVariants
    ).forEach(
        (key) => {
            Deletee productVariants[
                key
            ];
        }
    );

    product.variants.forEach(
        (variant) => {
            const {
                color,
                sizes,
                image
            } = variant;

            productVariants[
                color
            ] = {
                ...sizes,
                image
            };
        }
    );

    selectedColor =
        Object.keys(
            productVariants
        )[0]
        || "Black";

    selectedSize =
        Object.keys(
            productVariants[
                selectedColor
            ] || {}
        )[0]
        || "M";

    updateVariant();
}

// update variant
function updateVariant() {
    const currentVariant =
        productVariants[
            selectedColor
        ];

    if (
        !currentVariant
    ) {
        return;
    }

    const stock =
        currentVariant[
            selectedSize
        ];

    if (
        stock === undefined
    ) {
        return;
    }

    const variantStockEl =
        document.getElementById(
            "variant-stock"
        );

    if (
        variantStockEl
    ) {

        variantStockEl.innerText =
            stock;

        variantStockEl.style.color =
            stock <= 3
                ? "red"
                : "#088178";

        // re-clamp the quantity selector to the new stock
        if (typeof window.syncProductQtyControls === "function") {
            window.syncProductQtyControls();
        }
    }


    const mainImageEl =
        document.getElementById(
            "main-product-image"
        );

    if (
        mainImageEl
    ) {

        mainImageEl.src =
            AppUtils.defaultImage(
                currentVariant.image
            );
    }

    window.selectedColor =
        selectedColor;

    window.selectedSize =
        selectedSize;
}

// color events
colorButtons.forEach(
    (button) => {
        button.addEventListener(
            "click",
            () => {
                colorButtons.forEach(
                    (btn) => {
                        btn.classList.remove(
                            "active-color"
                        );
                    }
                );

                button.classList.add(
                    "active-color"
                );

                selectedColor =
                    button.dataset.color;

                updateVariant();
            }
        );
    }
);

// size events
sizeButtons.forEach(
    (button) => {
        button.addEventListener(
            "click",
            () => {
                sizeButtons.forEach(
                    (btn) => {
                        btn.classList.remove(
                            "active-size"
                        );
                    }
                );

                button.classList.add(
                    "active-size"
                );

                selectedSize =
                    button.dataset.size;

                updateVariant();
            }
        );
    }
);

// quantity controls
if (
    window.plusBtn
) {
    window.plusBtn.addEventListener(
        "click",
        () => {
            const currentVariant =
                productVariants[
                    selectedColor
                ];

            if (
                !currentVariant
            ) {
                return;
            }

            const stock =
                currentVariant[
                    selectedSize
                ];

            if (
                parseInt(
                    window.qtyInput.value
                ) < stock
            ) {
                window.qtyInput.value =
                    parseInt(
                        window.qtyInput.value
                    ) + 1;
            }
        }
    );
}

if (
    window.minusBtn
) {
    window.minusBtn.addEventListener(
        "click",
        () => {
            if (
                parseInt(
                    window.qtyInput.value
                ) > 1
            ) {
                window.qtyInput.value =
                    parseInt(
                        window.qtyInput.value
                    ) - 1;
            }
        }
    );
}

// qty validation
if (
    window.qtyInput
) {
    window.qtyInput.addEventListener(
        "input",
        () => {
            if (
                window.qtyInput.value < 1
                ||
                isNaN(
                    window.qtyInput.value
                )
            ) {
                window.qtyInput.value = 1;
            }
        }
    );
}

// expose globally
window.productVariants =
    productVariants;

window.selectedColor =
    selectedColor;

window.selectedSize =
    selectedSize;

window.setupVariants =
    setupVariants;

window.updateVariant =
    updateVariant;