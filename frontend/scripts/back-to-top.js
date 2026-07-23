(function () {
  "use strict";

  var SCROLL_THRESHOLD = 300;
  var btn = null;

  function getScrollTop() {
    return (
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0
    );
  }

  function createButton() {
    btn = document.createElement("button");
    btn.id = "back-to-top";
    btn.type = "button";
    btn.setAttribute("aria-label", "Back to top");
    btn.setAttribute("title", "Back to top");

    btn.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<polyline points="18 15 12 9 6 15"></polyline>' +
      "</svg>";

    document.body.appendChild(btn);

    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
      document.body.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function handleScroll() {
    if (!btn) return;
    var scrollY = getScrollTop();
    if (scrollY > SCROLL_THRESHOLD) {
      btn.classList.add("visible");
    } else {
      btn.classList.remove("visible");
    }
  }

  function init() {
    if (document.getElementById("back-to-top")) {
      btn = document.getElementById("back-to-top");
    } else {
      createButton();
    }
    handleScroll();

    // Listen on every possible scroll source, since different pages/layouts
    // on this site scroll via window, documentElement, or body.
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("scroll", handleScroll, { passive: true });
    document.body.addEventListener("scroll", handleScroll, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();