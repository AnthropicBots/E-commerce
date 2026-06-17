# TODO - Home Page Premium Animations

- [x] Refactor `frontend/scripts/animations.js` into a single reusable animation controller (variants + stagger + reduced-motion support)
- [x] Update hero load animations (heading fade/slide sequence + delayed subheading + staggered CTAs + subtle hero image zoom on load)
- [ ] Ensure scroll-based animations use one IntersectionObserver for sections and product cards (stagger on products)
- [ ] Add/adjust product card hover effects (scale 1.03–1.05 + shadow + image zoom), GPU-friendly (transform/opacity only)
- [ ] Add logo subtle page-load animation + ensure mobile menu slide-in class-based behavior is smooth
- [ ] Ensure dynamic product rendering triggers observer refresh cleanly (`product-cards-home.js`)
- [ ] Validate reduced-motion accessibility behavior
- [ ] Smoke test by loading `frontend/index.html` and scrolling through sections

