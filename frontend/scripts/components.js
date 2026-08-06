// ===== THEME - Apply INSTANTLY before anything loads =====
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
}

// load component
const loadComponent = async (id, file) => {
    const element = document.getElementById(id);

    if (!element) {
        return false;
    }

    element.innerHTML = `<div class="component-loading">Loading...</div>`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => { controller.abort(); }, 8000);

        const response = await fetch(file, { signal: controller.signal });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Failed to load ${file}`);
        }

        const data = await response.text();
        element.innerHTML = data;

        if (
            id === "navbar" &&
            element.dataset.hideGlobalSearch === "true"
        ) {
            element.querySelector(".search-container")?.remove();
        }

        return true;

    } catch (error) {
        console.error(`Error loading component: ${file}`, error);
        element.innerHTML = `<div class="component-error">Failed to load component.</div>`;
        return false;
    }
};

const loadScript = (
    src
) => {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            if (
                document.querySelector(
                    `script[src="${src}"]`
                )
            ) {
                resolve();
                return;
            }

            const script =
                document.createElement(
                    "script"
                );

            script.src = src;
            script.defer = true;
            script.onload = resolve;
            script.onerror = reject;

            document.body.appendChild(
                script
            );
        }
    );
};

const loadStylesheet = (
    href
) => {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            if (
                document.querySelector(
                    `link[href="${href}"]`
                )
            ) {
                resolve();
                return;
            }

            const stylesheet =
                document.createElement(
                    "link"
                );

            stylesheet.rel =
                "stylesheet";

            stylesheet.href =
                href;

            stylesheet.onload =
                resolve;

            stylesheet.onerror =
                reject;

            document.head.appendChild(
                stylesheet
            );
        }
    );
};

// initialize components
async function initializeComponents() {
    const loadTasks = [
        loadComponent(
            "navbar",
            "./components/navbar.html?v=" + new Date().getTime()
        ),

        loadComponent(
            "footer",
            "./components/footer.html?v=" + new Date().getTime()
        )
    ];

    if (
        !document.getElementById(
            "cart-drawer"
        )
    ) {
        let drawerHost =
            document.getElementById(
                "cart-drawer-host"
            );

        if (
            !drawerHost
        ) {
            drawerHost =
                document.createElement(
                    "div"
                );

            drawerHost.id =
                "cart-drawer-host";

            document.body.appendChild(
                drawerHost
            );
        }

        loadTasks.push(
            loadComponent(
                "cart-drawer-host",
                "./components/cart-drawer.html?v=" + new Date().getTime()
            )
        );
    }

    await Promise.all(
        loadTasks
    );

    try {
        await loadScript(
            "scripts/cart-drawer.js"
        );
    } catch (error) {
        console.error(
            "Failed to load cart drawer script:",
            error
        );
    }

    // ===== THEME TOGGLE - runs AFTER navbar is loaded =====
    const themeToggle = document.getElementById('theme-toggle');

    if (themeToggle) {
        // Set correct icon on load
        themeToggle.innerHTML = localStorage.getItem('theme') === 'dark' ? '☀️' : '🌙';

        themeToggle.addEventListener('click', function () {
            document.body.classList.toggle('dark-theme');

            if (document.body.classList.contains('dark-theme')) {
                localStorage.setItem('theme', 'dark');
                themeToggle.innerHTML = '☀️';
            } else {
                localStorage.setItem('theme', 'light');
                themeToggle.innerHTML = '🌙';
            }
        });
    }
    // Set active nav link based on current page
const navLinks = document.querySelectorAll('#navbar-links a');
navLinks.forEach(link => {
    if (link.href === window.location.href) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
    }
});
    // ===== NAVBAR SEARCH =====
    // Widget lives at module scope (see initNavbarSearch below); called here
    // because it needs the navbar markup, which has just been injected.
    initNavbarSearch();


const categoryMenuItem = document.querySelector(".category-menu-item");
const categoryMenuToggle = document.getElementById("category-menu-toggle");
const categoryMenuDropdown = document.getElementById("category-menu-dropdown");
const megaMenuCategories = Array.from(
    document.querySelectorAll(".mega-menu-category")
);
const megaMenuPanels = Array.from(
    document.querySelectorAll(".mega-menu-panel")
);
const categoryMenuLinks = document.querySelectorAll(
    ".category-menu-link, .toy-category-card, .mega-menu-panel-header a, .mobile-subcategory-panel a"
);
const mobileCategoryAccordions = Array.from(
    document.querySelectorAll(".mobile-category-accordion")
);
const currentUrl = new URL(window.location.href);
const currentCategory = currentUrl.searchParams.get("category");
const currentSubcategory = currentUrl.searchParams.get("subcategory");
const grocerySubcategoryLinks = Array.from(
    document.querySelectorAll(".grocery-subcategory-link")
);
const groceryProductPreview = document.getElementById(
    "grocery-product-preview"
);
const toySubcategoryLinks = Array.from(
    document.querySelectorAll(".toy-subcategory-link")
);
const toyProductPreview = document.getElementById(
    "toy-product-preview"
);
const stationerySubcategoryLinks = Array.from(
    document.querySelectorAll(".stationery-subcategory-link")
);
const stationeryProductPreview = document.getElementById(
    "stationery-product-preview"
);

const grocerySubcategoryKeywords = {
    "Fruits & Vegetables": [
        "fruit",
        "fruits",
        "vegetable",
        "vegetables",
        "apple",
        "banana",
        "orange",
        "tomato",
        "potato",
        "onion",
        "leafy",
        "greens"
    ],
    Dairy: [
        "dairy",
        "milk",
        "curd",
        "yogurt",
        "cheese",
        "butter",
        "paneer",
        "cream"
    ],
    Snacks: [
        "snack",
        "snacks",
        "chips",
        "biscuit",
        "cookies",
        "namkeen",
        "cracker",
        "popcorn"
    ],
    Beverages: [
        "beverage",
        "beverages",
        "juice",
        "tea",
        "coffee",
        "drink",
        "water",
        "soda"
    ],
    "Cooking Essentials": [
        "cooking",
        "oil",
        "rice",
        "flour",
        "atta",
        "dal",
        "spice",
        "masala",
        "salt",
        "sugar"
    ],
    "Household Supplies": [
        "household",
        "cleaner",
        "detergent",
        "soap",
        "dishwash",
        "tissue",
        "toilet",
        "floor",
        "laundry"
    ]
};

const toySubcategoryKeywords = {
    "Educational Toys": [
        "educational",
        "learning",
        "stem",
        "science",
        "math",
        "puzzle",
        "flash",
        "activity"
    ],
    "Building Blocks": [
        "building",
        "blocks",
        "block",
        "brick",
        "bricks",
        "construction",
        "lego",
        "stack"
    ],
    Dolls: [
        "doll",
        "dolls",
        "plush",
        "figure",
        "figurine",
        "pretend",
        "playset"
    ],
    "RC Toys": [
        "rc",
        "remote",
        "control",
        "controlled",
        "car",
        "drone",
        "robot",
        "vehicle"
    ],
    "Outdoor Toys": [
        "outdoor",
        "scooter",
        "ball",
        "frisbee",
        "water",
        "garden",
        "sports",
        "ride"
    ]
};

const stationerySubcategoryKeywords = {
    "Notebooks & Planners": [
        "notebook",
        "notebooks",
        "planner",
        "planners",
        "diary",
        "journal",
        "journals",
        "pad",
        "pads"
    ],
    "Pens & Writing": [
        "pen",
        "pens",
        "pencil",
        "pencils",
        "writing",
        "marker",
        "markers",
        "ink",
        "eraser",
        "erasers",
        "sharpener",
        "sharpeners"
    ],
    "Office Supplies": [
        "office",
        "desk",
        "supplies",
        "clip",
        "clips",
        "stapler",
        "staplers",
        "tape",
        "tapes",
        "folder",
        "folders",
        "paperclip",
        "scissors"
    ],
    "Art Supplies": [
        "art",
        "paint",
        "paints",
        "watercolor",
        "canvas",
        "brush",
        "brushes",
        "sketchbook",
        "sketchbooks",
        "crayon",
        "crayons",
        "pastel"
    ]
};

const normalizeMenuValue = (value) =>
    String(value || "")
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

const stringifyProductValue = (value) => {
    if (!value) {
        return "";
    }

    if (Array.isArray(value)) {
        return value.map(stringifyProductValue).join(" ");
    }

    if (typeof value === "object") {
        return Object.values(value).map(stringifyProductValue).join(" ");
    }

    return String(value);
};

const escapeMenuHTML = (value) =>
    window.AppUtils?.escapeHTML
        ? AppUtils.escapeHTML(value)
        : String(value || "");

const getProductSearchText = (product) =>
    [
        product?.name,
        product?.description,
        product?.category,
        product?.subcategory,
        product?.sub_category,
        product?.brand,
        stringifyProductValue(product?.tags),
        stringifyProductValue(product?.specifications)
    ].join(" ");

const getProductSubcategory = (product) =>
    product?.subcategory ||
    product?.sub_category ||
    product?.subCategory ||
    "";

const matchesGrocerySubcategory = (product, subcategory) => {
    const normalizedSubcategory = normalizeMenuValue(subcategory);
    const category = normalizeMenuValue(product?.category);
    const productSubcategory = normalizeMenuValue(
        getProductSubcategory(product)
    );
    const searchText = normalizeMenuValue(
        getProductSearchText(product)
    );
    const keywords = grocerySubcategoryKeywords[subcategory] || [];

    if (productSubcategory) {
        return productSubcategory === normalizedSubcategory;
    }

    if (category === normalizedSubcategory) {
        return true;
    }

    if (
        category !== "grocery" &&
        !searchText.includes("grocery")
    ) {
        return false;
    }

    return keywords.some((keyword) =>
        searchText.includes(normalizeMenuValue(keyword))
    );
};

const matchesToySubcategory = (product, subcategory) => {
    const normalizedSubcategory = normalizeMenuValue(subcategory);
    const category = normalizeMenuValue(product?.category);
    const productSubcategory = normalizeMenuValue(
        getProductSubcategory(product)
    );
    const searchText = normalizeMenuValue(
        getProductSearchText(product)
    );
    const keywords = toySubcategoryKeywords[subcategory] || [];

    if (productSubcategory) {
        return productSubcategory === normalizedSubcategory;
    }

    if (category === normalizedSubcategory) {
        return true;
    }

    if (
        category !== "toys" &&
        !searchText.includes("toy")
    ) {
        return false;
    }

    return keywords.some((keyword) =>
        searchText.includes(normalizeMenuValue(keyword))
    );
};

const matchesStationerySubcategory = (product, subcategory) => {
    const normalizedSubcategory = normalizeMenuValue(subcategory);
    const category = normalizeMenuValue(product?.category);
    const productSubcategory = normalizeMenuValue(
        getProductSubcategory(product)
    );
    const searchText = normalizeMenuValue(
        getProductSearchText(product)
    );
    const keywords = stationerySubcategoryKeywords[subcategory] || [];

    if (productSubcategory) {
        return productSubcategory === normalizedSubcategory;
    }

    if (category === normalizedSubcategory) {
        return true;
    }

    if (
        category !== "stationery" &&
        !searchText.includes("stationery")
    ) {
        return false;
    }

    return keywords.some((keyword) =>
        searchText.includes(normalizeMenuValue(keyword))
    );
};

const getProductLink = (
    product,
    fallbackCategory,
    fallbackSubcategory
) => {
    if (product?.id !== undefined && product?.id !== null) {
        return `product.html?id=${encodeURIComponent(product.id)}`;
    }

    return `shop.html?category=${encodeURIComponent(
        fallbackCategory
    )}&subcategory=${encodeURIComponent(
        fallbackSubcategory
    )}`;
};

const renderMenuRating = (rating) => {
    const normalizedRating = Number(rating);

    if (!Number.isFinite(normalizedRating) || normalizedRating <= 0) {
        return "";
    }

    const starCount = Math.max(
        1,
        Math.min(5, Math.round(normalizedRating))
    );
    const stars = Array.from(
        { length: starCount },
        () => `<i class="fas fa-star" aria-hidden="true"></i>`
    ).join("");

    return `
        <span class="grocery-menu-product-rating toy-menu-product-rating" aria-label="${starCount} out of 5 stars">
            ${stars}
        </span>
    `;
};

const renderGroceryProducts = (products, subcategory) => {
    if (!groceryProductPreview) {
        return;
    }

    const safeProducts = Array.isArray(products)
        ? products
        : [];

    if (!safeProducts.length) {
        groceryProductPreview.innerHTML =
            `<p class="grocery-menu-empty">No products available.</p>`;
        return;
    }

    groceryProductPreview.innerHTML = safeProducts
        .slice(0, 4)
        .map((product) => {
            const name = product?.name || "Product";
            const escapedName = AppUtils.escapeHTML(name);
            const image = AppUtils.defaultImage(product?.image);
            const price = AppUtils.formatPrice(product?.price || 0);
            const href = getProductLink(product, "Grocery", subcategory);

            return `
                <a class="grocery-menu-product" href="${href}">
                    <img
                        src="${AppUtils.escapeHTML(image)}"
                        alt="${escapedName}"
                        loading="lazy"
                    />
                    <span class="grocery-menu-product-info">
                        <span class="grocery-menu-product-name">${escapedName}</span>
                        <span class="grocery-menu-product-price">${price}</span>
                    </span>
                </a>
            `;
        })
        .join("");
};

const renderToyProducts = (products, subcategory) => {
    if (!toyProductPreview) {
        return;
    }

    const safeProducts = Array.isArray(products)
        ? products
        : [];

    if (!safeProducts.length) {
        toyProductPreview.innerHTML =
            `<p class="grocery-menu-empty toy-menu-empty">No toys available for ${escapeMenuHTML(subcategory)} yet.</p>`;
        return;
    }

    toyProductPreview.innerHTML = safeProducts
        .slice(0, 4)
        .map((product) => {
            const name = product?.name || "Toy";
            const escapedName = AppUtils.escapeHTML(name);
            const image = AppUtils.defaultImage(product?.image);
            const price = AppUtils.formatPrice(product?.price || 0);
            const href = getProductLink(product, "Toys", subcategory);
            const rating = renderMenuRating(product?.rating);

            return `
                <a class="grocery-menu-product toy-menu-product" href="${href}">
                    <img
                        src="${AppUtils.escapeHTML(image)}"
                        alt="${escapedName}"
                        loading="lazy"
                    />
                    <span class="grocery-menu-product-info toy-menu-product-info">
                        <span class="grocery-menu-product-name toy-menu-product-name">${escapedName}</span>
                        <span class="grocery-menu-product-price toy-menu-product-price">${price}</span>
                        ${rating}
                    </span>
                </a>
            `;
        })
        .join("");
};

const setActiveGrocerySubcategory = (activeLink) => {
    grocerySubcategoryLinks.forEach((link) => {
        const isActive = link === activeLink;

        link.classList.toggle("is-active", isActive);
    });
};

const setActiveToySubcategory = (activeLink) => {
    toySubcategoryLinks.forEach((link) => {
        const isActive = link === activeLink;

        link.classList.toggle("is-active", isActive);
    });
};

const renderStationeryProducts = (products, subcategory) => {
    if (!stationeryProductPreview) {
        return;
    }

    const safeProducts = Array.isArray(products)
        ? products
        : [];

    if (!safeProducts.length) {
        stationeryProductPreview.innerHTML =
            `<p class="grocery-menu-empty stationery-menu-empty">No stationery products available for ${escapeMenuHTML(subcategory)} yet.</p>`;
        return;
    }

    stationeryProductPreview.innerHTML = safeProducts
        .slice(0, 4)
        .map((product) => {
            const name = product?.name || "Stationery";
            const escapedName = AppUtils.escapeHTML(name);
            const image = AppUtils.defaultImage(product?.image);
            const price = AppUtils.formatPrice(product?.price || 0);
            const href = getProductLink(product, "Stationery", subcategory);
            const rating = renderMenuRating(product?.rating);

            return `
                <a class="grocery-menu-product toy-menu-product stationery-menu-product" href="${href}">
                    <img
                        src="${AppUtils.escapeHTML(image)}"
                        alt="${escapedName}"
                        loading="lazy"
                    />
                    <span class="grocery-menu-product-info toy-menu-product-info stationery-menu-product-info">
                        <span class="grocery-menu-product-name toy-menu-product-name stationery-menu-product-name">${escapedName}</span>
                        <span class="grocery-menu-product-price toy-menu-product-price stationery-menu-product-price">${price}</span>
                        ${rating}
                    </span>
                </a>
            `;
        })
        .join("");
};

const setActiveStationerySubcategory = (activeLink) => {
    stationerySubcategoryLinks.forEach((link) => {
        const isActive = link === activeLink;

        link.classList.toggle("is-active", isActive);
    });
};

let megaMenuProductsCache;
let megaMenuProductsPromise = null;

const fetchMegaMenuProducts = async () => {
    if (!window.AppUtils) {
        return [];
    }

    if (Array.isArray(megaMenuProductsCache)) {
        return megaMenuProductsCache;
    }

    if (megaMenuProductsPromise) {
        return megaMenuProductsPromise;
    }

    megaMenuProductsPromise = (async () => {
        try {
            const requestedLimit = 200;
            const firstPage = await AppUtils.apiRequest(
                `/products?page=1&limit=${requestedLimit}`
            );
            const products = firstPage.success && Array.isArray(firstPage.products)
                ? [...firstPage.products]
                : [];
            const pageLimit = Number(firstPage.limit) || products.length || 50;
            const totalPages = Number(firstPage.totalPages) || 1;
            const pagesToFetch = Math.min(
                totalPages,
                Math.ceil(requestedLimit / pageLimit)
            );

            for (let page = 2; page <= pagesToFetch; page += 1) {
                if (products.length >= requestedLimit) {
                    break;
                }

                const data = await AppUtils.apiRequest(
                    `/products?page=${page}&limit=${requestedLimit}`
                );

                if (data.success && Array.isArray(data.products)) {
                    products.push(...data.products);
                }
            }

            megaMenuProductsCache = products.slice(0, requestedLimit);
        } catch (error) {
            console.error(
                "MEGA MENU PRODUCTS FETCH ERROR:",
                error
            );
            megaMenuProductsCache = [];
        } finally {
            const resolved = megaMenuProductsCache || [];
            megaMenuProductsPromise = null;
            return resolved;
        }
    })();

    return megaMenuProductsPromise;
};

let fashionMenuPreviewRequestId = 0;

const initializeGroceryMegaMenu = async () => {
    if (!grocerySubcategoryLinks.length || !groceryProductPreview) {
        return;
    }

    let groceryProducts = [];

    const showSubcategoryProducts = (link) => {
        const subcategory =
            link.dataset.grocerySubcategory ||
            link.textContent.trim();
        const products = groceryProducts.filter((product) =>
            matchesGrocerySubcategory(product, subcategory)
        );

        setActiveGrocerySubcategory(link);
        renderGroceryProducts(products, subcategory);
    };

    grocerySubcategoryLinks.forEach((link) => {
        link.addEventListener("mouseenter", () => {
            showSubcategoryProducts(link);
        });

        link.addEventListener("focus", () => {
            showSubcategoryProducts(link);
        });
    });

    groceryProducts = await fetchMegaMenuProducts();

    const defaultLink =
        grocerySubcategoryLinks.find((link) =>
            link.dataset.grocerySubcategory === currentSubcategory
        ) || grocerySubcategoryLinks[0];

    showSubcategoryProducts(defaultLink);
};

const initializeToyMegaMenu = async () => {
    if (!toySubcategoryLinks.length || !toyProductPreview) {
        return;
    }

    let toyProducts = [];

    const showSubcategoryProducts = (link) => {
        const subcategory =
            link.dataset.toySubcategory ||
            link.textContent.trim();
        const products = toyProducts.filter((product) =>
            matchesToySubcategory(product, subcategory)
        );

        setActiveToySubcategory(link);
        renderToyProducts(products, subcategory);
    };

    toySubcategoryLinks.forEach((link) => {
        link.addEventListener("mouseenter", () => {
            showSubcategoryProducts(link);
        });

        link.addEventListener("focus", () => {
            showSubcategoryProducts(link);
        });
    });

    toyProducts = await fetchMegaMenuProducts();

    const defaultLink =
        toySubcategoryLinks.find((link) =>
            link.dataset.toySubcategory === currentSubcategory
        ) || toySubcategoryLinks[0];

    showSubcategoryProducts(defaultLink);
};

let menuHoverTimeout = null;

const setCategoryMenuOpen = (isOpen) => {
    if (!categoryMenuItem || !categoryMenuToggle) {
        return;
    }

    if (menuHoverTimeout) {
        clearTimeout(menuHoverTimeout);
        menuHoverTimeout = null;
    }

    categoryMenuItem.classList.toggle("is-open", isOpen);
    categoryMenuToggle.setAttribute("aria-expanded", String(isOpen));

    if (categoryMenuDropdown) {
        categoryMenuDropdown.setAttribute("aria-hidden", String(!isOpen));
    }
};

const scheduleCategoryMenuOpen = (isOpen, delay = 150) => {
    if (menuHoverTimeout) {
        clearTimeout(menuHoverTimeout);
        menuHoverTimeout = null;
    }
    menuHoverTimeout = setTimeout(() => {
        setCategoryMenuOpen(isOpen);
    }, delay);
};

const activateMegaCategory = (categoryId) => {
    megaMenuCategories.forEach((category) => {
        const isActive = category.dataset.megaCategory === categoryId;

        category.classList.toggle("is-active", isActive);
        category.setAttribute("aria-selected", String(isActive));
        category.setAttribute("aria-expanded", String(isActive));
    });

    megaMenuPanels.forEach((panel) => {
        panel.classList.toggle(
            "is-active",
            panel.dataset.megaPanel === categoryId
        );
    });
};

const focusMegaCategoryByOffset = (currentCategory, offset) => {
    const currentIndex = megaMenuCategories.indexOf(currentCategory);
    const nextIndex =
        (currentIndex + offset + megaMenuCategories.length) %
        megaMenuCategories.length;
    const nextCategory = megaMenuCategories[nextIndex];

    nextCategory?.focus();
    activateMegaCategory(nextCategory?.dataset.megaCategory);
};

const ensureProductCardFactory = async () => {
    if (typeof window.createProductCard === "function") {
        return;
    }
    await loadScript("scripts/product-cards-home.js");
};

const getMegaMenuProductAliases = (segment) => {
    const normalized = normalizeMenuValue(segment);

    if (!normalized) {
        return [];
    }

    const aliases = {
        fashion: [
            "fashion",
            "clothing",
            "apparel",
            "wear",
            "shirt",
            "shirts",
            "tshirt",
            "tshirts",
            "hoodie",
            "hoodies",
            "jacket",
            "jackets",
            "jeans",
            "denim",
            "dress",
            "dresses",
            "top",
            "tops",
            "traditional",
            "kurti",
            "women",
            "men",
            "kids",
            "footwear",
            "watch",
            "watches",
            "bag",
            "bags",
            "accessory",
            "accessories"
        ],
        "men s clothing": [
            "men",
            "male",
            "boy",
            "shirt",
            "shirts",
            "tshirt",
            "tshirts",
            "hoodie",
            "hoodies",
            "jacket",
            "jackets",
            "jeans",
            "denim",
            "pants",
            "trousers"
        ],
        "women s clothing": [
            "women",
            "female",
            "girl",
            "dress",
            "dresses",
            "top",
            "tops",
            "kurti",
            "kurta",
            "saree",
            "traditional",
            "skirt",
            "leggings",
            "jeans"
        ],
        "kids wear": [
            "kids",
            "kid",
            "children",
            "child",
            "boys",
            "girls",
            "tshirt",
            "shirts",
            "dresses",
            "hoodie"
        ],
        footwear: [
            "footwear",
            "shoe",
            "shoes",
            "sandal",
            "sandals",
            "sneaker",
            "sneakers",
            "slipper",
            "slippers",
            "loafer",
            "loafers"
        ],
        watches: ["watch", "watches", "smartwatch", "smart watches"],
        bags: ["bag", "bags", "backpack", "backpacks", "handbag", "handbags", "sling", "tote"],
        accessories: ["accessory", "accessories", "belt", "belted", "sunglass", "sunglasses", "wallet", "wallets", "scarf", "scarves"],
        electronics: ["electronics", "mobile", "mobiles", "laptop", "laptops", "tablet", "tablets", "smartwatch", "smartwatches", "headphone", "headphones", "camera", "cameras", "gaming", "console"],
        grocery: ["grocery", "fruit", "fruits", "vegetable", "vegetables", "dairy", "milk", "snack", "snacks", "beverage", "beverages", "juice", "tea", "coffee", "cooking", "oil", "rice", "flour", "dal", "spice", "household", "cleaner", "detergent", "soap"],
        toys: ["toys", "educational", "learning", "block", "blocks", "doll", "dolls", "rc", "remote", "vehicle", "outdoor"],
        stationery: ["stationery", "notebook", "notebooks", "planner", "planners", "diary", "journal", "pen", "pens", "pencil", "pencils", "school", "bag", "bags", "office", "art", "paint", "sketch"],
        "home and kitchen": ["home", "kitchen", "furniture", "cookware", "storage", "decor", "bedding", "appliance", "appliances"],
        beauty: ["beauty", "skincare", "haircare", "makeup", "fragrance", "fragrances", "personal", "care"],
        sports: ["sports", "cricket", "football", "gym", "equipment", "cycling", "outdoor"],
        "pet supplies": ["pet", "pets", "dog", "cat", "food", "grooming", "toy", "toys", "accessory", "accessories"],
        automotive: ["automotive", "car", "bike", "helmet", "helmets", "engine", "oil", "cleaning", "accessory", "accessories"]
    };

    return aliases[normalized] || [normalized];
};

const matchesMegaMenuProduct = (product, categoryLabel, subcategoryLabel) => {
    const productValues = [
        product?.category,
        product?.subcategory,
        product?.sub_category,
        product?.subCategory,
        product?.name,
        product?.description,
        ...(Array.isArray(product?.tags) ? product.tags : []),
        ...(Array.isArray(product?.specifications) ? Object.values(product.specifications) : [])
    ];

    const normalizedProductText = productValues
        .map((value) => normalizeMenuValue(value))
        .filter(Boolean)
        .join(" ");

    const normalizedCategory = normalizeMenuValue(categoryLabel);
    const normalizedSubcategory = normalizeMenuValue(subcategoryLabel);

    if (!normalizedProductText) {
        return false;
    }

    const categoryAliases = getMegaMenuProductAliases(normalizedCategory);
    const subcategoryAliases = getMegaMenuProductAliases(normalizedSubcategory);

    const isCategoryMatch = !normalizedCategory || categoryAliases.some((alias) => normalizedProductText.includes(alias));
    const isSubcategoryMatch = !normalizedSubcategory || subcategoryAliases.some((alias) => normalizedProductText.includes(alias));

    return isCategoryMatch && isSubcategoryMatch;
};

const getMegaMenuFallbackProducts = (products, categoryLabel) => {
    const productPool = Array.isArray(products) ? products : [];

    const getPopularityScore = (product) =>
        Number(product?.num_reviews ?? product?.numReviews ?? product?.reviewCount ?? 0) +
        Number(product?.rating ?? 0) * 10;

    const getBestSellingScore = (product) =>
        Number(product?.sales_count ?? product?.salesCount ?? product?.orderCount ?? product?.orders_count ?? 0);

    const getNewestScore = (product) =>
        Number(product?.id ?? product?.productId ?? 0);

    const featured = productPool
        .filter((product) => Number(product?.featured) === 1 || String(product?.featured) === "true")
        .sort((a, b) => getPopularityScore(b) - getPopularityScore(a) || getBestSellingScore(b) - getBestSellingScore(a) || getNewestScore(b) - getNewestScore(a));

    const popular = productPool
        .filter((product) => getPopularityScore(product) > 0)
        .sort((a, b) => getPopularityScore(b) - getPopularityScore(a) || getBestSellingScore(b) - getBestSellingScore(a) || getNewestScore(b) - getNewestScore(a));

    const bestSelling = productPool
        .filter((product) => getBestSellingScore(product) > 0)
        .sort((a, b) => getBestSellingScore(b) - getBestSellingScore(a) || getPopularityScore(b) - getPopularityScore(a) || getNewestScore(b) - getNewestScore(a));

    const newest = [...productPool].sort((a, b) => getNewestScore(b) - getNewestScore(a));

    if (featured.length) {
        return featured;
    }

    if (popular.length) {
        return popular;
    }

    if (bestSelling.length) {
        return bestSelling;
    }

    return newest;
};

const getFashionProducts = async () => {
    const products = await fetchMegaMenuProducts();
    return Array.isArray(products) ? products : [];
};

const getProductsForFashionSubcategory = (fashionProducts, subcategory) => {
    const normalizedSubcategory = normalizeMenuValue(subcategory);

    if (!normalizedSubcategory) {
        return [];
    }

    const subcategoryMatches = (fashionProducts || []).filter((product) =>
        matchesMegaMenuProduct(product, "Fashion", subcategory)
    );

    if (subcategoryMatches.length) {
        return subcategoryMatches;
    }

    const categoryMatches = (fashionProducts || []).filter((product) =>
        matchesMegaMenuProduct(product, "Fashion", "")
    );

    if (categoryMatches.length) {
        return getMegaMenuFallbackProducts(categoryMatches, "Fashion");
    }

    return getMegaMenuFallbackProducts(fashionProducts, "Fashion");
};

const renderFashionMenuProducts = async (link) => {
    const fashionProductsContainer =
        document.querySelector("[data-fashion-products]");

    if (!fashionProductsContainer || !link) {
        return;
    }

    const linkUrl = new URL(link.href);
    const subcategory = linkUrl.searchParams.get("subcategory");

    if (!subcategory) {
        return;
    }

    const requestId = ++fashionMenuPreviewRequestId;

    fashionProductsContainer.innerHTML =
        `
        <div class="mega-menu-skeleton" aria-busy="true" aria-label="Loading products">
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
        </div>
        `;
    fashionProductsContainer.setAttribute("aria-busy", "true");

    try {
        await ensureProductCardFactory();

        const baseProducts = await getFashionProducts();
        const products = getProductsForFashionSubcategory(baseProducts, subcategory);

        if (requestId !== fashionMenuPreviewRequestId) {
            return;
        }

        document
            .querySelectorAll("#mega-panel-fashion .category-menu-link, #mega-panel-fashion .fashion-category-card")
            .forEach((categoryLink) => {
                categoryLink.classList.toggle("is-preview-active", categoryLink === link);
            });

        if (!products.length) {
            fashionProductsContainer.innerHTML = `
                <div class="mega-menu-empty-state">
                    <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <h4 class="empty-state-heading">No products in this category yet</h4>
                    <p class="empty-state-desc">Try another subcategory or browse the full fashion collection for more options.</p>
                    <a href="shop.html?category=Fashion" class="empty-state-cta">Explore Fashion</a>
                </div>
            `;
            return;
        }

        fashionProductsContainer.innerHTML = products
            .slice(0, 2)
            .map((product) => {
                const productLink = getProductLink(product, "Fashion", subcategory);
                return `
                    <a class="mega-menu-product-link" href="${productLink}">
                        ${window.createProductCard(product, null, {
                            compact: true,
                            showActions: false
                        })}
                    </a>
                `;
            })
            .join("");
    } catch {
        if (requestId !== fashionMenuPreviewRequestId) {
            return;
        }

        fashionProductsContainer.innerHTML = `
            <div class="mega-menu-empty-state">
                <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <h4 class="empty-state-heading">Preview Unavailable</h4>
                <p class="empty-state-desc">We were unable to load products for this category right now. Try again in a moment.</p>
                <a href="shop.html?category=Fashion" class="empty-state-cta">Explore Fashion</a>
            </div>
        `;
    } finally {
        if (requestId === fashionMenuPreviewRequestId) {
            fashionProductsContainer.removeAttribute("aria-busy");
        }
    }
};

categoryMenuToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    setCategoryMenuOpen(
        !categoryMenuItem?.classList.contains("is-open")
    );
});

categoryMenuToggle?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setCategoryMenuOpen(true);
        const activeCat = megaMenuCategories.find((cat) => cat.classList.contains("is-active")) || megaMenuCategories[0];
        activeCat?.focus();
    }
});

categoryMenuItem?.addEventListener("mouseenter", () => {
    if (window.matchMedia("(min-width: 1025px)").matches) {
        scheduleCategoryMenuOpen(true, 120);
    }
});

categoryMenuItem?.addEventListener("mouseleave", () => {
    if (window.matchMedia("(min-width: 1025px)").matches) {
        scheduleCategoryMenuOpen(false, 220);
    }
});

megaMenuCategories.forEach((category) => {
    category.addEventListener("mouseenter", () => {
        if (window.matchMedia("(min-width: 1025px)").matches) {
            activateMegaCategory(category.dataset.megaCategory);
        }
    });

    category.addEventListener("click", () => {
        activateMegaCategory(category.dataset.megaCategory);
        setCategoryMenuOpen(true);
    });

    category.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            focusMegaCategoryByOffset(category, 1);
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            focusMegaCategoryByOffset(category, -1);
        }

        if (event.key === "ArrowRight") {
            event.preventDefault();
            const activePanel = document.querySelector(`.mega-menu-panel[data-mega-panel="${category.dataset.megaCategory}"]`);
            const firstLink = activePanel?.querySelector("a, button");
            firstLink?.focus();
        }

        if (event.key === "Home") {
            event.preventDefault();
            megaMenuCategories[0]?.focus();
            activateMegaCategory(megaMenuCategories[0]?.dataset.megaCategory);
        }

        if (event.key === "End") {
            event.preventDefault();
            const lastCategory =
                megaMenuCategories[megaMenuCategories.length - 1];
            lastCategory?.focus();
            activateMegaCategory(lastCategory?.dataset.megaCategory);
        }

        if (event.key === "Escape") {
            event.preventDefault();
            setCategoryMenuOpen(false);
            categoryMenuToggle?.focus();
        }
    });
});

megaMenuPanels.forEach((panel) => {
    panel.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            const activeCat = megaMenuCategories.find((cat) => cat.dataset.megaCategory === panel.dataset.megaPanel);
            activeCat?.focus();
        }

        if (event.key === "Escape") {
            event.preventDefault();
            setCategoryMenuOpen(false);
            categoryMenuToggle?.focus();
        }
    });
});

categoryMenuDropdown?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
        setCategoryMenuOpen(false);
    });
});

categoryMenuItem?.addEventListener("focusout", (event) => {
    if (!categoryMenuItem.contains(event.relatedTarget)) {
        setCategoryMenuOpen(false);
    }
});

document.addEventListener("click", (event) => {
    if (categoryMenuItem && !categoryMenuItem.contains(event.target)) {
        setCategoryMenuOpen(false);
    }
});

document.addEventListener("keydown", (event) => {
    if (
        event.key === "Escape" &&
        categoryMenuItem?.classList.contains("is-open")
    ) {
        setCategoryMenuOpen(false);
        categoryMenuToggle?.focus();
    }
});

categoryMenuLinks.forEach((link) => {
    const linkUrl = new URL(link.href);
    const linkCategory = linkUrl.searchParams.get("category");
    const linkSubcategory = linkUrl.searchParams.get("subcategory");

    if (
        currentUrl.pathname.endsWith(linkUrl.pathname.split("/").pop()) &&
        currentCategory &&
        linkCategory === currentCategory &&
        (!currentSubcategory || linkSubcategory === currentSubcategory)
    ) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
    }
});

const fashionSubcategoryLinks = Array.from(
    document.querySelectorAll("#mega-panel-fashion .category-menu-link, #mega-panel-fashion .fashion-category-card")
);

fashionSubcategoryLinks.forEach((link) => {
    link.addEventListener("mouseenter", () => {
        if (window.matchMedia("(min-width: 1025px)").matches) {
            renderFashionMenuProducts(link);
        }
    });

    link.addEventListener("focus", () => {
        renderFashionMenuProducts(link);
    });

    link.addEventListener("touchstart", () => {
        renderFashionMenuProducts(link);
    }, { passive: true });
});

renderFashionMenuProducts(
    fashionSubcategoryLinks.find((link) => link.classList.contains("active")) ||
    fashionSubcategoryLinks[0]
);

if (currentCategory) {
    categoryMenuToggle?.classList.add("active");

    const activeCategory = megaMenuCategories.find((category) => {
        const panel = document.getElementById(
            category.getAttribute("aria-controls")
        );

        return panel?.querySelector(
            `a[href*="category=${encodeURIComponent(currentCategory).replace(/%20/g, "%20")}"]`
        );
    });

    if (activeCategory?.dataset.megaCategory) {
        activateMegaCategory(activeCategory.dataset.megaCategory);
    }
}

mobileCategoryAccordions.forEach((accordion) => {
    const toggle = accordion.querySelector(".mobile-category-toggle");
    const panel = accordion.querySelector(".mobile-subcategory-panel");
    const hasCurrentLink = Boolean(panel?.querySelector(".active"));

    if (hasCurrentLink) {
        accordion.classList.add("is-open");
        toggle?.setAttribute("aria-expanded", "true");
    }

    toggle?.addEventListener("click", () => {
        const isOpen = accordion.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(isOpen));
    });
});
    await initializeGroceryMegaMenu();
    await initializeToyMegaMenu();
    await initializeStationeryMegaMenu();
    // notify components ready
    document.dispatchEvent(new CustomEvent("componentsLoaded"));
}

const user = JSON.parse(localStorage.getItem("user"));

const profileDropdown = document.getElementById("profile-dropdown");

if (user && profileDropdown) {
    profileDropdown.setAttribute("data-loggedin", "true");
}


// ===== NAVBAR SEARCH =====
//
// The navbar ships on 28 of the 29 pages, so whatever this widget does, it does
// almost everywhere. What it used to do (#1458):
//
//   1. `dropdown.innerHTML = ... ${p.name} ...` -- the product name straight
//      into innerHTML, unescaped. Names are stored raw (`sanitizeString` on the
//      backend is a `.trim()`), so anything that can create or rename a product
//      had script execution against every shopper who typed into this box.
//
//   2. Bare `<div>`s with click listeners. No role, no tabindex, no aria, no
//      keydown handler -- arrow keys did nothing, the list was unreachable
//      without a pointer, and nothing announced that it had opened.
//
//   3. It filtered `window.allProducts`, a global that only `index.html`
//      populates (script.js only calls `fetchAllProducts()` when
//      `#featured-products` or `#new-arrivals-container` is on the page). On the
//      other 27 pages the array was undefined and typing did nothing at all. On
//      the one page where it worked, the fetch is `/products?limit=50`, so it
//      only ever searched the first fifty rows in the catalogue.
//
// It is a combobox now, backed by `/products/search-suggestions`, which has
// existed and gone uncalled since #165.

