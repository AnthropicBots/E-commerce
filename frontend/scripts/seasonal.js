(function() {
    let allProducts = [];
    let currentProducts = [];
    let currentPage = 1;
    let totalPages = 1;
    let currentSearch = "";
    let currentCategory = "all"; 
    let currentSort = "";

    const fallbackProducts = [
        { 
            id: '301', 
            name: 'Cotton Summer Dress', 
            price: 350.00, 
            image: 'assets/images/dress.jpg', 
            category: 'dress', 
            brand: 'Nyraa',
            stock: 12, 
            rating: 5 
        },
        { 
            id: '302', 
            name: 'Mens Comfort', 
            price: 599.00, 
            image: 'assets/images/shirt-shorts.webp', 
            category: 'tshirt', 
            brand: 'Levis',
            stock: 25, 
            rating: 4 
        },
        { 
            id: '303', 
            name: 'Kids cute frock', 
            price: 499.00, 
            image: 'assets/images/kids_skirt_top.jpg', 
            category: 'skirt-top', 
            brand: 'Zara',
            stock: 8, 
            rating: 5 
        },
        { 
            id: '304', 
            name: 'Girt Dress', 
            price: 459.00, 
            image: 'assets/images/girl_dress.webp', 
            category: 'dress', 
            brand: 'Zara',
            stock: 8, 
            rating: 5 
        }
    ];

    const elements = {
        searchInput: document.getElementById("search-input"),
        filterButtons: document.querySelectorAll(".filter-btn"),
        sortSelect: document.getElementById("sort-select"),
        productContainer: document.getElementById("product-container")
    };

    async function fetchProducts(page = 1) {
        try {
            currentPage = page;
            if (elements.productContainer) {
                elements.productContainer.innerHTML = `<div class="loading-products">Loading Seasonal collection...</div>`;
            }

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
                useFallbackData();
            }

            applySorting();
            renderProducts(currentProducts);
        } catch (error) {
            console.warn("MEN FETCH ERROR (Using Fallback Data):", error);
            useFallbackData();
            applySorting();
            renderProducts(currentProducts);
        }
    }

    function useFallbackData() {
        if (currentCategory === 'all') {
            currentProducts = [...fallbackProducts];
        } else {
            currentProducts = fallbackProducts.filter(p => 
                p.category.toLowerCase() === currentCategory.toLowerCase()
            );
        }
        
        if (currentSearch) {
            currentProducts = currentProducts.filter(p => 
                p.name.toLowerCase().includes(currentSearch.toLowerCase())
            );
        }
        totalPages = 1;
    }

    function applySorting() {
        if (!currentSort) return;
        
        if (currentSort === "low-high") {
            currentProducts.sort((a, b) => a.price - b.price);
        } else if (currentSort === "high-low") {
            currentProducts.sort((a, b) => b.price - a.price);
        }
    }

    function renderProducts(products) {
        if (!elements.productContainer) return;
        elements.productContainer.innerHTML = "";

        if (products.length === 0) {
            elements.productContainer.innerHTML = `<p class="no-products">No products found in Seasonal Collection.</p>`;
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
        
        const starsHtml = '<i class="fas fa-star"></i>'.repeat(product.rating || 5);
        
        div.innerHTML = `
            <img src="${product.image || 'assets/images/default.jpg'}" alt="${AppUtils.escapeHTML(product.name)}" onerror="this.src='assets/images/default.jpg';">
            <div class="des">
                <span>${AppUtils.escapeHTML(product.brand || 'Adidas')}</span>
                <h5>${AppUtils.escapeHTML(product.name)}</h5>
                <div class="star">
                    ${starsHtml}
                </div>
                <h4>₹${Number(product.price).toFixed(2)}</h4>
            </div>
            <button class="add-to-cart-btn" data-id="${product.id}">
                <i class="fal fa-shopping-cart cart"></i>
            </button>
        `;
        
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

        div.addEventListener('click', () => {
            window.location.href = `product.html?id=${product.id}`;
        });
        
        return div;
    }

    function initListeners() {
        if (elements.searchInput) {
            elements.searchInput.addEventListener("input", AppUtils.debounce((e) => {
                currentSearch = e.target.value.trim();
                fetchProducts(1);
            }, 300));
        }

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

        if (elements.sortSelect) {
            elements.sortSelect.addEventListener("change", (e) => {
                currentSort = e.target.value;
                applySorting();
                renderProducts(currentProducts);
            });
        }
    }

    initListeners();
    fetchProducts(1);

})();