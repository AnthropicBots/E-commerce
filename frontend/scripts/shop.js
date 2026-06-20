// PRODUCTS STATE
(function(){
    let allProducts = [];
let filteredProducts = [];
// PAGINATION STATE
let currentPage = 1;
let totalPages = 1;
let currentSearch = "";
let currentCategory = "all";
let currentSort = "";
let currentProducts = [];
let showAllHoodies = false;

// Local fallback sample products (used when backend returns no products)
const fallbackProducts = [
    // T-SHIRTS (~5)
    { id: 'ft1', name: 'Classic Cotton T-Shirt', description: 'Summer collection soft cotton tee.', price: 19.99, image: 'data:image/jpeg;base64,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', category: 'T-Shirts', stock: 50, rating: 4 },
    { id: 'ft2', name: 'Graphic Summer Tee', description: 'Vibrant graphic tee for summer.', price: 24.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRyY_WkHP0-WBtjcePjG1sLSoMouKgAaav1hg&s', category: 'T-Shirts', stock: 30, rating: 5 },
    { id: 'ft3', name: 'Striped Casual Tee', description: 'Comfortable striped tee.', price: 21.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQtKfu-ZwefkG7NDs5d3PhgFBSgTHhEN01ENQ&s', category: 'T-Shirts', stock: 22, rating: 4 },
    { id: 'ft4', name: 'V-Neck Tee', description: 'Soft v-neck t-shirt.', price: 17.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTsSS_5k6nLRteqeDYfhRBiA65nBAAXQA2Nwg&s', category: 'T-Shirts', stock: 18, rating: 4 },
    { id: 'ft5', name: 'Pocket Tee', description: 'Casual pocket tee.', price: 18.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRuw0Ab_4tzp6NAd8VHYZzV9OYF59aklaeEeA&s', category: 'T-Shirts', stock: 12, rating: 4 },

    // HOODIES (~5)
    { id: 'fh1', name: 'Cozy Hoodie', description: 'Lightweight hoodie for cool evenings.', price: 39.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSPkTgVrxAbFAb4VMnRmqKfLq1mlPwKCf3PQg&s', category: 'Hoodies', stock: 40, rating: 4 },
    { id: 'fh2', name: 'Zip-Up Hoodie', description: 'Casual zip hoodie.', price: 44.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQEk5MDT4E_9vjAF7bci9TCMuPYw_yUrdJ1Gw&s', category: 'Hoodies', stock: 40, rating: 4 },
    { id: 'fh3', name: 'Pullover Hoodie', description: 'Cozy pullover style.', price: 42.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTua6NALhSutNTSeAx3JEGPipEhDhEoUAoISw&s', category: 'Hoodies', stock: 28, rating: 4 },
    { id: 'fh4', name: 'Fleece Hoodie', description: 'Warm fleece hoodie.', price: 49.99, image: 'data:image/jpeg;base64,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', category: 'Hoodies', stock: 14, rating: 5 },
    { id: 'fh5', name: 'Sport Hoodie', description: 'Performance hoodie for workouts.', price: 46.99, image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxITEhUSExMWFRUXGRcYGBgYEBcYFxgXGBgVFBcXFxUYHSggGBolGxgVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQFy0dHR0tLS0rLS0tLS0rLS0tLS0rLS0tLS0rLS0tLS0tKy0tKy0rLS0tLS0rLS0rKys3LS0tLf/AABEIAOEA4QMBIgACEQEDEQH/xAAcAAACAgMBAQAAAAAAAAAAAAAFAgMEBgcAAQj/xABPEAABAwIDAwcGCQoDBwUBAAABAgMRACEEEjEFQVEGEyJxgZGxBSKhwdHwFCNCUuEzchUkYoKy8UPC0jT/2gAMAwEAAhEDEQAPwDkNtK3u/3aeJrYCN9K3u2iUQAE77DwoIsOv4t8KNt26gw1sgwRBk6H9UimVm1Uo8W3rRiWddtK2SzqKMS2Pn5+dKihTa2A2NTDD9lFpYk6Ufbwo3JoE1nDGaaDCmKOwuGBb1f6Uf8AVwR1ZJ7In5/KoFaYTbtqcYYAT8+2iCvbUrJ1dqBX6PfSdaJXDkxCmCBt2wD/AD9leNhzrrzj3f1qp/SJxE57VhWIKLmfKY6zgZVMdiif16aFk4xwAFbN5Qxe5eyiUtlRlBOacmZtFiCdZ5czsRwj6vcdBlJ01FtLS6qpMIug385neue4ThCtgziGu3s/WKhSMggXzrOp0wz6iPXXsNLeL3XtX7iJeukIxUMztmMaSYPaKu5eDWuXXfR7bRC8gNYG0CoWww3/AJH215wnHLesWrwjrKCd9G2f98NU5c1ALdw3cIpficJ8/PjTe43jUDJPKTyqwK/QmDQt3Dc6eiwCDv8AkO3lQr4f5/lpQIMRhtCe6gjhtPKasWJsaEeNA4ixMd1Agu2qha3TfEYfWhXs6UC517qhZaOuW4qArRA+WsqXJ4V5QObPoShc2xpMiJ21MeVbdGcIrkB1zQh7e1NdKKs4QJCrlILAsS0b7lY3PYK16HE512g2+sSYjVYjzq/DknRJukdx/BaaYe1tQOGX7Y+B/BKc2R1o+e+pOmsu6kW31Sfn50qaxYqV7fV86Is29vntoy1S0J+e6jLS6wN6xbNT2BroOWvtjegkst1j2A0XZvTdWyo6zK7HSSEVWMKvNmICjkNTrABHsRuR41Uek/G7uDx6X7RXN6FQQdRGdiVYAyARzpO1qTj/ABy7ZvhA3WzQy5VOUbAtIJLGScoOwHMwBsP0uJxF1QXdCQLKqnWMQGPVAIkZm1mCBykU3wfRZMYzYu3dOW4wdlUQ9osSSCTqZbMc0CewagWC30dsYO36a1lUiM8gsHUbjeQ3YRzEa1vTLnfSzjeKS+9pS2HyAZkzBjLQwKtrPVZTvt7Kqlx2dizFmY7kksxPeTqa6v0y6F3cbiTi7TItprFolmJBLqDbIAAJ0VFJJ7RvrFLt8CTKwF4s4JyAIgF1ZKhlkzujaGQQykbkVFIbmIuoMme4APuh2yiQ0xBja4/7bdpoa5dLEsxJJ3JJJPiTvRWLEMwIA6zQBtBjbyig7i0DngfSK9hhlRuoTJUgETESOY74I2qxYTpVcdILqrGSGKpAG8HbXSBtM86oKnlRYc7fPzoKCyP0wxQXN6S03dkHwg/1p70Q6S/Wrhs3FCXILIVnKwUEsCGJIMAneDB2587vgazv8711f6CujOY3cbdXqlWtWp5zpdcd0dQHvbsoGr24Bns58h3+RihiNI8fHfT4UdxDDNbd7bnX5gjtmhHtmCdu4e331BBdtaSaFxFsRTImVoXE29Kikd+1rQzWu7lTS8mvbQjDWgUX7W9CNbpviF7qAuJQBZaypYr2gN+q4c6zOnfQ2CCTb9I+RSu8gf5e2ln106jLE8/nep8Ysi2JjT+VZnjsxs3W75OZdHFlbReUcMdR6yk5ZGpjwAmmmGt61Wuj1qLp/RYjwJQ1cLNuINWTX3bOV3ehHo+qPnejrFge7Xs75+dqiC9Xz+fxoxTJnQCNP2fdrv41Uei14c57h/QivRpAnnrtvPz4yPOQHkddDrvzB+A91e3LgRWdhoo0j7xMQByJJyjluO2gh+rXXDW7P98ysF2OUx6xnTSdjXHuMYC/ZuuuID556xaSSe0k7zX0Z0OwXolDP693n2xJYjun4UX0k6M2MWsXEGbk3MUR83cA4ziMNeW7Ychl0G7BlJ9Rl+8p7PAiCAR2PgXH7eOtn0Li3fgl8O/WUsNS1rYsvPQyOY5mmdIvo9vYZs9rVVMgjl7BI8p8KqjYi/h7zQTaJJYQQBGsMpmJjYjWeYNalHdeGq3obqFRCzKESpRxDqQeWp07Kr3EOhGHugIrsiqoA0VtAoCiYBYwOcmgOjX0gLd9Hbvki4R/fFVC3VXdbqqxhiJ1HZqBuegYNsPdGa2yuAYJRywBgNGhjZgfOqjmGL+i9FWVxFwxP3F3MDt7qofSbg31a5kN0XDz0II8QSa+jrnC0YQS37gPtC1yz6VbVi3lRZzEy0mdB21FcvRY1pjbsWxaztch8wASCZWDJJ5GQv7VCskEaEsdl5zsBFdM6EfRkXy4jGjQ6rY7ez0pHL/SO6TutAh6A9BXx1z010FMKDvqDd19W33drcthrt9AcMwa2lVFUIqgBVAgKo0AjlW2Aw4RZCgCAEA5AcwOQ2jw79CRQJOP9HPTE3bbE3I1QnRgOSk+qfHTw3qmYjQHTWDM6a99dQs3Ov3AE+yqh01wIW4txfVugnuzCM3tkHxJqCsFYGlRX0kGjF0WDr31HfiDUUnuprQly3zpo1QXE0oE1xaCdKaYhKDcUC/J4ew17REd3417QKCbKjVP3ide3urXGqSqQCery17KYtwjDgE+kuSM3Zusz9zu86l4Rwu3iGVHuNb0EFYEkgkg9U8lrUS8oejVvrA/5kb+JBrVttWqTYXBCzijZBJCIdTEmfRMZ/aIqwWl21rNUQQRA5HnI93lRaAa76H8/Ke3+la2UkLO+o7xyHug0Uy7Dee/bb+cVBEiqddYjY78p18KjFo3r9u0NcoFx9pmStoE95DN42hUjJDGDpyJI7p7OUU06DYbODiGGt5847rY0tATyygN4u1VD0NGMtWRtatKPNpJ9wWnbVXsO08Rv9wtj9yrCaRahu2gRqKqXSboPh8SpDLB5EaMD2qeR9x51cSK0cUR878a4BisCXzIMRYjVspOnbeUerEet36MJNFdBuNXcPGZ7ioSBqAbLMQHA9J6ocrETPr/AHZLDs9i0Gu6jae4jwI1HlSzo3w5S2NcAQ+LurGoBFpbdoyFImWRjr21dhVjOmiWLRfEDIRERqHDSBkEnraGVlgNOsw1rl3G7GMxt9sSbL2rdx4Q3AQADovKT4gHWY2ruvC+iGCs3Guph0DsSS2XUE/5deqNNhArzifDLL37SvbVlmcrBWUkaiQwM66+QpsVToV0Iwio7Kr3Llu41trrZCztbgH0asCltc0jWSY9bar3wnh5toBdc3HjWTI7Y2EgbbaxrNB9ED9le/5zG/8AybtO6bHrGvKyvaDy398/6T+FB8ZwXpsIyDVklk8VnTzUkedHIvVfvU/gaoprGMQwqx8Cfcd9V3jS5MUrcrg940I/A+dOeDXOuRWJ21elnWlWLlGbKYksY/SJY+8n200SkeG4nauYjFWjIaw6Bp5+kth1KnsifMGtVkZw7E3JAYdXt2NMb2JRFZ2YKqglmJAVQNSSToBUOHNpttfA61tds9VgjlGKkBgASpIgMAdCQddaopvTLD2vqqYm02fPcl3Fw3c0i5Ch2J6qNmAUQBmaAJINLe+Mo2jNlntHt8Ne/nFXDjuYcPxNu4xK2jZNucjD0edUlXtgBhIcQesDMnURz1iGGhB8x7O6s3KTumxmEuLIBHrTyHVJ7O8VmVbTsGaIH3oWZKwV1MjRufKgbbQQTOhnTX5/Oi+ltqbdtxrqfIET8BXk89tvF4rjneeE/8Axe1/n9351lUz2V7Xl/E56jq3SVv7LiACdMLdJA0A/s94SYOvLQiNu7LQOh0/U+IjafqX+69Xbj9xWwuIbMkfVr8SWDT6G4IAPPrRBHM84qidB3JXEJICkWCeU5fSxPdqfkV9bLLWNr2447yka2bROJd4hMmUEiBmlNh3kEzt8HVppUHfYgjXTx/OocXlnKrBt5juGwnc7Hw7Z0nwcAA9nhtt+etcsMrlG/JjMbwSdMOHNc+2VGZrS9cgRKE9XNOu+YmB29xquYTDnMLyF2yKHeDlcNu0TsABuJ0111q6dJrBFosjZSp3BygqRBk9gAnyoHgPTCzh1S3etm4VzqXUKWyHLlIJ8GB7RlOtd8enGqtjA5LXQ85wWeXt5iNJzjtOh7TqaU3kIMMCD2EQY8DVkxFkQxtYdgmZnUsVzKjER1d4gCD4dtI8fcVyCoYEAhsxmTJII8iJ76o7t0BtMMOuq5tyCCSCe+nYhuge4Ahfjq//Z', category: 'Hoodies', stock: 32, rating: 4 },

    // JACKETS (~5)
    { id: 'fj1', name: 'Windbreaker Jacket', description: 'Water-resistant windbreaker.', price: 59.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRUk5pMwkIaq5m32eSfcLfuTTYXPd_gZxmDrg&s', category: 'Jackets', stock: 20, rating: 4 },
    { id: 'fj2', name: 'Denim Jacket', description: 'Classic denim jacket.', price: 69.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS742gOUs3PYj6pGiEL7vxtCYtcdntbkSzg1Q&s', category: 'Jackets', stock: 15, rating: 5 },
    { id: 'fj3', name: 'Leather Jacket', description: 'Stylish faux-leather jacket.', price: 119.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS3Zm904oGz9FyfDetC1LY41uK35Udmgl01bQ&s', category: 'Jackets', stock: 8, rating: 5 },
    { id: 'fj4', name: 'Bomber Jacket', description: 'Classic bomber jacket.', price: 89.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTT_Z8bOxgvwY4ahNxGg4TkryUn2gowHQL51w&s', category: 'Jackets', stock: 11, rating: 4 },
    { id: 'fj5', name: 'Denim Trucker', description: 'Lightweight trucker jacket.', price: 74.99, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQOazqR3Pt7KgK3iTwtReHvCLpQaIKhphOTjA&s', category: 'Jackets', stock: 6, rating: 4 }
];

function normalizeCategoryString(s) {
    return String(s || '').toLowerCase().replace(/[-\s]/g, '');
}

function categoriesMatch(a, b) {
    const na = normalizeCategoryString(a);
    const nb = normalizeCategoryString(b);
    if (!na || !nb) return false;
    return na === nb || na.startsWith(nb) || nb.startsWith(na) || na.includes(nb) || nb.includes(na);
}

// SHOP PAGE ELEMENTS
const elements = {
    searchInput:
        document.getElementById(
            "search-input"
        ),

    filterButtons:
        document.querySelectorAll(
            ".filter-btn"
        ),

    sortSelect:
        document.getElementById(
            "sort-select"
        ),

    productContainer:
        document.getElementById(
            "product-container"
        )
};

// FETCH PRODUCTS
async function fetchProducts(
    page = 1
) {

    try {

        currentPage =
            page;

        if (
            elements.productContainer
        ) {

            elements.productContainer.innerHTML =
                `
                    <div class="loading-products">
                        Loading products...
                    </div>
                `;
        }

        // query params
        const params =
            new URLSearchParams({

                page:
                    currentPage,

                limit: 8
            });

        // search
        if (
            currentSearch
        ) {

            params.append(
                "search",
                currentSearch
            );
        }

        // category
        if (
            currentCategory !== "all"
        ) {

            params.append(
                "category",
                currentCategory
            );
        }

        // fetch from backend
        const data =
            await AppUtils.apiRequest(
                `/products?${params.toString()}`
            );

        if (!data.success) {
            const normCat = normalizeCategoryString(currentCategory);
            const fallback = normCat === 'all'
                ? fallbackProducts
                : fallbackProducts.filter(p => categoriesMatch(p.category, currentCategory));
            if (fallback.length > 0) {
                currentProducts = fallback;
                totalPages = 1;
                applySorting();
                renderPagination();
            } else {
                renderEmptyState("No products found.");
            }
            return;
        }

        currentProducts = Array.isArray(data.products) ? data.products : [];

        // If backend returned no products for the selected category/search,
        // fall back to local sample products so the shop isn't empty.
        if (!currentProducts || currentProducts.length === 0) {
            const normCat = normalizeCategoryString(currentCategory);

            // if category is 'all' show all fallback products
            const fallback = normCat === 'all'
                ? fallbackProducts
                : fallbackProducts.filter(p => categoriesMatch(p.category, currentCategory));

            totalPages =
                Number(
                    data.totalPages || 1
                );
            if (fallback.length > 0) {
                    currentProducts = fallback;
                    totalPages = 1;
                }
            }

        // sorting
        applySorting();

        // pagination ui
        renderPagination();

    } catch (error) {
        console.error(
            "SHOP FETCH ERROR:",
            error
        );
        const normCat = normalizeCategoryString(currentCategory);
        const fallback = normCat === 'all'
            ? fallbackProducts
            : fallbackProducts.filter(p => categoriesMatch(p.category, currentCategory));
        if (fallback.length > 0) {
            currentProducts = fallback;
            totalPages = 1;
            applySorting();
            renderPagination();
        } else {
            renderEmptyState("No products found.");
        }
    }
}

// EMPTY STATE
function renderEmptyState(
    message
) {
    if (
        !elements.productContainer
    ) {
        return;
    }
    elements.productContainer.innerHTML =
        `
            <div class="empty-products">
                <h3>${message}</h3>
            </div>
        `;
}

// STAR RATINGS
function renderStars(
    rating = 5
) {
    const safeRating =
        Math.min(
            Math.max(
                Number(rating) || 5,
                1
            ),
            5
        );

    return Array.from(
        {
            length: safeRating
        },
        () =>
            `
                <i class="fas fa-star"></i>
            `
    ).join("");
}

// PRODUCT CARD
function createProductCard(
    product
) {
    const displayName =
        product.name ||
        "Product";

    const stock =
        Number(product.stock) || 0;

    return `
        <div
            class="pro"
            data-product-id="${product.id}"
        >
            <img
                src="${AppUtils.defaultImage(product.image)}"
                alt="${displayName}"
                loading="lazy"
            >

            <div class="des">
                <span>
                    ${product.category || "Brand"}
                </span>
                <h5>
                    ${displayName}
                </h5>
                <div class="star">
                    ${renderStars(
                        product.rating
                    )}
                </div>
                <h4>
                    ${AppUtils.formatPrice(
                        product.price
                    )}
                </h4>
                <p class="stock-info">
                    ${
                        stock > 0
                            ? `Stock: ${stock}`
                            : "Out Of Stock"
                    }
                </p>
            </div>

            ${
                stock <= 0
                    ? `
                        <button
                            class="out-stock-btn"
                            disabled
                        >
                            Out Of Stock
                        </button>
                    `
                    : `
                        <div style="position: absolute; bottom: 20px; right: 12px; display: flex; gap: 8px; z-index: 2;">
                            <button class="wishlist-btn-shop cart" data-id="${product.id}" aria-label="Add to Wishlist" style="position: relative; bottom: 0; right: 0;">
                                <i class="${ AppUtils.getWishlist().some(item => String(item.id) === String(product.id)) ? 'fas' : 'far' } fa-heart"></i>
                            </button>
                            <button class="add-to-cart-icon cart" aria-label="Add to cart" style="position: relative; bottom: 0; right: 0;">
                                <i class="fal fa-shopping-cart"></i>
                            </button>
                        </div>
                    `
            }
        </div>
    `;
}

// RENDER PRODUCTS
function renderProducts(products = []) {
    if (!elements.productContainer) return;

    if (!Array.isArray(products) || products.length === 0) {
        renderEmptyState("No products found.");
        return;
    }

    elements.productContainer.innerHTML = "";

    // If current category is Hoodies and we're not showing all, limit hoodies to 3
    const isHoodies = currentCategory && categoriesMatch(currentCategory, 'Hoodies');
    let displayList = products;

    if (isHoodies && !showAllHoodies) {
        const hoodies = products.filter(p => categoriesMatch(p.category, 'Hoodies'));
        const others = products.filter(p => !categoriesMatch(p.category, 'Hoodies'));
        displayList = hoodies.slice(0, 3).concat(others);
    }

    const fragment = document.createDocumentFragment();

    displayList.forEach((product) => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = createProductCard(product);
        const card = wrapper.firstElementChild;
        if (card) {
            setupProductCard(card, product);
            fragment.appendChild(card);
        }
    });

    elements.productContainer.appendChild(fragment);

    // Add View More button for Hoodies when applicable
    if (isHoodies && !showAllHoodies) {
        const moreBtn = document.createElement('button');
        moreBtn.textContent = 'View more Hoodies';
        moreBtn.className = 'view-more-hoodies';
        moreBtn.addEventListener('click', () => {
            showAllHoodies = true;
            renderProducts(currentProducts);
        });
        const wrapper = document.createElement('div');
        wrapper.className = 'view-more-wrapper';
        wrapper.appendChild(moreBtn);
        elements.productContainer.appendChild(wrapper);
    }
}

// PRODUCT CARD EVENTS
function setupProductCard(
    card,
    product
) {
    // navigate to product page
    card.addEventListener(
        "click",
        (event) => {
            if (
                event.target.closest(
                    ".add-to-cart-icon"
                )
            ) {
                return;
            }
            window.location.href =
                `product.html?id=${product.id}`;
        }
    );

    // add to cart
    const cartBtn =
        card.querySelector(
            ".add-to-cart-icon"
        );

    if (!cartBtn) {
        return;
    }
    cartBtn.addEventListener(
        "click",
        async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const item = {
                id: product.id,
                name:
                    product.name ||
                    "Product",
                price:
                    parseFloat(
                        product.price
                    ) || 0,
                img:
                    AppUtils.defaultImage(
                        product.image
                    ),
                qty: 1
            };

            try {
                // centralized handler
                if (
                    typeof addToCartFromProduct ===
                    "function"
                ) {
                    await addToCartFromProduct(
                        item
                    );
                    return;
                }

                // fallback cart
                let cart =
                    AppUtils.getCart();

                const existingIndex =
                    cart.findIndex(
                        (p) =>
                            p.id ===
                            item.id
                    );

                    const stock =
                        Number(product.stock) || 0;

                    if (
                        existingIndex >= 0
                    ) {

                        if (
                            cart[existingIndex].qty + 1 >
                            stock
                        ) {

                            AppUtils.notify(
                                `Only ${stock} item(s) available`,
                                "error"
                            );

                            return;
                        }

                        cart[
                            existingIndex
                        ].qty += 1;

                    } else {

                        if (
                            stock <= 0
                        ) {

                            AppUtils.notify(
                                "Product out of stock",
                                "error"
                            );

                            return;
                        }

                        item.stock =
                            stock;

                        cart.push(
                            item
                        );
                    }

                AppUtils.saveCart(
                    cart
                );

                AppUtils.notify(
                    "Added to cart 🛍️",
                    "success"
                );

            } catch (error) {
                console.error(
                    "CART ERROR:",
                    error
                );

                AppUtils.notify(
                    "Failed to add product.",
                    "error"
                );
            }
        }
    );

    // add to wishlist
    const wishlistBtn = card.querySelector(".wishlist-btn-shop");
    if (wishlistBtn) {
        wishlistBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            // Re-use logic from product-actions-home.js if it's available, otherwise fallback
            if (typeof window.toggleWishlist === "function") {
                await window.toggleWishlist(product);
            } else {
                let wishlist = AppUtils.getWishlist();
                const exists = wishlist.some(item => String(item.id) === String(product.id));
                const token = AppUtils.getToken();

                if (exists) {
                    wishlist = wishlist.filter(item => String(item.id) !== String(product.id));
                    AppUtils.notify("Removed from wishlist", "info");
                    if (token) {
                        try {
                            await AppUtils.apiRequest("/wishlist/remove", {
                                method: "POST",
                                body: JSON.stringify({ productId: product.id })
                            });
                        } catch (e) {}
                    }
                } else {
                    wishlist.push(product);
                    AppUtils.notify("Added to wishlist ❤️", "success");
                    if (token) {
                        try {
                            await AppUtils.apiRequest("/wishlist/add", {
                                method: "POST",
                                body: JSON.stringify({ productId: product.id })
                            });
                        } catch (e) {}
                    }
                }
                AppUtils.saveWishlist(wishlist);
                
                // Update DOM icons dynamically
                const buttons = document.querySelectorAll(`.wishlist-btn[data-id="${product.id}"], .wishlist-btn-shop[data-id="${product.id}"]`);
                buttons.forEach(btn => {
                    const icon = btn.querySelector("i");
                    if (icon) {
                        if (exists) {
                            icon.classList.remove("fas");
                            icon.classList.add("far");
                        } else {
                            icon.classList.remove("far");
                            icon.classList.add("fas");
                        }
                    }
                });
            }
        });
    }
}

// SEARCH FILTER
function setupSearch() {

    if (
        !elements.searchInput
    ) {
        return;
    }

    let searchTimeout;

    elements.searchInput.addEventListener(
        "input",
        () => {

            clearTimeout(
                searchTimeout
            );

            searchTimeout =
                setTimeout(
                    () => {

                        currentSearch =
                            elements.searchInput.value
                                .trim();

                        // reset hoodies expansion on new search
                        showAllHoodies = false;

                        fetchProducts(1);

                    },
                    400
                );
        }
    );
}

// CATEGORY FILTER
function setupCategoryFilters() {

    elements.filterButtons.forEach(
        (
            button
        ) => {

            button.addEventListener(
                "click",
                () => {

                    elements.filterButtons.forEach(
                        (
                            btn
                        ) => {

                            btn.classList.remove(
                                "active-filter"
                            );
                        }
                    );

                    button.classList.add(
                        "active-filter"
                    );

                    currentCategory =
                        button.dataset.category
                        || "all";

                    // reset hoodies expansion when category changes
                    showAllHoodies = false;

                    fetchProducts(1);
                }
            );
        }
    );
}

// SORTING
function applySorting() {

    let sortedProducts =
        [...currentProducts];

    if (
        !elements.sortSelect
    ) {

        renderProducts(
            sortedProducts
        );

        return;
    }

    const sortValue =
        elements.sortSelect.value;

    if (
        sortValue === "low-high"
    ) {

        sortedProducts.sort(
            (
                a,
                b
            ) => {

                return (
                    Number(a.price || 0)
                    -
                    Number(b.price || 0)
                );
            }
        );
    }

    if (
        sortValue === "high-low"
    ) {

        sortedProducts.sort(
            (
                a,
                b
            ) => {

                return (
                    Number(b.price || 0)
                    -
                    Number(a.price || 0)
                );
            }
        );
    }

    renderProducts(
        sortedProducts
    );
}

// SORT SELECT
function setupSorting() {
    if (
        !elements.sortSelect
    ) {
        return;
    }
    elements.sortSelect.addEventListener(
        "change",
        applySorting
    );
}

// PAGINATION UI
function renderPagination() {

    let pagination =
        document.getElementById(
            "pagination"
        );

    // auto create pagination
    if (
        !pagination
    ) {

        pagination =
            document.createElement(
                "div"
            );

        pagination.id =
            "pagination";

        pagination.className =
            "pagination";

        elements.productContainer?.after(
            pagination
        );
    }

    pagination.innerHTML =
        "";

    // previous
    const prevBtn =
        document.createElement(
            "button"
        );

    prevBtn.innerText =
        "← Prev";

    prevBtn.className = 
        "pagination-btn";

    prevBtn.disabled =
        currentPage <= 1;

    prevBtn.onclick =
        () => {

            if (
                currentPage > 1
            ) {

                fetchProducts(
                    currentPage - 1
                );
            }
        };

    pagination.appendChild(
        prevBtn
    );

    // page info
    const pageInfo =
        document.createElement(
            "span"
        );

    pageInfo.className = 
        "pagination-info";

    pageInfo.innerText =
        `Page ${currentPage} of ${totalPages}`;

    pagination.appendChild(
        pageInfo
    );

    // next
    const nextBtn =
        document.createElement(
            "button"
        );

    nextBtn.innerText =
        "Next →";

    nextBtn.className = 
        "pagination-btn";

    nextBtn.disabled =
        currentPage >= totalPages;

    nextBtn.onclick =
        () => {

            if (
                currentPage < totalPages
            ) {

                fetchProducts(
                    currentPage + 1
                );
            }
        };

    pagination.appendChild(
        nextBtn
    );
}

// INITIALIZATION
document.addEventListener(
    "DOMContentLoaded",
    () => {
        fetchProducts();
        setupSearch();
        setupCategoryFilters();
        setupSorting();
    }
);
})()