// Landing behaviour for an abandoned-cart restore link (#1429).
//
// The link points at the cart page carrying a token, which this spends for the
// basket it covers. Everything else on the page is unchanged: the lines go into
// the basket the browser already owns, and the ordinary cart machinery picks
// them up from there.

const RESTORE_QUERY_PARAM = "restore";

// Restoring is not adding. A shopper who already has one of these lines in
// front of them wants the quantity they had, not that quantity again -- and the
// same link opened twice must not walk the basket up. Taking the larger of the
// two is idempotent, which summing is not.
const mergeRestoredLines = (current, restored) => {
    const byKey = new Map(
        AppUtils.safeArray(current).map((item) => [AppUtils.getCartItemKey(item), item])
    );

    AppUtils.safeForEach(restored, (line) => {
        const key = AppUtils.getCartItemKey(line);
        const existing = byKey.get(key);

        if (!existing) {
            byKey.set(key, line);
            return;
        }

        byKey.set(key, {
            ...existing,
            qty: Math.max(
                AppUtils.safeInteger(existing.qty, 1),
                AppUtils.safeInteger(line.qty, 1)
            )
        });
    });

    return Array.from(byKey.values());
};

// Out of the address bar before anything else happens. The token is single use,
// so a refresh could only fail; keeping it visible would also leak it into the
// referrer of every request the page makes from here on.
const takeRestoreTokenFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get(RESTORE_QUERY_PARAM);

    if (!token) return null;

    params.delete(RESTORE_QUERY_PARAM);

    const query = params.toString();
    window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );

    return token;
};

const restoreCartFromLink = async () => {
    const token = takeRestoreTokenFromUrl();

    if (!token) return;

    let response;

    try {
        // `retry: false` -- a 401 here means nothing, since the endpoint never
        // wanted a session, and the refresh-and-retry path would only turn a
        // clear answer into a redirect to sign in.
        response = await AppUtils.apiRequest(
            "/cart/restore",
            {
                method: "POST",
                body: JSON.stringify({ token })
            },
            false
        );
    } catch (error) {
        console.error("Failed to restore basket from link:", error);
        AppUtils.notify("We could not restore that basket.", "error");
        return;
    }

    if (!response || !response.success) {
        AppUtils.notify(
            (response && response.message) || "That link is no longer usable.",
            "error"
        );
        return;
    }

    const merged = mergeRestoredLines(
        AppUtils.getCart(),
        AppUtils.safeArray(response.items).map(AppUtils.normalizeCartItem).filter(Boolean)
    );

    // saveCart dispatches the cart-updated event, which is what re-renders the
    // page, and mirrors to the account cart when the shopper happens to already
    // be signed in.
    AppUtils.saveCart(merged);

    AppUtils.notify("Your basket is back.", "success");
};

document.addEventListener("DOMContentLoaded", () => {
    restoreCartFromLink();
});
