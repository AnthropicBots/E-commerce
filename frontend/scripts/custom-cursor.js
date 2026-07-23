(function () {
    if (window.CaraCustomCursor) {
        return;
    }

    const supportsCursor =
        "requestAnimationFrame" in window &&
        "matchMedia" in window &&
        "CSS" in window &&
        CSS.supports("transform", "translate3d(0, 0, 0)");

    const pointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (!supportsCursor || !pointerQuery.matches) {
        return;
    }

    window.CaraCustomCursor = true;

    const clickableSelector = [
        "a[href]",
        "button:not([disabled])",
        "[role='button']",
        "[onclick]",
        "input[type='button']",
        "input[type='submit']",
        ".pro",
        ".fe-box",
        ".banner-link",
        ".blog-box",
        ".order-card",
        ".wishlist-item",
        ".cart-item",
        ".product-card"
    ].join(",");

    const textInputSelector = [
        "input:not([type='button']):not([type='submit']):not([type='checkbox']):not([type='radio'])",
        "textarea",
        "select",
        "[contenteditable='true']"
    ].join(",");

    const magneticSelector = [
        ".hero-ctas button",
        "button.primary",
        "button.secondary",
        "button.normal",
        ".cta-button",
        ".btn-primary",
        ".shop-now-btn"
    ].join(",");

    const cursor = document.createElement("div");
    const label = document.createElement("span");

    cursor.className = "custom-cursor";
    cursor.setAttribute("aria-hidden", "true");
    label.className = "custom-cursor__label";
    cursor.appendChild(label);
    document.body.appendChild(cursor);
    document.body.classList.add("cursor-enhanced");

    const position = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        renderedX: window.innerWidth / 2,
        renderedY: window.innerHeight / 2
    };

    let activeMagneticElement = null;
    let activeClickableElement = null;
    let isVisible = false;
    let isPressed = false;
    let animationFrame = null;

    const getCursorText = (element) => {
        if (!element) {
            return "";
        }

        const explicitText = element.getAttribute("data-cursor-text");

        if (explicitText) {
            return explicitText;
        }

        const href = element.getAttribute("href") || "";
        const ariaLabel = element.getAttribute("aria-label") || "";
        const text = `${element.textContent || ""} ${ariaLabel}`.trim().toLowerCase();

        if (href.includes("shop") || text.includes("shop")) {
            return "Shop";
        }

        if (text.includes("cart") || text.includes("bag")) {
            return "Add";
        }

        if (
            element.classList.contains("pro") ||
            element.classList.contains("fe-box") ||
            element.classList.contains("product-card") ||
            href.includes("product") ||
            text.includes("view") ||
            text.includes("explore")
        ) {
            return "View";
        }

        return "";
    };

    const setClickableElement = (element) => {
        activeClickableElement = element;
        const cursorText = getCursorText(element);

        cursor.classList.toggle("is-clickable", Boolean(element));
        cursor.classList.toggle("has-label", Boolean(cursorText));
        label.textContent = cursorText;
    };

    const clearMagneticElement = () => {
        if (activeMagneticElement) {
            activeMagneticElement.style.transform = "";
        }

        activeMagneticElement = null;
    };

    const updateMagneticElement = (event) => {
        if (reduceMotionQuery.matches) {
            return;
        }

        const magneticElement = event.target.closest(magneticSelector);

        if (!magneticElement) {
            clearMagneticElement();
            return;
        }

        activeMagneticElement = magneticElement;

        const rect = magneticElement.getBoundingClientRect();
        const distanceX = event.clientX - (rect.left + rect.width / 2);
        const distanceY = event.clientY - (rect.top + rect.height / 2);

        magneticElement.style.transform = `translate3d(${distanceX * 0.18}px, ${distanceY * 0.26}px, 0)`;
    };

    const render = () => {
        const ease = reduceMotionQuery.matches ? 1 : 0.18;

        position.renderedX += (position.x - position.renderedX) * ease;
        position.renderedY += (position.y - position.renderedY) * ease;
        cursor.style.transform = `translate3d(${position.renderedX}px, ${position.renderedY}px, 0) translate3d(-50%, -50%, 0) scale(var(--cursor-scale))`;

        animationFrame = window.requestAnimationFrame(render);
    };

    const onPointerMove = (event) => {
        if (event.pointerType && event.pointerType !== "mouse") {
            return;
        }

        position.x = event.clientX;
        position.y = event.clientY;

        if (!isVisible) {
            isVisible = true;
            cursor.classList.add("is-visible");
        }

        if (event.target.closest(textInputSelector)) {
            cursor.classList.add("is-native");
            setClickableElement(null);
            clearMagneticElement();
            return;
        }

        cursor.classList.remove("is-native");

        const clickableElement = event.target.closest(clickableSelector);

        if (clickableElement !== activeClickableElement) {
            setClickableElement(clickableElement);
        }

        updateMagneticElement(event);
    };

    const onPointerDown = () => {
        isPressed = true;
        cursor.classList.add("is-pressed");
    };

    const onPointerUp = () => {
        isPressed = false;
        cursor.classList.remove("is-pressed");
    };

    const onPointerLeave = () => {
        isVisible = false;
        isPressed = false;
        cursor.classList.remove("is-visible", "is-pressed", "is-native");
        setClickableElement(null);
        clearMagneticElement();
    };

    const destroy = () => {
        window.cancelAnimationFrame(animationFrame);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointerleave", onPointerLeave);
        if ("removeEventListener" in pointerQuery) {
            pointerQuery.removeEventListener("change", onPointerQueryChange);
        } else {
            pointerQuery.removeListener(onPointerQueryChange);
        }
        document.body.classList.remove("cursor-enhanced");
        cursor.remove();
        clearMagneticElement();
        window.CaraCustomCursor = false;
    };

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointerup", onPointerUp, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave, { passive: true });

    const onPointerQueryChange = (event) => {
        if (!event.matches) {
            destroy();
        }
    };

    if ("addEventListener" in pointerQuery) {
        pointerQuery.addEventListener("change", onPointerQueryChange);
    } else {
        pointerQuery.addListener(onPointerQueryChange);
    }

    animationFrame = window.requestAnimationFrame(render);
}());
