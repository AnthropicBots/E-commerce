// dashboard wishlist elements + notification preference center (#1394, #1429)
const getDashboardElements = () => ({
    wishlistContainer: document.getElementById("wishlist-items"),
    wishlistCount: document.getElementById("wishlist-count"),
    cartContainer: document.getElementById("saved-cart-items"),
    cartCount: document.getElementById("cart-count-dashboard"),
    prefEmail: document.getElementById("pref-price-drop-email"),
    prefInApp: document.getElementById("pref-price-drop-in-app"),
    prefRecoveryEmail: document.getElementById("pref-cart-recovery-email"),
    prefRecoveryInApp: document.getElementById("pref-cart-recovery-in-app"),
    prefUnsubAll: document.getElementById("pref-price-drop-unsub-all"),
    savePrefsBtn: document.getElementById("save-price-drop-prefs"),
    syncBaselinesBtn: document.getElementById("sync-price-drop-baselines"),
    prefStatus: document.getElementById("price-drop-pref-status")
});

function setPrefStatus(message, type) {
    const elements = getDashboardElements();
    if (!elements.prefStatus) return;
    elements.prefStatus.textContent = message || "";
    elements.prefStatus.dataset.type = type || "";
}

function paintPreferenceForm(preferences) {
    const elements = getDashboardElements();
    if (!preferences) return;

    if (elements.prefEmail) {
        elements.prefEmail.checked = Boolean(preferences.priceDropEmail);
    }
    if (elements.prefInApp) {
        elements.prefInApp.checked = Boolean(preferences.priceDropInApp);
    }
    if (elements.prefRecoveryEmail) {
        elements.prefRecoveryEmail.checked = Boolean(preferences.cartRecoveryEmail);
    }
    if (elements.prefRecoveryInApp) {
        elements.prefRecoveryInApp.checked = Boolean(preferences.cartRecoveryInApp);
    }
    if (elements.prefUnsubAll) {
        elements.prefUnsubAll.checked = Boolean(preferences.unsubscribedAll);
    }
}

// paint wishlist from whatever is currently stored
function paintDashboardWishlist() {
    const elements = getDashboardElements();
    const wishlist = AppUtils.getWishlist();

    if (elements.wishlistCount) {
        elements.wishlistCount.innerText = wishlist.length;
    }

    if (!elements.wishlistContainer) {
        return;
    }

    if (!wishlist.length) {
        renderDashboardEmptyState(
            elements.wishlistContainer,
            "No wishlist items found."
        );
        return;
    }

    elements.wishlistContainer.innerHTML = "";

    wishlist.forEach((item) => {
        if (!item) return;
        const card = document.createElement("div");
        card.className = "dashboard-item-card";
        const productId = item.id || item.productId || "";
        card.innerHTML = `
            <img
                src="${AppUtils.defaultImage(item.image || item.img)}"
                alt="${item.name || "Product"}"
            >
            <div class="dashboard-item-info">
                <h4>${item.name || "Product"}</h4>
                <p>${item.brand || ""}</p>
                <strong>${AppUtils.formatPrice(item.price || 0)}</strong>
                <p class="price-drop-hint">Watching for price drops</p>
            </div>
        `;
        card.dataset.productId = productId;
        elements.wishlistContainer.appendChild(card);
    });
}

async function loadPriceDropPreferences() {
    const token = AppUtils.getToken();
    if (!token) {
        setPrefStatus("Sign in to manage price-drop alerts.", "info");
        return;
    }

    try {
        const response = await AppUtils.apiRequest("/wishlist-notify/preferences");
        if (response && response.success && response.preferences) {
            paintPreferenceForm(response.preferences);
            setPrefStatus("Preferences loaded.", "ok");
        }
    } catch (error) {
        console.error("Failed to load price-drop preferences:", error);
        setPrefStatus("Could not load notification preferences.", "error");
    }
}

async function savePriceDropPreferences() {
    const elements = getDashboardElements();
    const token = AppUtils.getToken();
    if (!token) {
        AppUtils.notify("Please sign in first.", "error");
        return;
    }

    const payload = {
        priceDropEmail: Boolean(elements.prefEmail && elements.prefEmail.checked),
        priceDropInApp: Boolean(elements.prefInApp && elements.prefInApp.checked),
        cartRecoveryEmail: Boolean(
            elements.prefRecoveryEmail && elements.prefRecoveryEmail.checked
        ),
        cartRecoveryInApp: Boolean(
            elements.prefRecoveryInApp && elements.prefRecoveryInApp.checked
        ),
        unsubscribedAll: Boolean(elements.prefUnsubAll && elements.prefUnsubAll.checked)
    };

    try {
        const response = await AppUtils.apiRequest("/wishlist-notify/preferences", {
            method: "PUT",
            body: JSON.stringify(payload)
        });

        if (!response || !response.success) {
            throw new Error((response && response.message) || "Save failed");
        }

        paintPreferenceForm(response.preferences);
        setPrefStatus("Preferences saved.", "ok");
        AppUtils.notify("Notification preferences updated.", "success");
    } catch (error) {
        console.error("Failed to save preferences:", error);
        setPrefStatus(error.message || "Could not save preferences.", "error");
        AppUtils.notify(error.message || "Could not save preferences.", "error");
    }
}

