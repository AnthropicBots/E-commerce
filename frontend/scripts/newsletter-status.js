// frontend/scripts/newsletter-status.js
//
// The landing page for the two links in a newsletter email (#1459):
//
//   newsletter.html?action=confirm&token=...
//   newsletter.html?action=unsubscribe&token=...
//
// Both are POSTs made from here rather than GETs on the link itself. A GET
// unsubscribe is followed by mail clients and security scanners that prefetch
// links, which silently unsubscribes people who never clicked anything -- and a
// GET confirm can be triggered the same way, which defeats the point of the
// confirmation step.

(() => {
    "use strict";

    /** Copy for outcomes the server does not describe itself. */
    const FALLBACK_MESSAGES = {
        missing:
            "This link is incomplete. Use the full link from the email, or sign "
            + "up again from any page on the site.",
        unknown:
            "This link is not one we recognise. Use the full link from the "
            + "email, or sign up again from any page on the site.",
        failed:
            "Something went wrong. Please try the link again in a moment."
    };

    const HEADINGS = {
        confirm: "Confirm your subscription",
        unsubscribe: "Unsubscribe"
    };

    /**
     * @param {string} text
     * @param {"success"|"error"} tone
     */
    const report = (text, tone) => {
        const target = document.getElementById("newsletter-status-message");
        if (!target) {
            return;
        }
        // textContent: `message` comes from the API, and a status line is not
        // somewhere anyone should have to reason about markup.
        target.textContent = text;
        target.className = `newsletter-status-${tone}`;
    };

    const run = async () => {
        const params = new URLSearchParams(window.location.search);
        const token = (params.get("token") || "").trim();
        const action = params.get("action") === "unsubscribe"
            ? "unsubscribe"
            : "confirm";

        const heading = document.getElementById("newsletter-status-heading");
        if (heading) {
            heading.textContent = HEADINGS[action];
        }
        document.title =
            `${HEADINGS[action]} | AnthropicBots E-Commerce`;

        if (!token) {
            report(FALLBACK_MESSAGES.missing, "error");
            return;
        }

        try {
            const response = await AppUtils.apiRequest(
                `/newsletter/${action}`,
                {
                    method: "POST",
                    body: JSON.stringify({ token })
                }
            );

            // `apiRequest` resolves with { success: false } on a non-2xx rather
            // than rejecting, so the flag is what decides -- not the fact that
            // the await returned.
            if (response && response.success) {
                report(response.message || "Done.", "success");
            } else {
                report(
                    (response && response.message) || FALLBACK_MESSAGES.unknown,
                    "error"
                );
            }
        } catch (error) {
            console.error("NEWSLETTER STATUS ERROR:", error);
            report(FALLBACK_MESSAGES.failed, "error");
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run);
    } else {
        run();
    }
})();
