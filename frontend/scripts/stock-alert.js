// frontend/scripts/stock-alert.js
// Notify Me / back-in-stock alert feature (#1233)

(() => {
    const ALERT_TYPE_STOCK = "back_in_stock";
    const SUBSCRIBED_KEY = "stockAlertSubscriptions";

    function getSubscribed() {
        try {
            const raw = localStorage.getItem(SUBSCRIBED_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? new Set(parsed) : new Set();
        } catch (e) { return new Set(); }
    }
    function saveSubscribed(set) {
        try { localStorage.setItem(SUBSCRIBED_KEY, JSON.stringify([...set])); }
        catch (err) { console.warn("stockAlert: could not persist", err); }
    }
    function isSubscribed(productId) { return getSubscribed().has(String(productId)); }
    function markSubscribed(productId) { const s = getSubscribed(); s.add(String(productId)); saveSubscribed(s); }
    function markUnsubscribed(productId) { const s = getSubscribed(); s.delete(String(productId)); saveSubscribed(s); }

    // FIX: try-catch added to handle API errors gracefully
    async function subscribeAlert(productId) {
        try {
            return await AppUtils.apiRequest("/stock-alerts", {
                method: "POST",
                body: JSON.stringify({ productId: String(productId), alertType: ALERT_TYPE_STOCK })
            });
        } catch (err) {
            console.error("stockAlert: subscribeAlert failed", err);
            return { success: false, message: err.message || "Subscription request failed." };
        }
    }

    // FIX: try-catch added to handle API errors gracefully
    async function unsubscribeAlert(productId) {
        try {
            return await AppUtils.apiRequest("/stock-alerts", {
                method: "DELETE",
                body: JSON.stringify({ productId: String(productId), alertType: ALERT_TYPE_STOCK })
            });
        } catch (err) {
            console.error("stockAlert: unsubscribeAlert failed", err);
            return { success: false, message: err.message || "Unsubscribe request failed." };
        }
    }

    // FIX: use createElement instead of innerHTML to avoid quote-escaping issues
    function makeIcon(iconClass) {
        const i = document.createElement("i");
        i.className = iconClass;
        i.setAttribute("aria-hidden", "true");
        return i;
    }

    function paintSubscribed(btn) {
        btn.disabled = false;
        btn.dataset.subscribed = "true";
        btn.textContent = " Cancel Alert";
        btn.insertBefore(makeIcon("fas fa-bell-slash"), btn.firstChild);
        btn.classList.add("notify-me-btn--active");
        btn.setAttribute("aria-pressed", "true");
        btn.setAttribute("title", "Cancel back-in-stock notification");
    }
    function paintUnsubscribed(btn) {
        btn.disabled = false;
        btn.dataset.subscribed = "false";
        btn.textContent = " Notify Me";
        btn.insertBefore(makeIcon("fas fa-bell"), btn.firstChild);
        btn.classList.remove("notify-me-btn--active");
        btn.setAttribute("aria-pressed", "false");
        btn.setAttribute("title", "Get notified when this is back in stock");
    }
    function paintLoading(btn) {
        btn.disabled = true;
        btn.textContent = " Please wait...";
        btn.insertBefore(makeIcon("fas fa-spinner fa-spin"), btn.firstChild);
    }

    // FIX: validate productId is a non-empty, finite value before proceeding
    function isValidProductId(productId) {
        if (productId === null || productId === undefined) return false;
        const str = String(productId).trim();
        return str.length > 0 && str !== "undefined" && str !== "null";
    }

    async function handleToggle(btn, productId) {
        // FIX: validate productId before any action
        if (!isValidProductId(productId)) {
            console.error("stockAlert: invalid productId", productId);
            AppUtils.notify("Cannot set alert: product ID is missing.", "error");
            return;
        }
        if (AppUtils.isAuthenticated() === false) {
            AppUtils.notify("Please sign in to set stock alerts.", "error");
            setTimeout(function() {
                window.location.href = "signin.html?next=" + encodeURIComponent(window.location.href);
            }, 800);
            return;
        }
        var alreadySubscribed = btn.dataset.subscribed === "true";
        paintLoading(btn);
        try {
            if (alreadySubscribed) {
                var res = await unsubscribeAlert(productId);
                if (res && res.success) {
                    markUnsubscribed(productId);
                    paintUnsubscribed(btn);
                    AppUtils.notify("You will no longer be notified for this product.", "info");
                } else {
                    throw new Error((res && res.message) || "Could not cancel alert.");
                }
            } else {
                var res2 = await subscribeAlert(productId);
                if (res2 && res2.success) {
                    markSubscribed(productId);
                    paintSubscribed(btn);
                    AppUtils.notify("We will email you when this is back in stock!", "success");
                } else {
                    throw new Error((res2 && res2.message) || "Could not set alert.");
                }
            }
        } catch (err) {
            console.error("stockAlert: handleToggle error", err);
            AppUtils.notify(err.message || "Something went wrong. Please try again.", "error");
            if (alreadySubscribed) { paintSubscribed(btn); } else { paintUnsubscribed(btn); }
        }
    }

    // FIX: guard against null/undefined productId before creating button
    function createNotifyBtn(productId) {
        if (!isValidProductId(productId)) {
            console.warn("stockAlert: createNotifyBtn called with invalid productId", productId);
            return null;
        }
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "notify-me-btn";
        btn.dataset.productId = String(productId);
        if (isSubscribed(productId)) { paintSubscribed(btn); } else { paintUnsubscribed(btn); }
        btn.addEventListener("click", function() { handleToggle(btn, productId); });
        return btn;
    }

    function initStockAlert(product) {
        if (product == null) return;
        if (Number(product.stock) > 0) return;
        var container = document.getElementById("product-buttons");
        if (container == null) return;
        if (container.querySelector(".notify-me-btn")) return;
        var btn = createNotifyBtn(product.id);
        if (btn) { container.appendChild(btn); }
    }

    function injectNotifyBtnIntoCard(card, product) {
        if (card == null || product == null) return;
        var stock = product.stock;
        if (stock === undefined || stock === null || Number(stock) > 0) return;
        var productId = product.id || product.productId;
        if (!isValidProductId(productId)) return;
        if (card.querySelector(".notify-me-btn")) return;
        var btn = createNotifyBtn(productId);
        if (!btn) return;
        var buttonRow = card.querySelector(".wishlist-buttons");
        if (buttonRow) { buttonRow.appendChild(btn); }
        else { var content = card.querySelector(".wishlist-content"); if (content) { content.appendChild(btn); } }
    }

    window.StockAlert = {
        initStockAlert: initStockAlert,
        injectNotifyBtnIntoCard: injectNotifyBtnIntoCard,
        isSubscribed: isSubscribed,
        createNotifyBtn: createNotifyBtn
    };
})();