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

const initializeCustomCursor = async () => {
    await loadStylesheet(
        "styles/custom-cursor.css"
    );

    await loadScript(
        "scripts/custom-cursor.js"
    );
};

// initialize components
async function initializeComponents() {
    try {
        await initializeCustomCursor();
    } catch (error) {
        console.error(
            "Failed to load custom cursor:",
            error
        );
    }

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
    const navSearchInput = document.getElementById("searchInput");
    if (navSearchInput) {
        navSearchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const query = navSearchInput.value.trim();
                if (query) {
                    window.location.href = `shop.html?search=${encodeURIComponent(query)}`;
                }
            }
        });

        navSearchInput.addEventListener("input", () => {
            const query = navSearchInput.value.trim();
            const dropdown = document.getElementById("suggestionsDropdown");
            if (!dropdown) return;

            if (!query) {
                dropdown.style.display = "none";
                dropdown.innerHTML = "";
                return;
            }

            const allProducts = window.allProducts || [];
            const matches = allProducts
                .filter(p => p.name?.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 5);

            if (!matches.length) {
                dropdown.style.display = "none";
                return;
            }

            dropdown.innerHTML = matches.map(p => `
                <div class="suggestion-item" style="padding:8px;cursor:pointer;border-bottom:1px solid #eee;">
                    ${p.name}
                </div>
            `).join("");

            dropdown.style.display = "block";

            dropdown.querySelectorAll(".suggestion-item").forEach((item, i) => {
                item.addEventListener("click", () => {
                    window.location.href = `shop.html?search=${encodeURIComponent(matches[i].name)}`;
                });
            });
        });

        document.addEventListener("click", (e) => {
            if (!e.target.closest(".search-container")) {
                const dropdown = document.getElementById("suggestionsDropdown");
                if (dropdown) dropdown.style.display = "none";
            }
        });
    }

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

const fetchMegaMenuProducts = async () => {
    if (!window.AppUtils) {
        return [];
    }

    if (megaMenuProductsCache) {
        return megaMenuProductsCache;
    }

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
    }

    return megaMenuProductsCache;
};

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

const getFashionProducts = async () => {
    const products = await fetchMegaMenuProducts();
    const fashionCategories = ["fashion", "footwear", "watches", "bags", "accessories"];
    return products.filter((p) => fashionCategories.includes(String(p.category || "").toLowerCase()));
};

const getProductsForFashionSubcategory = (fashionProducts, subcategory) => {
    const sub = subcategory.toLowerCase();
    return fashionProducts.filter((p) => {
        // If product already has subcategory from API, use it first
        const pSub = String(p.subcategory || p.sub_category || p.subCategory || "").toLowerCase();
        if (pSub && pSub.includes(sub)) {
            return true;
        }

        const name = String(p.name || "").toLowerCase();
        const desc = String(p.description || "").toLowerCase();
        const text = `${name} ${desc}`;

        if (sub.includes("men's clothing") || sub === "men") {
            return (text.includes("men") || text.includes("boy") || text.includes("shirt") || text.includes("jeans") || text.includes("hoodie")) && !text.includes("women");
        }
        if (sub.includes("women's clothing") || sub === "women") {
            return text.includes("women") || text.includes("girl") || text.includes("dress") || text.includes("kurti") || text.includes("top");
        }
        if (sub.includes("kids")) {
            return text.includes("kid") || text.includes("child") || text.includes("boy") || text.includes("girl") || text.includes("traditional");
        }
        if (sub.includes("footwear") || sub.includes("shoes") || sub.includes("sneaker")) {
            return text.includes("shoe") || text.includes("shoes") || text.includes("sneaker") || text.includes("sneakers") || text.includes("footwear");
        }
        if (sub.includes("watches") || sub.includes("watch")) {
            return text.includes("watch");
        }
        if (sub.includes("bags") || sub.includes("bag")) {
            return text.includes("bag") || text.includes("handbag") || text.includes("backpack");
        }
        if (sub.includes("accessories")) {
            return text.includes("accessory") || text.includes("accessories") || text.includes("sunglasses") || text.includes("belt");
        }
        return false;
    });
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

    fashionProductsContainer.innerHTML =
        `<p class="mega-menu-empty">Loading products...</p>`;

    try {
        await ensureProductCardFactory();

        const products = getProductsForFashionSubcategory(
            await getFashionProducts(),
            subcategory
        );

        document
            .querySelectorAll("#mega-panel-fashion .category-menu-link, #mega-panel-fashion .fashion-category-card")
            .forEach((categoryLink) => {
                categoryLink.classList.toggle("is-preview-active", categoryLink === link);
            });

        fashionProductsContainer.innerHTML = products.length
            ? products.slice(0, 2)
                .map((product) =>
                    `<a class="mega-menu-product-link" href="${link.href}">
                        ${window.createProductCard(product, null, {
                            compact: true,
                            showActions: false
                        })}
                    </a>`
                )
                .join("")
            : `<p class="mega-menu-empty">No products available in this category.</p>`;
    } catch {
        fashionProductsContainer.innerHTML =
            `<p class="mega-menu-empty">No products available in this category.</p>`;
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


// init
document.addEventListener("DOMContentLoaded", () => {
    initializeComponents();
});
