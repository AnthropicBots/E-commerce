console.log(
    "Dashboard initialized successfully!"
);

// auth
const dashboardUser =
    requireAuth();

// redirect fallback
if (!dashboardUser) {
    window.location.href =
        "login.html";
}

// initialize dashboard
function initializeDashboard() {
    try {
        // overview
        if (
            typeof loadDashboardUserData
            === "function"
        ) {
            loadDashboardUserData(
                dashboardUser
            );
        }

        // tabs
        if (
            typeof initializeDashboardTabs
            === "function"
        ) {
            initializeDashboardTabs();
        }

        // wishlist
        if (
            typeof renderDashboardWishlist
            === "function"
        ) {
            renderDashboardWishlist();
        }

        // cart
        if (
            typeof renderDashboardCart
            === "function"
        ) {
            renderDashboardCart();
        }

        // orders
        if (
            typeof renderDashboardOrders
            === "function"
        ) {
            renderDashboardOrders();
        }

    } catch (error) {
        console.error(
            "DASHBOARD INIT ERROR:",
            error
        );

        notify(
            "Failed to initialize dashboard",
            "error"
        );
    }
}

// keyboard shortcuts
document.addEventListener(
    "keydown",
    (event) => {

        // wishlist tab
        if (
            event.altKey
            &&
            event.key === "1"
        ) {
            window.location.hash =
                "wishlist";

            window.location.reload();
        }

        // orders tab
        if (
            event.altKey
            &&
            event.key === "2"
        ) {
            window.location.hash =
                "orders";

            window.location.reload();
        }

        // settings tab
        if (
            event.altKey
            &&
            event.key === "3"
        ) {
            window.location.hash =
                "settings";

            window.location.reload();
        }
    }
);

// initialize
document.addEventListener(
    "DOMContentLoaded",
    initializeDashboard
);