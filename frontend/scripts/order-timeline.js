// frontend/scripts/order-timeline.js
//
// Order status timeline (#1351).
//
// The tracking page had four hardcoded steps and no dates behind them: an
// order's status was a single mutable field, so "shipped on the 4th" was not
// information the page had access to. This drives the existing step ladder from
// the recorded history and adds the dated event list underneath it.
//
// Classic <script> file, not a module -- order.html loads plain <script> tags.

(function () {
    "use strict";

    // The ladder already in order.html. Keyed by the status the server reports
    // so the two cannot drift: adding a step server-side without adding the
    // element here simply renders nothing, rather than throwing.
    var STEP_ELEMENTS = {
        pending: "pending-step",
        processing: "processing-step",
        shipped: "shipped-step",
        delivered: "delivered-step"
    };

    var ICONS = {
        pending: "fa-receipt",
        processing: "fa-box",
        shipped: "fa-shipping-fast",
        out_for_delivery: "fa-truck",
        delivered: "fa-home",
        cancelled: "fa-times-circle",
        refunded: "fa-undo",
        on_hold: "fa-pause-circle"
    };

    function esc(value) {
        if (window.AppUtils && typeof AppUtils.escapeHTML === "function") {
            return AppUtils.escapeHTML(value == null ? "" : String(value));
        }

        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /**
     * Format a date-only value for display.
     *
     * The delivery window arrives as two YYYY-MM-DD strings. Parsing those
     * with the Date constructor would read them as UTC midnight and render the
     * previous day west of Greenwich, so the parts are handed over explicitly.
     */
    function formatDay(value) {
        if (!value) return "";

        var parts = String(value).slice(0, 10).split("-");
        if (parts.length !== 3) return "";

        var date = new Date(
            Number(parts[0]),
            Number(parts[1]) - 1,
            Number(parts[2])
        );
        if (isNaN(date.getTime())) return "";

        return date.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short"
        });
    }

    /**
     * Format a timestamp for display.
     *
     * Returns an empty string for anything unparseable rather than "Invalid
     * Date", which is what a null `delivered_at` used to render as on every
     * order.
     */
    function formatMoment(value) {
        if (!value) return "";

        var date = new Date(value);
        if (isNaN(date.getTime())) return "";

        return date.toLocaleString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    /**
     * Drive the existing four-step ladder from the server's derived steps.
     *
     * `complete` is computed server-side rather than by comparing statuses
     * here, because the server knows an order that jumped straight to
     * `delivered` did in fact ship — a client comparing against a fixed
     * sequence would show a gap.
     */
    function renderSteps(steps) {
        if (!Array.isArray(steps)) return;

        // A cancelled order returns no steps. Hide the ladder rather than
        // leaving it stuck on whatever it last showed, which would suggest the
        // order is still on its way.
        var container = document.querySelector(".tracking-timeline");

        if (steps.length === 0) {
            if (container) container.hidden = true;
            return;
        }

        if (container) container.hidden = false;

        steps.forEach(function (step) {
            var element = document.getElementById(STEP_ELEMENTS[step.status]);
            if (!element) return;

            element.classList.toggle("active-step", Boolean(step.complete || step.current));
            element.classList.toggle("current-step", Boolean(step.current));

            // The date under each step is the thing that was missing: a ladder
            // with no dates cannot answer "when did this ship".
            var existing = element.querySelector(".step-date");
            var formatted = formatMoment(step.at);

            if (!existing) {
                existing = document.createElement("small");
                existing.className = "step-date";
                element.appendChild(existing);
            }

            existing.textContent = formatted;
        });
    }

    /**
     * The delivery promise, on the panel that has always had a slot for it.
     *
     * `#estimated-delivery` has read "-" on every order since the page was
     * written, because nothing recorded a promise to put there. The option the
     * order was sold goes alongside it, so the date is attributable: "arriving
     * by the 12th" means something different under standard and under express.
     *
     * A window collapses to one date when both ends fall on the same day,
     * because "8 Aug – 8 Aug" reads as a mistake.
     */
    function renderDelivery(delivery) {
        var target = document.getElementById("estimated-delivery");
        if (!target) return;

        if (!delivery) {
            target.textContent = "-";
            return;
        }

        var method = document.getElementById("delivery-method");

        if (method) {
            method.textContent =
                delivery.charge > 0
                    ? delivery.method.label
                    : delivery.method.label + " (free)";
        }

        if (!delivery.estimate) {
            // No estimate is a real answer here: the order has arrived, or was
            // cancelled, or predates the delivery options entirely.
            target.textContent = "-";
            return;
        }

        var from = formatDay(delivery.estimate.from);
        var to = formatDay(delivery.estimate.to);

        target.textContent = from === to ? from : from + " – " + to;
    }

    /**
     * The dated event list.
     *
     * Newest first, which is the opposite of the ladder: a shopper checking on
     * an order wants the most recent thing that happened, not the order in
     * which everything happened.
     */
    function renderHistory(history) {
        var container = document.getElementById("order-timeline");
        if (!container) return;

        if (!Array.isArray(history) || history.length === 0) {
            container.innerHTML = "";
            return;
        }

        var items = history
            .slice()
            .reverse()
            .map(function (entry, index) {
                var icon = ICONS[entry.status] || "fa-circle";

                return (
                    '<li class="timeline-entry' +
                    (index === 0 ? " is-latest" : "") +
                    '">' +
                    '<span class="timeline-icon"><i class="fas ' +
                    icon +
                    '" aria-hidden="true"></i></span>' +
                    '<div class="timeline-body">' +
                    '<p class="timeline-title">' +
                    esc(entry.title) +
                    "</p>" +
                    '<p class="timeline-description">' +
                    esc(entry.description) +
                    "</p>" +
                    (entry.reason
                        ? '<p class="timeline-reason">' + esc(entry.reason) + "</p>"
                        : "") +
                    '<time class="timeline-time">' +
                    esc(formatMoment(entry.at)) +
                    "</time>" +
                    "</div>" +
                    "</li>"
                );
            })
            .join("");

        container.innerHTML =
            '<h3 class="timeline-heading">Order activity</h3>' +
            '<ol class="timeline-list">' +
            items +
            "</ol>";
    }

    /**
     * Load and render the timeline for an order.
     *
     * A failure here is deliberately quiet: the timeline is supplementary, and
     * an order page that renders everything except the activity list is far
     * better than one showing an error because a secondary call failed.
     *
     * @param {string} orderId
     */
    async function loadOrderTimeline(orderId) {
        if (!orderId || !window.AppUtils || !AppUtils.apiRequest) return null;

        try {
            var response = await AppUtils.apiRequest(
                "/orders/" + encodeURIComponent(orderId) + "/timeline"
            );

            if (!response || !response.success || !response.data) return null;

            renderSteps(response.data.steps);
            renderDelivery(response.data.delivery);
            renderHistory(response.data.history);

            return response.data;
        } catch (error) {
            console.error("LOAD ORDER TIMELINE ERROR:", error);
            return null;
        }
    }

    window.OrderTimeline = {
        load: loadOrderTimeline,
        renderSteps: renderSteps,
        renderDelivery: renderDelivery,
        renderHistory: renderHistory,
        formatMoment: formatMoment,
        formatDay: formatDay
    };
})();