async function syncPriceDropBaselines() {
    const token = AppUtils.getToken();
    if (!token) {
        AppUtils.notify("Please sign in first.", "error");
        return;
    }

    setPrefStatus("Syncing wishlist price baselines…", "info");
    try {
        const response = await AppUtils.apiRequest("/wishlist-notify/baselines/sync", {
            method: "POST",
            body: JSON.stringify({})
        });
        if (!response || !response.success) {
            throw new Error((response && response.message) || "Sync failed");
        }
        setPrefStatus(
            `Baselines synced (${response.synced || 0}/${response.total || 0}).`,
            "ok"
        );
        AppUtils.notify("Wishlist baselines synced for price-drop alerts.", "success");
    } catch (error) {
        console.error("Baseline sync failed:", error);
        setPrefStatus(error.message || "Baseline sync failed.", "error");
        AppUtils.notify(error.message || "Baseline sync failed.", "error");
    }
}

async function handleUnsubscribeQueryParam() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("unsubscribe");
    if (!token) return;

    try {
        const response = await AppUtils.apiRequest("/wishlist-notify/unsubscribe", {
            method: "POST",
            body: JSON.stringify({ token })
        });

        if (response && response.success) {
            AppUtils.notify(
                "You are unsubscribed from price-drop emails.",
                "success"
            );
            setPrefStatus("Unsubscribed via email link.", "ok");
            await loadPriceDropPreferences();
        } else {
            AppUtils.notify(
                (response && response.message) || "Unsubscribe link invalid.",
                "error"
            );
        }
    } catch (error) {
        console.error("Unsubscribe failed:", error);
        AppUtils.notify("Unsubscribe failed.", "error");
    }

    // Clean the token out of the address bar without reloading.
    params.delete("unsubscribe");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash || ""}`;
    window.history.replaceState({}, "", next);
}

function bindPriceDropPreferenceControls() {
    const elements = getDashboardElements();

    if (elements.savePrefsBtn) {
        elements.savePrefsBtn.addEventListener("click", (event) => {
            event.preventDefault();
            savePriceDropPreferences();
        });
    }

    if (elements.syncBaselinesBtn) {
        elements.syncBaselinesBtn.addEventListener("click", (event) => {
            event.preventDefault();
            syncPriceDropBaselines();
        });
    }

    if (elements.prefUnsubAll) {
        elements.prefUnsubAll.addEventListener("change", () => {
            if (!elements.prefUnsubAll.checked) return;
            if (elements.prefEmail) elements.prefEmail.checked = false;
            if (elements.prefInApp) elements.prefInApp.checked = false;
        });
    }
}

// render wishlist (paint local first, then sync from backend)
async function renderDashboardWishlist() {
    // show stored items immediately so the panel never sits blank
    paintDashboardWishlist();

    const token = AppUtils.getToken();
    if (!token) {
        return;
    }

    try {
        const response = await AppUtils.apiRequest("/wishlist");

        // `data.items` is the shape GET /api/wishlist answers in. This read
        // `response.wishlist`, which the endpoint has never sent, so the
        // server copy was never adopted here either.
        const items =
            response && response.success === true
                ? (response.data && response.data.items) || response.wishlist
                : null;

        // only adopt the server copy when it actually has items, so an
        // empty/unsynced server response never wipes the local wishlist.
        // setJSON (not saveWishlist) avoids echoing a sync request back.
        if (Array.isArray(items) && items.length) {
            AppUtils.setJSON(AppUtils.CONFIG.STORAGE_KEYS.WISHLIST, items);
            paintDashboardWishlist();
        }
    } catch (error) {
        console.error("Failed to fetch wishlist in dashboard:", error);
    }

    await loadPriceDropPreferences();
}

// render cart
function renderDashboardCart() {
    const elements = getDashboardElements();
    const cart = AppUtils.getCart();

    if (elements.cartCount) {
        elements.cartCount.innerText = cart.length;
    }

    if (!elements.cartContainer) {
        return;
    }

    if (!cart.length) {
        renderDashboardEmptyState(
            elements.cartContainer,
            "No saved cart items found."
        );
        return;
    }

    elements.cartContainer.innerHTML = "";

    cart.forEach((item) => {
        if (!item) return;
        const card = document.createElement("div");
        card.className = "dashboard-item-card";
        card.innerHTML = `
            <img
                src="${AppUtils.defaultImage(item.image || item.img)}"
                alt="${item.name || "Product"}"
            >
            <div class="dashboard-item-info">
                <h4>${item.name || "Product"}</h4>
                <p>Qty: ${item.qty || 1}</p>
                <strong>${AppUtils.formatPrice(item.price || 0)}</strong>
            </div>
        `;
        elements.cartContainer.appendChild(card);
    });
}

bindPriceDropPreferenceControls();
handleUnsubscribeQueryParam();

// expose globally
window.renderDashboardWishlist = renderDashboardWishlist;
window.paintDashboardWishlist = paintDashboardWishlist;
window.renderDashboardCart = renderDashboardCart;
window.loadPriceDropPreferences = loadPriceDropPreferences;
window.savePriceDropPreferences = savePriceDropPreferences;
