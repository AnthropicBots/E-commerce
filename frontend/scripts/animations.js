const AnimationController = (() => {
  const prefersReduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const variantConfig = {
    "fade-up": { staggerMultiplier: 0.06, maxDelay: 0.6 },
    "fade-down": { staggerMultiplier: 0.06, maxDelay: 0.6 },
    fade: { staggerMultiplier: 0.05, maxDelay: 0.5 },
    "slide-left": { staggerMultiplier: 0.07, maxDelay: 0.7 },
    zoom: { staggerMultiplier: 0.08, maxDelay: 0.8 },
    scale: { staggerMultiplier: 0.06, maxDelay: 0.6 },
  };

  const observerOptions = {
    threshold: 0.01,
    rootMargin: "0px",
  };

  let observer = null;
  const registeredElements = new WeakSet();

  function getObserver() {
    if (observer) return observer;
    if (prefersReduced || !("IntersectionObserver" in window)) return null;

    observer = new IntersectionObserver(handleIntersections, observerOptions);
    window.__ecomAnimationObserver = observer;
    return observer;
  }

  function calculateStaggerDelay(index, variant = "fade-up") {
    const config = variantConfig[variant] || variantConfig["fade-up"];
    const delay = index * config.staggerMultiplier;
    return Math.min(delay, config.maxDelay);
  }

  function handleIntersections(entries) {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      revealElement(entry.target);
      if (observer) observer.unobserve(entry.target);
    });
  }

  function revealElement(el) {
    if (el.classList.contains("in-view")) return;

    if (prefersReduced) {
      el.classList.add("in-view");
      return;
    }

    const variant = el.dataset.animVariant || "fade-up";
    const index = Number(el.dataset.animIndex || 0);
    const delay = calculateStaggerDelay(index, variant);

    if (delay > 0) {
      el.style.animationDelay = `${delay}s`;
    }

    el.classList.add("in-view");
  }

  function registerElement(el, options = {}) {
    if (!el || registeredElements.has(el)) return;
    registeredElements.add(el);

    const variant = options.variant || "fade-up";
    const index = Number(options.index ?? el.dataset.animIndex ?? 0);

    el.classList.add("animate-on-scroll");
    el.dataset.animVariant = variant;
    el.dataset.animIndex = String(index);

    if (prefersReduced) {
      el.classList.add("in-view");
      return;
    }

    el.style.willChange = "opacity, transform";
    const obs = getObserver();
    if (obs) {
      obs.observe(el);
    } else {
      el.classList.add("in-view");
    }
  }

  function registerGroup(selector, options = {}) {
    if (!selector) return;
    document.querySelectorAll(selector).forEach((el, index) => {
      registerElement(el, { ...options, index });
    });
  }

  function refreshContainer(containerSelector, options = {}) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const selectors = [".pro", ".fe-box", ".animate-on-scroll"];
    container.querySelectorAll(selectors.join(", ")).forEach((el, index) => {
      if (!registeredElements.has(el)) {
        registerElement(el, { ...options, index });
      } else if (!el.classList.contains("in-view")) {
        const obs = getObserver();
        if (obs) obs.observe(el);
      }
    });
  }

  function revealVisibleElements(containerSelector) {
    if (prefersReduced) return;
    const container = document.querySelector(containerSelector);
    if (!container) return;

    container.querySelectorAll(".animate-on-scroll").forEach((el) => {
      if (el.classList.contains("in-view")) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.85 && rect.bottom > 0) {
        revealElement(el);
      }
    });
  }

  function revealAll(containerSelector) {
    if (prefersReduced) return;
    const container = document.querySelector(containerSelector);
    if (!container) return;

    container
      .querySelectorAll(".animate-on-scroll:not(.in-view)")
      .forEach((el) => {
        revealElement(el);
      });
  }

  return {
    prefersReduced,
    variantConfig,
    registerElement,
    registerGroup,
    refreshContainer,
    revealVisibleElements,
    revealAll,
    calculateStaggerDelay,
    getObserver,
  };
})();

function initializeScrollAnimations() {
  // Reduced-motion: skip animations but make all flagged content visible,
  // otherwise the opacity:0 sections would stay permanently blank.
  if (AnimationController.prefersReduced) {
    document
      .querySelectorAll(".animate-on-scroll")
      .forEach((el) => el.classList.add("in-view"));
    return;
  }

  // Register every section flagged with .animate-on-scroll so the section
  // wrappers themselves get revealed. Previously only their children were
  // observed, leaving #feature / #product1 / #new-arrivals stuck at opacity:0.
  AnimationController.registerGroup(".animate-on-scroll", {
    variant: "fade-up",
  });

  AnimationController.registerGroup("#feature .fe-box", {
    variant: "zoom",
  });

  AnimationController.registerGroup("#product1 .pro", {
    variant: "fade-up",
  });

  AnimationController.registerGroup("#new-arrivals .pro", {
    variant: "fade-up",
  });

  AnimationController.registerGroup("#recently-viewed .pro", {
    variant: "fade-up",
  });

  AnimationController.registerGroup(
    "#banner, #sm-banner, #banner3, #newsletter",
    { variant: "fade" },
  );
}

