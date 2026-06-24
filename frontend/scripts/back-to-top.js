(function () {
  "use strict";

  const SCROLL_THRESHOLD = 300; // px from top before button appears
  const SCROLL_BUTTON_IDS = ["back-to-top", "scroll-top"];
  const INIT_FLAG = "backToTopInitialized";

  function getScrollTop() {
    return (
      document.scrollingElement?.scrollTop ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      window.scrollY ||
      0
    );
  }

  function getScrollButton() {
    return SCROLL_BUTTON_IDS
      .map((id) => document.getElementById(id))
      .find(Boolean);
  }

  function attachClickHandler(btn) {
    if (!btn || btn.dataset[INIT_FLAG]) return;
    btn.addEventListener("click", scrollToTop);
    btn.dataset[INIT_FLAG] = "true";
  }

  function scrollToTop() {
    const scrollOptions = { top: 0, behavior: "smooth" };
    window.scrollTo(scrollOptions);

    const scrollingElement = document.scrollingElement || document.documentElement || document.body;
    if (scrollingElement && scrollingElement.scrollTop > 0 && typeof scrollingElement.scrollTo === "function") {
      scrollingElement.scrollTo(scrollOptions);
    }
  }

  function createButton() {
    const btn = document.createElement("button");
    btn.id = "back-to-top";
    btn.setAttribute("aria-label", "Back to top");
    btn.setAttribute("title", "Back to top");

    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polyline points="18 15 12 9 6 15"></polyline>
      </svg>
    `;

    attachClickHandler(btn);
    document.body.appendChild(btn);
    return btn;
  }

  function handleScroll(btn) {
    if (!btn) return;
    btn.classList.toggle("visible", getScrollTop() > SCROLL_THRESHOLD);
  }

  function initScrollListener(btn) {
    if (!btn) return;

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
    if (document.documentElement.dataset[INIT_FLAG] === "true") return;

    const btn = getScrollButton() || createButton();
    attachClickHandler(btn);
    handleScroll(btn);
    initScrollListener(btn);

    document.documentElement.dataset[INIT_FLAG] = "true";
  }

  document.addEventListener("componentsLoaded", init);
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(init, 0);
  });
})();