/** How long to wait after the last keystroke before asking the server. */
const SEARCH_SUGGEST_DEBOUNCE_MS = 250;

/** Shortest query worth a round trip. */
const SEARCH_SUGGEST_MIN_LENGTH = 2;

function initNavbarSearch() {
    const input = document.getElementById("searchInput");
    const dropdown = document.getElementById("suggestionsDropdown");

    if (!input || !dropdown) {
        return;
    }

    // The markup ships as a plain `<div>`; the roles are applied here rather
    // than in navbar.html so that a browser with JavaScript disabled is not
    // told about a listbox that will never have options in it.
    // Keeps the existing id: `#header .suggestions-dropdown` styles it and
    // `aria-controls` needs something to point at, and there is no reason for
    // those to be two different handles on one element.
    const listboxId = dropdown.id || "suggestionsDropdown";
    dropdown.id = listboxId;
    dropdown.setAttribute("role", "listbox");
    dropdown.setAttribute("aria-label", "Product suggestions");

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", listboxId);
    input.setAttribute("aria-haspopup", "listbox");

    // A screen reader gets no notification from a div appearing, so the result
    // count is announced separately. Polite rather than assertive: it must not
    // interrupt the letters the user is still typing.
    const status = document.createElement("p");
    status.className = "visually-hidden";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    dropdown.parentNode.appendChild(status);

    let suggestions = [];
    let activeIndex = -1;
    let debounceTimer = null;
    // Monotonic request counter. A response is only rendered if it is still the
    // newest one asked for, so a slow reply for "sh" cannot land on top of a
    // fast reply for "shirt" and put stale rows under a newer query.
    //
    // A counter rather than an AbortController because `AppUtils.apiRequest`
    // creates its own controller for its timeout and overwrites `signal` in the
    // fetch options (utils.js:598), so a signal passed in from here is ignored.
    // The request is not cancelled -- its result is discarded on arrival.
    let requestSequence = 0;

    const optionId = (index) => `navbarSearchOption${index}`;

    const closeList = () => {
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        suggestions = [];
        activeIndex = -1;
    };

    const setActive = (index) => {
        const options = Array.from(dropdown.querySelectorAll('[role="option"]'));
        if (!options.length) {
            return;
        }

        // Wrap, so ArrowUp from the top lands on the bottom entry.
        activeIndex = (index + options.length) % options.length;

        options.forEach((option, i) => {
            const isActive = i === activeIndex;
            option.classList.toggle("is-active", isActive);
            option.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        // Focus stays in the input throughout -- that is what makes it a
        // combobox rather than a menu. `aria-activedescendant` is how the
        // active option is communicated without moving focus.
        input.setAttribute("aria-activedescendant", optionId(activeIndex));
        options[activeIndex].scrollIntoView({ block: "nearest" });
    };

    const goToProduct = (product) => {
        if (!product || !product.id) {
            return;
        }
        // To the product, not to a search for its name. Sending someone who
        // picked a specific product to a results page to pick it again was the
        // old behaviour and it never made sense.
        window.location.href = `product.html?id=${encodeURIComponent(product.id)}`;
    };

    const renderList = (items, query) => {
        suggestions = items;
        activeIndex = -1;

        if (!items.length) {
            // Say so rather than closing silently. "Nothing happened" is
            // indistinguishable from "the feature is broken", which is what the
            // previous version looked like on 27 of 28 pages.
            dropdown.innerHTML =
                `<p class="suggestion-empty">No products match “${AppUtils.escapeHTML(query)}”</p>`;
            dropdown.style.display = "block";
            input.setAttribute("aria-expanded", "true");
            input.removeAttribute("aria-activedescendant");
            status.textContent = "No matching products";
            return;
        }

        dropdown.innerHTML = items
            .map((product, index) => `
                <div
                    class="suggestion-item"
                    role="option"
                    id="${optionId(index)}"
                    aria-selected="false"
                    data-index="${index}"
                >${AppUtils.escapeHTML(product.name || "Product")}</div>
            `)
            .join("");

        dropdown.style.display = "block";
        input.setAttribute("aria-expanded", "true");
        input.removeAttribute("aria-activedescendant");
        status.textContent =
            `${items.length} product${items.length === 1 ? "" : "s"} found. `
            + "Use the up and down arrow keys to review them.";
    };

    const fetchSuggestions = async (query) => {
        const sequence = ++requestSequence;

        try {
            const response = await AppUtils.apiRequest(
                `/products/search-suggestions?q=${encodeURIComponent(query)}`
            );

            // Superseded while in flight: the user has typed since, so this
            // answer is for a query that is no longer on screen.
            if (sequence !== requestSequence) {
                return;
            }

            // This endpoint answers with a bare array rather than the usual
            // `{ success, ... }` envelope, so both shapes are accepted -- the
            // widget should not break if the endpoint is ever standardised.
            const items = Array.isArray(response)
                ? response
                : AppUtils.safeArray(response && response.products);

            renderList(items.slice(0, 8), query);
        } catch (error) {
            if (sequence !== requestSequence) {
                return;
            }
            // A failed lookup closes the list rather than leaving a stale one
            // on screen. Nothing is shown to the shopper: the input still
            // works -- Enter searches the shop page -- so there is nothing for
            // them to do about it.
            console.error("Search suggestions failed:", error);
            closeList();
        }
    };

    input.addEventListener("input", () => {
        const query = input.value.trim();

        clearTimeout(debounceTimer);

        if (query.length < SEARCH_SUGGEST_MIN_LENGTH) {
            // Bump the counter so a reply still in flight for a longer query
            // cannot reopen the list the user has just emptied.
            requestSequence++;
            closeList();
            return;
        }

        debounceTimer = setTimeout(
            () => fetchSuggestions(query),
            SEARCH_SUGGEST_DEBOUNCE_MS
        );
    });

    input.addEventListener("keydown", (event) => {
        const isOpen = input.getAttribute("aria-expanded") === "true";

        switch (event.key) {
            case "ArrowDown":
                if (isOpen && suggestions.length) {
                    event.preventDefault();
                    setActive(activeIndex + 1);
                }
                break;

            case "ArrowUp":
                if (isOpen && suggestions.length) {
                    event.preventDefault();
                    // From "nothing highlighted", up goes to the last option.
                    // `setActive(activeIndex - 1)` would compute -2 there, and
                    // -2 modulo a 3-item list is 1 -- the middle row, which is
                    // neither end and looks arbitrary.
                    setActive(
                        activeIndex <= 0
                            ? suggestions.length - 1
                            : activeIndex - 1
                    );
                }
                break;

            case "Home":
                if (isOpen && suggestions.length) {
                    event.preventDefault();
                    setActive(0);
                }
                break;

            case "End":
                if (isOpen && suggestions.length) {
                    event.preventDefault();
                    setActive(suggestions.length - 1);
                }
                break;

            case "Enter": {
                // With an option highlighted, Enter takes that option. With
                // none, it falls through to the full search it always did --
                // typing a query and pressing Enter must not stop working
                // because a dropdown happens to be open.
                if (isOpen && activeIndex >= 0) {
                    event.preventDefault();
                    goToProduct(suggestions[activeIndex]);
                    return;
                }

                const query = input.value.trim();
                if (query) {
                    window.location.href =
                        `shop.html?search=${encodeURIComponent(query)}`;
                }
                break;
            }

            case "Escape":
                if (isOpen) {
                    // Stop it reaching anything else that closes on Escape --
                    // the first press belongs to the list.
                    event.stopPropagation();
                    closeList();
                }
                break;

            case "Tab":
                // Moving on: the list must not stay open over the next control.
                closeList();
                break;

            default:
                break;
        }
    });

    // Delegated, so it survives the list being re-rendered on every keystroke.
    dropdown.addEventListener("click", (event) => {
        const option = event.target.closest('[role="option"]');
        if (!option) {
            return;
        }
        goToProduct(suggestions[Number(option.dataset.index)]);
    });

    // Hovering moves the highlight, so pointer and keyboard cannot end up
    // disagreeing about which option Enter would take.
    dropdown.addEventListener("mousemove", (event) => {
        const option = event.target.closest('[role="option"]');
        if (option) {
            setActive(Number(option.dataset.index));
        }
    });

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".search-container")) {
            closeList();
        }
    });

    input.addEventListener("blur", () => {
        // Deferred: a click on an option fires blur before it fires click, so
        // closing immediately would remove the option before it is chosen.
        setTimeout(closeList, 150);
    });
}

// Exposed so the widget can be exercised directly by tests and, if it is ever
// wanted, re-initialised after a navbar re-render.
window.initNavbarSearch = initNavbarSearch;

// init
document.addEventListener("DOMContentLoaded", () => {
    initializeComponents();
});
