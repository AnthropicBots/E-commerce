/**
 * Checkout Progress Stepper
 * -------------------------------------------------------------
 * Renders a 4-step progress bar (Cart -> Details -> Payment ->
 * Confirmation) into any element with id="checkout-stepper".
 *
 * The host page declares which step is "current" via a
 * data attribute on that same container:
 *
 *   <div id="checkout-stepper" data-current-step="cart"></div>
 *   <div id="checkout-stepper" data-current-step="details"></div>
 *   <div id="checkout-stepper" data-current-step="confirmation"></div>
 *
 * Valid values: "cart" | "details" | "payment" | "confirmation"
 *
 * No backend changes required — purely presentational, driven by
 * which page is currently loaded.
 */

(function () {

    const STEPS = [
        { key: "cart", label: "Cart", icon: "fa-shopping-cart" },
        { key: "details", label: "Details", icon: "fa-user" },
        { key: "payment", label: "Payment", icon: "fa-credit-card" },
        { key: "confirmation", label: "Confirmation", icon: "fa-check" }
    ];

    function renderCheckoutStepper() {

        const container = document.getElementById("checkout-stepper");

        if (!container) {
            return;
        }

        const currentKey = container.dataset.currentStep;

        const currentIndex = STEPS.findIndex(
            (step) => step.key === currentKey
        );

        // If an unrecognized/missing step is passed, fail quietly
        // rather than rendering a broken/misleading stepper.
        if (currentIndex === -1) {
            console.warn(
                `checkout-stepper: unknown data-current-step "${currentKey}". ` +
                `Expected one of: ${STEPS.map((s) => s.key).join(", ")}`
            );
            return;
        }

        container.setAttribute("role", "list");
        container.setAttribute(
            "aria-label",
            "Checkout progress"
        );
        container.classList.add("checkout-stepper");

        container.innerHTML = STEPS.map((step, index) => {

            const isCompleted = index < currentIndex;
            const isActive = index === currentIndex;

            const stateClass = isCompleted
                ? "is-completed"
                : isActive
                    ? "is-active"
                    : "";

            const icon = isCompleted
                ? '<i class="fal fa-check" aria-hidden="true"></i>'
                : (index + 1);

            const stepStatus = isCompleted
                ? "completed"
                : isActive
                    ? "current"
                    : "upcoming";

            return `
                <li
                    class="checkout-stepper__step ${stateClass}"
                    role="listitem"
                    aria-current="${isActive ? "step" : "false"}"
                >
                    <span class="checkout-stepper__circle">
                        ${icon}
                    </span>
                    <span class="checkout-stepper__label">
                        ${step.label}
                        <span class="visually-hidden">
                            (${stepStatus})
                        </span>
                    </span>
                </li>
            `;

        }).join("");
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            renderCheckoutStepper
        );
    } else {
        renderCheckoutStepper();
    }

    // Expose for pages that render checkout content dynamically
    // and may need to re-run this after DOM updates.
    window.renderCheckoutStepper = renderCheckoutStepper;

})();