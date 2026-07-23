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
                !btn ||
                btn.id === 'share-btn' ||
                btn.classList.contains('share-option')
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
        AppUtils.getCartCount(
            cart
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
    initializeNewsletter();
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

window.addEventListener(
    AppUtils.CART_UPDATED_EVENT,
    updateCartCount
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

function initializeNewsletter() {
    const form = document.getElementById('newsletter-form');
    if (!form) return;

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const emailInput = document.getElementById('newsletter-email');
        const feedback = document.getElementById('newsletter-feedback');
        const btnText = form.querySelector('.btn-text');
        const btnLoader = form.querySelector('.btn-loader');
        const btn = document.getElementById('newsletter-btn');
        
        const email = emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        feedback.style.display = 'block';
        
        if (!email) {
            feedback.innerHTML = '<span style="color: #e74c3c;"><i class="fas fa-exclamation-circle"></i> Email is required.</span>';
            return;
        }
        
        if (!emailRegex.test(email)) {
            feedback.innerHTML = '<span style="color: #e74c3c;"><i class="fas fa-exclamation-circle"></i> Please enter a valid email address.</span>';
            return;
        }
        
        // Simulate API call
        btnText.style.display = 'none';
        btnLoader.style.display = 'inline-block';
        btn.disabled = true;
        feedback.style.display = 'none';
        
        setTimeout(() => {
            btnText.style.display = 'inline-block';
            btnLoader.style.display = 'none';
            btn.disabled = false;
            
            emailInput.value = '';
            feedback.style.display = 'block';
            feedback.innerHTML = '<span style="color: #2ecc71;"><i class="fas fa-check-circle"></i> Thanks for subscribing! Check your inbox.</span>';
            
            setTimeout(() => {
                feedback.style.display = 'none';
            }, 5000);
        }, 1500);
    });
}
