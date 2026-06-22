// mobile menu functionality
function initializeMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const mobileCloseBtn = document.getElementById('mobile-close-btn');
    const mobileLinks = document.querySelectorAll('.mobile-link');

    if (!mobileMenuBtn || !mobileMenuOverlay || !mobileCloseBtn) {
        console.warn('Mobile menu elements not found');
        return;
    }

    // open mobile menu
    mobileMenuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileMenuOverlay.classList.add('active');
        mobileMenuBtn.classList.add('hidden');
        document.body.style.overflow = 'hidden';
    });

    // close mobile menu via close button
    mobileCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMobileMenu();
    });

    // close mobile menu when clicking on links
    mobileLinks.forEach(link => {
        link.addEventListener('click', () => {
            closeMobileMenu();
        });
    });

    // close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
        if (mobileMenuOverlay.classList.contains('active')) {
            if (!mobileMenuOverlay.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
                closeMobileMenu();
            }
        }
    });

    // close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileMenuOverlay.classList.contains('active')) {
            closeMobileMenu();
        }
    });
}

function closeMobileMenu() {
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (mobileMenuOverlay) {
        mobileMenuOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    if (mobileMenuBtn) {
        mobileMenuBtn.classList.remove('hidden');
    }
}



// sticky header
function initializeStickyHeader() {
    const header =
        document.getElementById(
            "header"
        );

    if (
        !header
    ) {
        return;
    }

    let ticking =
        false;

    window.addEventListener(
        "scroll",
        () => {
            if (
                !ticking
            ) {
                window.requestAnimationFrame(
                    () => {

                        header.style.boxShadow =
                            window.scrollY > 80
                                ? "0 5px 25px rgba(0,0,0,0.15)"
                                : "0 5px 15px rgba(0,0,0,0.06)";

                        ticking =
                            false;
                    }
                );

                ticking =
                    true;
            }
        }
    );
}

// ripple effect
function initializeRippleEffect() {
    document.addEventListener(
        "click",
        (event) => {
            const btn =
                event.target.closest(
                    "button"
                );

            if (
                !btn
            ) {
                return;
            }

            const ripple =
                document.createElement(
                    "span"
                );

            ripple.style.cssText =
                `
                    position:absolute;
                    width:10px;
                    height:10px;
                    background:rgba(255,255,255,0.7);
                    border-radius:50%;
                    transform:scale(0);
                    animation:ripple 0.6s linear;
                    pointer-events:none;
                    top:${event.offsetY}px;
                    left:${event.offsetX}px;
                `;

            if (
                getComputedStyle(
                    btn
                ).position ===
                "static"
            ) {

                btn.style.position =
                    "relative";
            }

            btn.style.overflow =
                "hidden";

            btn.appendChild(
                ripple
            );

            setTimeout(
                () => {

                    ripple.remove();

                },
                600
            );
        }
    );
}

// global cart count badge
function updateCartCount() {
    const cart =
        AppUtils.getCart();

    const total =
        cart.reduce(
            (
                sum,
                item
            ) => {
                return (
                    sum +
                    (
                        parseInt(
                            item.qty
                        ) || 0
                    )
                );
            },
            0
        );

    // Update mobile cart badge
    const mobileBadge = document.getElementById('mobile-cart-badge');
    if (mobileBadge) {
        mobileBadge.innerText = total;
        mobileBadge.style.display = total > 0 ? 'inline-block' : 'none';
    }

    // Update desktop cart badge
    const desktopBadge = document.getElementById('cart-badge');
    if (desktopBadge) {
        desktopBadge.innerText = total;
        desktopBadge.style.display = total > 0 ? 'inline-block' : 'none';
    }

    let badge =
        document.getElementById(
            "cart-count"
        );

    const cartIcon =
        document.querySelector(
            ".fa-shopping-bag"
        )?.parentElement;

    if (
        !cartIcon
    ) {
        return;
    }

    if (
        !badge
    ) {
        badge =
            document.createElement(
                "span"
            );

        badge.id =
            "cart-count";

        badge.style.cssText =
            `
                position:absolute;
                top:-8px;
                right:-10px;
                background:red;
                color:white;
                font-size:12px;
                padding:2px 6px;
                border-radius:50%;
                min-width:20px;
                text-align:center;
            `;

        if (
            getComputedStyle(
                cartIcon
            ).position ===
            "static"
        ) {

            cartIcon.style.position =
                "relative";
        }

        cartIcon.appendChild(
            badge
        );
    }

    badge.innerText =
        total;

    badge.style.display =
        total > 0
            ? "block"
            : "none";
}

// wishlist count badge
function updateWishlistCount() {
    const total =
        AppUtils.getWishlist().length;

    const badge =
        document.getElementById(
            "wishlist-badge"
        );

    if (!badge) {
        return;
    }

    badge.innerText =
        total;

    badge.style.display =
        total > 0
            ? "inline-block"
            : "none";
}

let uiInitialized = false;

// initialize ui
function initializeUI() {
    if (uiInitialized) return;
    console.log("🎯 InitializeUI called");
    initializeMobileMenu();
    initializeStickyHeader();
    initializeRippleEffect();
    updateCartCount();
    updateWishlistCount();
    initializeThemeToggle();
    uiInitialized = true;
}

// init after components load - PRIMARY METHOD
document.addEventListener(
    "componentsLoaded",
    () => {
        console.log("🎊 componentsLoaded event fired!");
        initializeUI();
    }
);

// expose globally
window.updateCartCount =
    updateCartCount;

window.updateWishlistCount =
    updateWishlistCount;

// Theme Toggle
function initializeThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    if (!themeToggle || !themeIcon) return;

    const savedTheme = localStorage.getItem('theme') || 'light';

    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        themeIcon.textContent = '☀️';
    }

    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');

        const isDark = document.body.classList.contains('dark-theme');

        localStorage.setItem(
            'theme',
            isDark ? 'dark' : 'light'
        );

        themeIcon.textContent =
            isDark ? '☀️' : '🌙';
    });
}