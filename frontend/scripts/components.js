// ===== THEME - Apply INSTANTLY before anything loads =====
document.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-theme');
    }
});

// Prevent browser/session scroll restoration
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

// load component
const loadComponent = async (id, file) => {
    const element = document.getElementById(id);
    if (!element) return false;
    element.innerHTML = `<div class="component-loading">Loading...</div>`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => { controller.abort(); }, 8000);
        const response = await fetch(file, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`Failed to load ${file}`);
        const data = await response.text();
        element.innerHTML = data;
        return true;
    } catch (error) {
        console.error(`Error loading component: ${file}`, error);
        element.innerHTML = `<div class="component-error">Failed to load component.</div>`;
        return false;
    }
};

// initialize components
async function initializeComponents() {
    await Promise.all([
        loadComponent("navbar", "./components/navbar.html"),
        loadComponent("footer", "./components/footer.html")
    ]);

    // ===== THEME TOGGLE - runs AFTER navbar is loaded =====
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
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

    // ===== SEARCH AUTOCOMPLETE (Issue #165) =====
    initSearchAutocomplete();

    // notify components ready
    document.dispatchEvent(new CustomEvent("componentsLoaded"));
}

// ===== SEARCH AUTOCOMPLETE FUNCTIONALITY =====
function initSearchAutocomplete() {
    // Search input might be inside navbar.html (loaded dynamically)
    const searchInput = document.getElementById('searchInput');
    const dropdown = document.getElementById('suggestionsDropdown');

    // If not found, wait for componentsLoaded event (navbar might still be loading)
    if (!searchInput || !dropdown) {
        document.addEventListener('componentsLoaded', () => {
            attachAutocompleteListeners();
        });
    } else {
        attachAutocompleteListeners();
    }
}

function attachAutocompleteListeners() {
    const searchInput = document.getElementById('searchInput');
    const dropdown = document.getElementById('suggestionsDropdown');
    if (!searchInput || !dropdown) return;

    // Debounce helper
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    async function fetchSuggestions(query) {
        if (query.trim() === '') {
            dropdown.style.display = 'none';
            return;
        }
        try {
            const res = await fetch(`/api/products/search-suggestions?q=${encodeURIComponent(query)}`);
            const products = await res.json();
            renderSuggestions(products, query);
        } catch (err) {
            console.error('Autocomplete error:', err);
            dropdown.style.display = 'none';
        }
    }

    function renderSuggestions(products, query) {
        if (!products.length) {
            dropdown.style.display = 'none';
            return;
        }
        const regex = new RegExp(`(${query})`, 'gi');
        const html = products.map(p => {
            const highlighted = p.name.replace(regex, '<span class="suggestion-highlight">$1</span>');
            return `<div class="suggestion-item" data-id="${p.id}" data-name="${p.name}">${highlighted}</div>`;
        }).join('');
        dropdown.innerHTML = html;
        dropdown.style.display = 'block';

        // Attach click listeners to each suggestion
        document.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = `/product.html?id=${item.dataset.id}`;
            });
        });
    }

    const debouncedFetch = debounce(fetchSuggestions, 300);
    searchInput.addEventListener('input', (e) => debouncedFetch(e.target.value));

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

// Profile dropdown handling
const user = JSON.parse(localStorage.getItem("user"));
const profileDropdown = document.getElementById("profile-dropdown");
if (user && profileDropdown) {
    profileDropdown.setAttribute("data-loggedin", "true");
}

// Initialize everything when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    initializeComponents();
});