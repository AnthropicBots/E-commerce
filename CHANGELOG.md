# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
- Add engaging, lightweight animations to the home page:
  - Hero: slide/fade-in headings, description, CTA; subtle background transition and CTA hover glow.
  - Feature cards: hover scale/elevation and entrance animations.
  - Featured products & new arrivals: fade-up and staggered card entrances; image hover zoom and button hover polish.
  - Navigation: smooth hover transitions and active underline animation.
  - Accessibility: honors `prefers-reduced-motion`.
  - Implementation: CSS keyframes + Intersection Observer-based scroll triggers in `frontend/scripts/animations.js`.

Files changed:
- `frontend/styles/animations.css` (new)
- `frontend/scripts/animations.js` (new)
- `frontend/index.html` (updated to include animations)
- `frontend/styles/hero.css` (updated)
- `frontend/styles/components.css` (updated)
