/**
 * Deferred stylesheet loader for shop/home (#1388).
 * Critical CSS loads sync; non-critical sheets use print→all swap.
 *
 * Usage (in HTML):
 *   <link rel="preload" href="styles/foo.css" as="style" data-defer-style>
 *   <script src="scripts/defer-styles.js" defer></script>
 * Or call: DeferStyles.load(["styles/a.css", "styles/b.css"])
 */
(function (global) {
    "use strict";

    function activateLink(link) {
        if (!link || link.dataset.deferredApplied === "1") return;
        link.dataset.deferredApplied = "1";
        link.media = "all";
        link.rel = "stylesheet";
        link.onload = null;
    }

    function loadStylesheet(href) {
        return new Promise((resolve, reject) => {
            if (!href) {
                resolve();
                return;
            }
            const existing = document.querySelector(
                `link[rel="stylesheet"][href="${href}"], link[data-defer-href="${href}"]`
            );
            if (existing && existing.rel === "stylesheet" && existing.media !== "print") {
                resolve();
                return;
            }

            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = href;
            link.media = "print";
            link.dataset.deferHref = href;
            link.onload = () => {
                activateLink(link);
                resolve();
            };
            link.onerror = () => reject(new Error("Failed to load " + href));
            document.head.appendChild(link);
            // Safari / older: force swap even if onload is flaky
            setTimeout(() => activateLink(link), 3000);
        });
    }

    function hydratePreloads() {
        const nodes = document.querySelectorAll(
            'link[data-defer-style], link[rel="preload"][as="style"][data-defer-style]'
        );
        nodes.forEach((link) => {
            if (link.rel === "preload") {
                link.addEventListener("load", () => {
                    link.rel = "stylesheet";
                    link.media = "all";
                });
                // Fallback path
                link.rel = "stylesheet";
                link.media = "print";
                link.onload = () => activateLink(link);
                setTimeout(() => activateLink(link), 2500);
            } else if (link.media === "print") {
                link.onload = () => activateLink(link);
                setTimeout(() => activateLink(link), 2500);
            }
        });
    }

    function load(hrefs) {
        const list = Array.isArray(hrefs) ? hrefs : [hrefs];
        return Promise.all(list.map((h) => loadStylesheet(h).catch(() => {})));
    }

    const DeferStyles = {
        load,
        hydratePreloads,
        loadStylesheet
    };

    global.DeferStyles = DeferStyles;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", hydratePreloads);
    } else {
        hydratePreloads();
    }
})(typeof window !== "undefined" ? window : globalThis);
