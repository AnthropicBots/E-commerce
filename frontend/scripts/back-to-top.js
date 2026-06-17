(function () {
  "use strict";

  const SCROLL_THRESHOLD = 300; // px from top before button appears

  /** Returns the current scroll position regardless of scroll container */
  function getScrollTop() {
    return (
      document.scrollingElement?.scrollTop ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      window.scrollY ||
      0
    );
  }

  /** Scroll to top — calls both targets so either scroll container responds */
  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  
    if (document.body.scrollTop > 0) {
      document.body.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }
  }

  /** Create and append the button to <body> */
  function createButton() {
    const btn = document.createElement("button");
    btn.id = "back-to-top";
    btn.setAttribute("aria-label", "Back to top");
    btn.setAttribute("title", "Back to top");

    // Inline SVG — no external icon dependency required
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polyline points="18 15 12 9 6 15"></polyline>
      </svg>
    `;

    btn.addEventListener("click", scrollToTop);
    document.body.appendChild(btn);
    return btn;
  }

  /** Toggle .visible class based on current scroll position */
  function handleScroll(btn) {
    btn.classList.toggle("visible", getScrollTop() > SCROLL_THRESHOLD);
  }

  function initScrollListener(btn) {
    let ticking = false;

    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          window.requestAnimationFrame(function () {
            handleScroll(btn);
            ticking = false;
          });
          ticking = true;
        }
      },
      { passive: true }
    );
  }

  function init() {
    // Guard against double-init
    if (document.getElementById("back-to-top")) return;

    const btn = createButton();

    // Check immediately in case page loads already scrolled
    handleScroll(btn);

    initScrollListener(btn);
  }

  // Primary: wait for navbar/footer components to be injected (matches ui.js)
  document.addEventListener("componentsLoaded", init);

  // Fallback: plain pages without components.js
  document.addEventListener("DOMContentLoaded", function () {
    // Delay slightly so componentsLoaded fires first if it will
    setTimeout(init, 0);
  });
})();