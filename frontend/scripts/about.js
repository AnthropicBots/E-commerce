// frontend/scripts/about.js
//
// Fixes #1297.
//
// This file previously contained the same module twice, so `const elements`
// was declared twice at top level:
//
//     SyntaxError: Identifier 'elements' has already been declared
//
// The two copies were not identical -- the first attached the hover
// transforms, the second applied the `.about-section` class -- so neither
// could simply be dropped. They are merged here into a single pass, and both
// behaviours now actually run.

// ELEMENTS
const elements = {
    aboutSections: document.querySelectorAll("#about-head, #about-app")
};

elements.aboutSections.forEach((section) => {
    // ADD ABOUT SECTION CLASS
    section.classList.add("about-section");

    // HOVER EFFECTS
    section.addEventListener("mouseenter", () => {
        section.style.transform = "translateY(-5px)";
        section.style.transition = "0.3s ease";
    });

    section.addEventListener("mouseleave", () => {
        section.style.transform = "translateY(0)";
    });
});
