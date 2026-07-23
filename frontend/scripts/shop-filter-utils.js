(function () {
    "use strict";

    const normalizeText = (value) =>
        String(value || "")
            .trim()
            .toLowerCase();

    const getProductTitle = (product) =>
        product?.name || product?.title || "";

    const getProductCategory = (product) =>
        product?.category || "";

    const getProductBrand = (product) =>
        product?.brand || product?.manufacturer || "";

    const normalizeKey = (value) =>
        normalizeText(value)
            .replace(/&/g, "and")
            .replace(/[^a-z0-9]+/g, "");

    const megaCategoryMap = {
        fashion: [
            "Fashion",
            "T-Shirts",
            "T-Shirt",
            "tshirt",
            "Hoodies",
            "Jackets",
            "Jacket",
            "Denim",
            "shirt",
            "Shirts",
            "jeans",
            "Jeans",
            "tops",
            "Tops",
            "traditionalWear",
            "Traditional Wear",
            "skirt-top",
            "Dress",
            "dress",
            "women",
            "Women",
            "men",
            "Men",
            "Footwear",
            "Kids Wear",
            "Watches",
            "Bags",
            "Accessories"
        ],
        electronics: [
            "Electronics",
            "Mobiles",
            "Laptops",
            "Tablets",
            "Smart Watches",
            "Headphones",
            "Cameras",
            "Gaming"
        ],
        grocery: [
            "Grocery",
            "Fruits & Vegetables",
            "Dairy",
            "Snacks",
            "Beverages",
            "Cooking Essentials",
            "Household Supplies"
        ],
        toys: [
            "Toys",
            "Educational Toys",
            "Building Blocks",
            "Dolls",
            "RC Toys",
            "Outdoor Toys"
        ],
        stationery: [
            "Stationery",
            "Notebooks",
            "Pens",
            "Pencils",
            "School Bags",
            "Office Supplies",
            "Art Supplies"
        ],
        homeandkitchen: [
            "Home & Kitchen",
            "Furniture",
            "Cookware",
            "Storage",
            "Home Decor",
            "Bedding",
            "Kitchen Appliances"
        ],
        beauty: [
            "Beauty",
            "Skincare",
            "Haircare",
            "Makeup",
            "Fragrances",
            "Personal Care"
        ],
        sports: [
            "Sports",
            "Cricket",
            "Football",
            "Gym Equipment",
            "Cycling",
            "Outdoor Sports"
        ],
        petsupplies: [
            "Pet Supplies",
            "Dog Food",
            "Cat Food",
            "Pet Toys",
            "Grooming",
            "Accessories"
        ],
        automotive: [
            "Automotive",
            "Car Accessories",
            "Bike Accessories",
            "Helmets",
            "Engine Oil",
            "Cleaning Kits"
        ]
    };

    const megaSubcategoryMap = {
        mensclothing: [
            "Men's Clothing",
            "T-Shirts",
            "T-Shirt",
            "tshirt",
            "Hoodies",
            "Jackets",
            "Jacket",
            "shirt",
            "Shirts",
            "jeans",
            "Jeans",
            "men",
            "Men"
        ],
        womensclothing: [
            "Women's Clothing",
            "T-Shirts",
            "T-Shirt",
            "tshirt",
            "Hoodies",
            "Jackets",
            "Jacket",
            "tops",
            "Tops",
            "jeans",
            "Jeans",
            "traditionalWear",
            "Traditional Wear",
            "skirt-top",
            "dress",
            "Dress",
            "women",
            "Women"
        ],
        kidswear: [
            "Kids Wear"
        ],
        footwear: [
            "Footwear"
        ],
        watches: [
            "Watches"
        ],
        bags: [
            "Bags"
        ],
        accessories: [
            "Accessories"
        ],
        educationaltoys: [
            "Educational Toys"
        ],
        buildingblocks: [
            "Building Blocks"
        ],
        dolls: [
            "Dolls"
        ],
        rctoys: [
            "RC Toys"
        ],
        outdoortoys: [
            "Outdoor Toys"
        ],
        notebooks: [
            "Notebooks",
            "Notebook",
            "Exercise Books",
            "Journals",
            "Diaries"
        ],
        pens: [
            "Pens",
            "Pen",
            "Ball Pens",
            "Gel Pens",
            "Fountain Pens"
        ],
        pencils: [
            "Pencils",
            "Pencil",
            "Color Pencils",
            "Colored Pencils",
            "Mechanical Pencils"
        ],
        schoolbags: [
            "School Bags",
            "School Bag",
            "Backpacks",
            "Backpack",
            "Bags"
        ],
        officesupplies: [
            "Office Supplies",
            "Office Supply",
            "Files",
            "Folders",
            "Staplers",
            "Desk Organizers"
        ],
        artsupplies: [
            "Art Supplies",
            "Art Supply",
            "Paints",
            "Brushes",
            "Sketchbooks",
            "Drawing Supplies"
        ]
    };

    const toKeySet = (values = []) =>
        new Set(values.map(normalizeKey).filter(Boolean));

    const getMappedCategoryKeys = (value, sourceMap = megaCategoryMap) => {
        const key = normalizeKey(value);
        const mappedValues = sourceMap[key] || (value ? [value] : []);

        return toKeySet(mappedValues);
    };

    const productMatchesMappedKeys = (product, mappedKeys) => {
        if (!mappedKeys.size) {
            return true;
        }

        const productKeys = toKeySet([
            getProductCategory(product),
            product?.subcategory,
            product?.sub_category,
            product?.subCategory,
            getProductBrand(product),
            ...(Array.isArray(product?.tags) ? product.tags : [])
        ]);

        return Array.from(productKeys).some((key) => mappedKeys.has(key));
    };

    const getProductPrice = (product) => {
        const price = Number(product?.price);
        return Number.isFinite(price) ? price : 0;
    };

    const getProductRating = (product) => {
        const rating = Number(product?.rating);
        return Number.isFinite(rating) ? rating : 0;
    };

    const getProductStock = (product) => {
        const stock = Number(product?.stock);
        return Number.isFinite(stock) ? stock : 0;
    };

    const getProductReviewCount = (product) => {
    const count = Number(
        product?.num_reviews ??
        product?.numReviews ??
        product?.reviewCount ??
        product?.sales_count ??  // ← ADD THIS LINE
        0
    );
    return Number.isFinite(count) ? count : 0;
};

    const getSearchHaystack = (product) =>
        [
            getProductTitle(product),
            getProductCategory(product),
            getProductBrand(product)
        ]
            .map(normalizeText)
            .join(" ");

    const debounce = (callback, wait = 400) => {
        let timeoutId;

        return (...args) => {
            window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(
                () => callback(...args),
                wait
            );
        };
    };

    const uniqueCategories = (products) =>
        Array.from(
            new Set(
                products
                    .map(getProductCategory)
                    .filter(Boolean)
            )
        ).sort((a, b) => a.localeCompare(b));

    const getPriceBounds = (products) => {
        const prices = products
            .map(getProductPrice)
            .filter((price) => Number.isFinite(price));

        if (!prices.length) {
            return {
                min: 0,
                max: 0
            };
        }

        return {
            min: Math.floor(Math.min(...prices)),
            max: Math.ceil(Math.max(...prices))
        };
    };

    const filterProducts = (products, filters) => {
        const query = normalizeText(filters.search);
        const selectedCategories = new Set(filters.categories || []);
        const selectedMegaCategoryKeys = getMappedCategoryKeys(filters.megaCategory);
        const selectedMegaSubcategoryKeys = getMappedCategoryKeys(
            filters.megaSubcategory,
            megaSubcategoryMap
        );
        const minPrice = Number(filters.minPrice);
        const maxPrice = Number(filters.maxPrice);
        const minimumRating = Number(filters.rating || 0);
        const availability = new Set(filters.availability || []);

        return (Array.isArray(products) ? products : []).filter((product) => {
            const price = getProductPrice(product);
            const stock = getProductStock(product);
            const category = getProductCategory(product);

            if (query && !getSearchHaystack(product).includes(query)) {
                return false;
            }

            if (selectedCategories.size && !selectedCategories.has(category)) {
                return false;
            }

            if (!productMatchesMappedKeys(product, selectedMegaCategoryKeys)) {
                return false;
            }

            if (!productMatchesMappedKeys(product, selectedMegaSubcategoryKeys)) {
                return false;
            }

            if (Number.isFinite(minPrice) && price < minPrice) {
                return false;
            }

            if (Number.isFinite(maxPrice) && price > maxPrice) {
                return false;
            }

            if (minimumRating && getProductRating(product) < minimumRating) {
                return false;
            }

            if (availability.size) {
                const productAvailability = stock > 0
                    ? "in-stock"
                    : "out-of-stock";

                if (!availability.has(productAvailability)) {
                    return false;
                }
            }

            return true;
        });
    };

    const sortProducts = (products, sortValue) => {
        const sortedProducts = [...products];

        const sorters = {
            newest: (a, b) => Number(b.id || 0) - Number(a.id || 0),
            "price-low-high": (a, b) => getProductPrice(a) - getProductPrice(b),
            "price-high-low": (a, b) => getProductPrice(b) - getProductPrice(a),
            popularity: (a, b) => getProductReviewCount(b) - getProductReviewCount(a),
            "highest-rated": (a, b) => getProductRating(b) - getProductRating(a) || getProductTitle(a).localeCompare(getProductTitle(b)),
            "alphabetical-az": (a, b) =>
                getProductTitle(a).localeCompare(getProductTitle(b))
        };

        const sorter = sorters[sortValue] || sorters.newest;

        return sortedProducts.sort(sorter);
    };

    const getSuggestions = (products, query, limit = 6) => {
        const normalizedQuery = normalizeText(query);

        if (!normalizedQuery) {
            return [];
        }

        return products
            .filter((product) => getSearchHaystack(product).includes(normalizedQuery))
            .slice(0, limit);
    };

    window.ShopFilterUtils = {
        debounce,
        filterProducts,
        getPriceBounds,
        getProductBrand,
        getProductCategory,
        getProductPrice,
        getProductRating,
        getProductStock,
        getProductTitle,
        getSuggestions,
        getMappedCategoryKeys,
        normalizeText,
        sortProducts,
        uniqueCategories
    };
})();
