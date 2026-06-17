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
        loadComponent(
            "navbar",
            "./components/navbar.html"
        ),

        loadComponent(
            "footer",
            "./components/footer.html"
        )
    ]);

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