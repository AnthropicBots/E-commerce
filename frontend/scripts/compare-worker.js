// Web Worker for off-main-thread product comparison spec diffing and sorting
self.onmessage = function (e) {
    const { action, products, sortBy, highlightDifferencesOnly } = e.data;

    if (action === "PROCESS_COMPARISON") {
        if (!Array.isArray(products) || products.length === 0) {
            self.postMessage({ action: "PROCESS_COMPARISON_RESULT", specMatrix: [], products: [] });
            return;
        }

        // 1. Sort products if requested
        let sortedProducts = [...products];
        if (sortBy) {
            sortedProducts.sort((a, b) => {
                if (sortBy === "price-asc") return (Number(a.price) || 0) - (Number(b.price) || 0);
                if (sortBy === "price-desc") return (Number(b.price) || 0) - (Number(a.price) || 0);
                if (sortBy === "rating-desc") return (Number(b.rating) || 0) - (Number(a.rating) || 0);
                if (sortBy === "name-asc") return String(a.name || "").localeCompare(String(b.name || ""));
                return 0;
            });
        }

        // 2. Build feature specification rows
        const specKeys = [
            { key: "price", label: "Price", type: "currency" },
            { key: "rating", label: "Customer Rating", type: "rating" },
            { key: "category", label: "Category", type: "text" },
            { key: "brand", label: "Brand / Maker", type: "text" },
            { key: "num_reviews", label: "Total Reviews", type: "number" },
            { key: "stock", label: "Stock Availability", type: "stock" },
            { key: "colors", label: "Available Colors", type: "list" },
            { key: "sizes", label: "Available Sizes", type: "list" }
        ];

        const specMatrix = specKeys.map((spec) => {
            const values = sortedProducts.map((p) => {
                if (spec.key === "colors") return Array.isArray(p.colors) ? p.colors.join(", ") : (p.colors || "N/A");
                if (spec.key === "sizes") return Array.isArray(p.sizes) ? p.sizes.join(", ") : (p.sizes || "N/A");
                return p[spec.key] !== undefined && p[spec.key] !== null ? p[spec.key] : "N/A";
            });

            // Check if all values in row are identical
            const isDifferent = values.some((val) => String(val) !== String(values[0]));

            // Best value highlight logic
            let bestValue = null;
            if (spec.type === "currency") {
                const numericVals = values.map(v => Number(v)).filter(v => !isNaN(v));
                if (numericVals.length) bestValue = Math.min(...numericVals);
            } else if (spec.type === "rating" || spec.type === "number") {
                const numericVals = values.map(v => Number(v)).filter(v => !isNaN(v));
                if (numericVals.length) bestValue = Math.max(...numericVals);
            }

            return {
                key: spec.key,
                label: spec.label,
                type: spec.type,
                values: values,
                isDifferent: isDifferent,
                bestValue: bestValue
            };
        });

        // Filter matrix if user requested differences only
        const filteredMatrix = highlightDifferencesOnly
            ? specMatrix.filter((row) => row.isDifferent)
            : specMatrix;

        self.postMessage({
            action: "PROCESS_COMPARISON_RESULT",
            products: sortedProducts,
            specMatrix: filteredMatrix
        });
    }
};