function addProductCardAnimations(containerSelector) {
  const container = document.querySelector(containerSelector);

  if (!container) {
    return;
  }

  container
    .querySelectorAll(".pro")
    .forEach((card, index) => {
      if (!card.dataset.animRegistered) {
        card.dataset.animRegistered = "true";

        AnimationController.registerElement(card, {
          variant: "fade-up",
          index,
        });
      }
    });

  requestAnimationFrame(() => {
    AnimationController.revealAll(containerSelector);
  });
}

function animateProductsOnLoad() {
  const containers = [
    "#featured-products",
    "#new-arrivals-container",
    "#recently-viewed-container",
  ];

  containers.forEach((selector) => {
    const container = document.querySelector(selector);
    if (!container) return;

    new MutationObserver(() => {
      addProductCardAnimations(selector);
    }).observe(container, {
      childList: true,
      subtree: true,
    });
  });
}

function enhanceFeatureCards() {
  if (AnimationController.prefersReduced) {
    document
      .querySelectorAll("#feature .fe-box")
      .forEach((box) => box.classList.add("in-view"));
    return;
  }

  document.querySelectorAll("#feature .fe-box").forEach((box, index) => {
    box.dataset.animIndex = String(index);
    box.style.willChange = "transform, opacity";
  });
}

function enhanceNavbarAnimations() {
  const navbar = document.getElementById("header");
  const logoImg = document.querySelector(
    "#header .logo, #header .logo img, #header img.logo",
  );

  if (AnimationController.prefersReduced) {
    if (navbar) navbar.style.boxShadow = "0 5px 15px rgba(0, 0, 0, 0.06)";
    return;
  }

  if (logoImg) {
    logoImg.style.opacity = "0";
    logoImg.style.transform = "translateY(-4px)";
    logoImg.style.transition = "opacity 0.6s ease, transform 0.6s ease";
    requestAnimationFrame(() => {
      logoImg.style.opacity = "1";
      logoImg.style.transform = "translateY(0)";
    });
  }

  if (!navbar) return;

  window.addEventListener(
    "scroll",
    () => {
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;
      navbar.style.boxShadow =
        scrollTop > 10
          ? "0 5px 25px rgba(0, 0, 0, 0.1)"
          : "0 5px 15px rgba(0, 0, 0, 0.06)";
      navbar.style.transition = "box-shadow 0.3s ease-out";
    },
    { passive: true },
  );

  const cartLink = document.querySelector("#navbar-links .cart-link a");
  if (cartLink) {
    cartLink.style.transition = "transform 0.2s ease";
    cartLink.addEventListener(
      "mouseenter",
      () => (cartLink.style.transform = "scale(1.03)"),
      { passive: true },
    );
    cartLink.addEventListener(
      "mouseleave",
      () => (cartLink.style.transform = "scale(1)"),
      { passive: true },
    );
  }
}

function enhanceButtonAnimations() {
  if (AnimationController.prefersReduced) return;

  document.querySelectorAll("button, a[href*='shop']").forEach((button) => {
    button.addEventListener("mouseenter", function () {
      this.style.transition =
        "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)";
    });
  });
}

function initializeParallaxEffects() {
  const hero = document.getElementById("hero");
  if (!hero || AnimationController.prefersReduced) return;

  let isScrolling = false;

  window.addEventListener(
    "scroll",
    () => {
      if (!isScrolling) {
        requestAnimationFrame(() => {
          const rect = hero.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            const scrollPercent = window.scrollY / hero.offsetHeight;
            hero.style.backgroundPosition = `top ${25 + scrollPercent * 5}% right 0`;
          }
          isScrolling = false;
        });
        isScrolling = true;
      }
    },
    { passive: true },
  );
}

function runHeroOnceOnly() {
  const hero = document.getElementById("hero");

  if (!hero) {
    return;
  }

  if (hero.dataset.heroAnimated === "1") {
    return;
  }

  hero.dataset.heroAnimated = "1";

  hero.classList.remove("animate-on-scroll");
  hero.classList.add("in-view");

  hero.style.opacity = "1";
  hero.style.transform = "none";

  hero.classList.add("hero-animate-once");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      hero.classList.add("page-loaded");
    });
  });
}

function initializeAllAnimations() {
  setTimeout(() => {
    runHeroOnceOnly();
    initializeScrollAnimations();
    enhanceFeatureCards();
    animateProductsOnLoad();
    enhanceNavbarAnimations();
    enhanceButtonAnimations();
    initializeParallaxEffects();
  }, 80);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAllAnimations);
} else {
  initializeAllAnimations();
}

setTimeout(() => {
  try {
    initializeScrollAnimations();
  } catch (e) {
    console.warn("Animation retry failed:", e);
  }
}, 300);

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AnimationController,
    initializeScrollAnimations,
    initializeAllAnimations,
    addProductCardAnimations,
    animateProductsOnLoad,
    enhanceFeatureCards,
    enhanceNavbarAnimations,
    enhanceButtonAnimations,
    enhanceParallaxEffects: initializeParallaxEffects,
    runHeroOnceOnly,
  };
}

window.AnimationController = AnimationController;
window.initializeScrollAnimations = initializeScrollAnimations;
window.addProductCardAnimations = addProductCardAnimations;
window.initializeAllAnimations = initializeAllAnimations;
