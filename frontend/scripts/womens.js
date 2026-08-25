/**
 * E-Commerce Website - Women's Collection Logic
 * Handles product fetching, local fallbacks, filtering, sorting, and UI rendering.
 */
(function() {
    // 1. STATE VARIABLES
    let allProducts = [];
    let currentProducts = [];
    let currentPage = 1;
    let totalPages = 1;
    let currentSearch = "";
    let currentCategory = "all"; 
    let currentSort = "";

    // 2. HARDCODED FALLBACK DATA (Backend offline hone par yeh show hoga)
    const fallbackProducts = [
        { 
            id: '201', 
            name: 'Pure Traditional Vibe', 
            price: 899.00, 
            image: 'assets/images/WomenTraditional.jpeg', 
            category: 'traditionalWear', 
            brand: 'Ekaya',
            stock: 12, 
            rating: 5 
        },
        { 
            id: '202', 
            name: 'Comfort Fit Classic Denim Jeans', 
            price: 680.00, 
            image: 'assets/images/womensJeans.webp', 
            category: 'Jeans', 
            brand: 'Levis',
            stock: 25, 
            rating: 4 
        },
        { 
            id: '203', 
            name: 'Compfy Tops', 
            price: 350.00, 
            image: 'assets/images/womensTop.jpg', 
            category: 'tops', 
            brand: 'Zara',
            stock: 8, 
            rating: 5 
        }
    ];

    // 3. DOM ELEMENTS
    const elements = {
        searchInput: document.getElementById("search-input"),
        filterButtons: document.querySelectorAll(".filter-btn"),
        sortSelect: document.getElementById("sort-select"),
        productContainer: document.getElementById("product-container")
    };

    // 4. FETCH PRODUCTS FUNCTION (With API & Fallback handling)
    async function fetchProducts(page = 1) {
        try {
            currentPage = page;
            if (elements.productContainer) {
                AppUtils.renderSkeletonState(elements.productContainer, 8);
            }

            // Backend URL parameters create karna
            const params = new URLSearchParams({
                page: currentPage,
                limit: 8,
                
            });

            if (currentSearch) params.append("search", currentSearch);
            if (currentCategory !== "all") params.append("category", currentCategory);

            // API Call checking
            const data = await AppUtils.apiRequest(`/products?${params.toString()}`);

            if (data && data.success && data.products && data.products.length > 0) {
                currentProducts = data.products;
                totalPages = Number(data.totalPages || 1);
            } else {
                // Agar API respond kare par data na ho, toh local data use karein
                useFallbackData();
            }

            applySorting();
            renderProducts(currentProducts);
        } catch (error) {
            console.warn("WOMEN FETCH ERROR (Using Fallback Data):", error);
            // BACKEND OFF HONE PAR YEH BLOCK CHALEGA
            useFallbackData();
            applySorting();
            renderProducts(currentProducts);
        }
    }

    // Helper to filter fallback array locally based on user selection
    function useFallbackData() {
        if (currentCategory === 'all') {
            currentProducts = [...fallbackProducts];
        } else {
            currentProducts = fallbackProducts.filter(p => 
                p.category.toLowerCase() === currentCategory.toLowerCase()
            );
        }
        
        // Search filter injection for fallback
        if (currentSearch) {
            currentProducts = currentProducts.filter(p => 
                p.name.toLowerCase().includes(currentSearch.toLowerCase())
            );
        }
        totalPages = 1;
    }

    // 5. SORTING LOGIC
    function applySorting() {
        if (!currentSort) return;
        
        if (currentSort === "low-high") {
            currentProducts.sort((a, b) => a.price - b.price);
        } else if (currentSort === "high-low") {
            currentProducts.sort((a, b) => b.price - a.price);
        }
    }

    // 6. UI RENDERING FUNCTIONS
    function renderProducts(products) {
        if (!elements.productContainer) return;
        elements.productContainer.innerHTML = ""; // Container clear karna

        if (products.length === 0) {
            elements.productContainer.innerHTML = `<p class="no-products">No products found in Women's Collection.</p>`;
            return;
        }

        products.forEach(product => {
            const productCard = createProductCard(product);
            elements.productContainer.appendChild(productCard);
        });
    }

    function createProductCard(product) {
        const div = document.createElement("div");
        div.className = "pro";
        
        // Dynamic Stars rendering logic
        const starsHtml = '<i class="fas fa-star"></i>'.repeat(product.rating || 5);
        
        div.innerHTML = `
            <img src="${AppUtils.defaultImage(product.image)}" alt="${AppUtils.escapeHTML(product.name)}" onerror="AppUtils.handleImageError(this)">
            <div class="des">
                <span>${AppUtils.escapeHTML(product.brand || 'Adidas')}</span>
                <h5>${AppUtils.escapeHTML(product.name)}</h5>
                <div class="star">
                    ${starsHtml}
                </div>
                <h4>₹${Number(product.price).toFixed(2)}</h4>
            </div>
            <div class="card-action-btns" style="display: flex; gap: 6px; position: absolute; bottom: 20px; right: 10px; z-index: 2;">
                <button class="compare-btn-card" data-id="${product.id}" title="Compare Product" style="background: #e8f6ea; color: #088178; border: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                    <i class="fas fa-balance-scale"></i>
                </button>
                <button class="add-to-cart-btn" data-id="${product.id}">
                    <i class="fal fa-shopping-cart cart"></i>
                </button>
            </div>
        `;
        
        // Cart click setup helper
        const cartBtn = div.querySelector('.add-to-cart-btn');
        if (cartBtn) {
            cartBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof Cart !== 'undefined' && Cart.addItem) {
                    Cart.addItem(product.id);
                } else {
                    console.log(`Added product ${product.id} to cart (Simulated)`);
                    if (typeof showToast === 'function') showToast("Added to cart!");
                }
            });
        }

        // Compare click setup helper
        const compareBtn = div.querySelector('.compare-btn-card');
        if (compareBtn) {
            compareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof AppUtils !== "undefined" && typeof AppUtils.addToCompare === "function") {
                    AppUtils.addToCompare(product.id);
                } else if (typeof addToCompare === "function") {
                    addToCompare(product.id);
                }
            });
        }

        // Product details page redirection (Optional feature if implemented in your ui.js)
        div.addEventListener('click', () => {
            window.location.href = `product.html?id=${product.id}`;
        });
        
        return div;
    }

    // 7. CONTROLS & LISTENERS INITIALIZATION
    function initListeners() {
        // Search Input Control
        if (elements.searchInput) {
            elements.searchInput.addEventListener("input", AppUtils.debounce((e) => {
                currentSearch = e.target.value.trim();
                fetchProducts(1);
            }, 300));
        }

        // Category Filter Buttons Control
        if (elements.filterButtons) {
            elements.filterButtons.forEach(btn => {
                btn.addEventListener("click", (e) => {
                    elements.filterButtons.forEach(b => b.classList.remove("active-filter"));
                    e.target.classList.add("active-filter");
                    currentCategory = e.target.dataset.category || "all";
                    fetchProducts(1);
                });
            });
        }

        // Sort Select Control
        if (elements.sortSelect) {
            elements.sortSelect.addEventListener("change", (e) => {
                currentSort = e.target.value;
                applySorting();
                renderProducts(currentProducts);
            });
        }
    }

    // Initialize execution
    initListeners();
    fetchProducts(1);

})();