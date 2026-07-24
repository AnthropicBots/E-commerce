document.addEventListener("DOMContentLoaded", () => {
    initPrivacyPage();
});

function initPrivacyPage() {
    try {
        const sections = document.querySelectorAll("#privacy-policy h3, #privacy-policy h2");
        
        if (!sections || sections.length === 0) {
            console.warn("No policy sections found");
            return;
        }

        const tocContainer = document.getElementById("policy-toc");
        if (tocContainer) {
            generateTableOfContents(sections, tocContainer);
        }

        sections.forEach((section, index) => {
            const sectionId = `section-${index}`;
            section.id = sectionId;

            section.addEventListener("mouseenter", () => {
                section.style.color = "#088178";
                section.style.transition = "0.3s ease";
                section.style.cursor = "pointer";
            });

            section.addEventListener("mouseleave", () => {
                section.style.color = "";
                section.style.cursor = "";
            });

            section.addEventListener("click", () => {
                toggleSection(section);
            });

            section.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleSection(section);
                }
            });

            section.setAttribute("role", "button");
            section.setAttribute("tabindex", "0");
            section.setAttribute("aria-expanded", "false");
        });

        console.log(`Privacy page initialized with ${sections.length} sections`);

    } catch (error) {
        console.error("Error initializing privacy page:", error);
    }
}

function generateTableOfContents(sections, container) {
    const tocList = document.createElement("ul");
    tocList.className = "policy-toc-list";

    sections.forEach((section, index) => {
        const text = section.textContent || `Section ${index + 1}`;
        const listItem = document.createElement("li");
        
        const link = document.createElement("a");
        link.href = `#section-${index}`;
        link.textContent = text;
        link.className = "toc-link";
        
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const target = document.getElementById(`section-${index}`);
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                highlightActiveSection(target);
            }
        });

        listItem.appendChild(link);
        tocList.appendChild(listItem);
    });

    container.appendChild(tocList);
}

function toggleSection(section) {
    const content = section.nextElementSibling;
    const isExpanded = section.getAttribute("aria-expanded") === "true";

    if (content && content.tagName === "P" || content && content.tagName === "UL") {
        if (isExpanded) {
            content.style.display = "none";
            section.setAttribute("aria-expanded", "false");
        } else {
            content.style.display = "block";
            section.setAttribute("aria-expanded", "true");
            section.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    } else {
        const contentContainer = section.parentElement.querySelector(".policy-content");
        if (contentContainer) {
            if (isExpanded) {
                contentContainer.style.display = "none";
                section.setAttribute("aria-expanded", "false");
            } else {
                contentContainer.style.display = "block";
                section.setAttribute("aria-expanded", "true");
                section.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
        }
    }

    highlightActiveSection(section);
}

function highlightActiveSection(section) {
    document.querySelectorAll("#privacy-policy h3, #privacy-policy h2").forEach((s) => {
        s.style.background = "";
        s.style.borderLeft = "";
        s.style.paddingLeft = "";
    });

    section.style.background = "rgba(8, 129, 120, 0.08)";
    section.style.borderLeft = "4px solid #088178";
    section.style.paddingLeft = "12px";

    const tocLinks = document.querySelectorAll(".toc-link");
    tocLinks.forEach((link) => {
        link.style.fontWeight = "normal";
        link.style.color = "";
    });

    const sectionText = section.textContent;
    tocLinks.forEach((link) => {
        if (link.textContent === sectionText) {
            link.style.fontWeight = "bold";
            link.style.color = "#088178";
        }
    });
}

function expandAllSections() {
    const sections = document.querySelectorAll("#privacy-policy h3, #privacy-policy h2");
    sections.forEach((section) => {
        const content = section.nextElementSibling;
        if (content && (content.tagName === "P" || content.tagName === "UL")) {
            content.style.display = "block";
            section.setAttribute("aria-expanded", "true");
        }
        const contentContainer = section.parentElement.querySelector(".policy-content");
        if (contentContainer) {
            contentContainer.style.display = "block";
            section.setAttribute("aria-expanded", "true");
        }
    });
}

function collapseAllSections() {
    const sections = document.querySelectorAll("#privacy-policy h3, #privacy-policy h2");
    sections.forEach((section) => {
        const content = section.nextElementSibling;
        if (content && (content.tagName === "P" || content.tagName === "UL")) {
            content.style.display = "none";
            section.setAttribute("aria-expanded", "false");
        }
        const contentContainer = section.parentElement.querySelector(".policy-content");
        if (contentContainer) {
            contentContainer.style.display = "none";
            section.setAttribute("aria-expanded", "false");
        }
    });
}

function createControls() {
    const container = document.querySelector("#privacy-policy");
    if (!container) return;

    const controls = document.createElement("div");
    controls.className = "policy-controls";
    controls.innerHTML = `
        <button class="policy-btn expand-all-btn" aria-label="Expand all sections">
            <i class="fas fa-plus"></i> Expand All
        </button>
        <button class="policy-btn collapse-all-btn" aria-label="Collapse all sections">
            <i class="fas fa-minus"></i> Collapse All
        </button>
        <button class="policy-btn print-btn" aria-label="Print policy">
            <i class="fas fa-print"></i> Print
        </button>
    `;

    const firstSection = container.querySelector("h2, h3");
    if (firstSection) {
        container.insertBefore(controls, firstSection);
    } else {
        container.prepend(controls);
    }

    const expandBtn = controls.querySelector(".expand-all-btn");
    const collapseBtn = controls.querySelector(".collapse-all-btn");
    const printBtn = controls.querySelector(".print-btn");

    if (expandBtn) {
        expandBtn.addEventListener("click", expandAllSections);
    }
    if (collapseBtn) {
        collapseBtn.addEventListener("click", collapseAllSections);
    }
    if (printBtn) {
        printBtn.addEventListener("click", () => {
            window.print();
        });
    }
}

function addSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener("click", function(e) {
            const targetId = this.getAttribute("href");
            if (targetId && targetId !== "#") {
                const target = document.querySelector(targetId);
                if (target) {
                    e.preventDefault();
                    target.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });
                }
            }
        });
    });
}

function observeVisibility() {
    const sections = document.querySelectorAll("#privacy-policy h3, #privacy-policy h2");
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const section = entry.target;
                highlightActiveSection(section);
            }
        });
    }, {
        threshold: 0.3,
        rootMargin: "0px 0px -100px 0px"
    });

    sections.forEach((section) => {
        observer.observe(section);
    });
}

function getLastUpdated() {
    const lastUpdated = document.getElementById("policy-last-updated");
    if (lastUpdated) {
        const date = new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
        lastUpdated.textContent = `Last Updated: ${date}`;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    createControls();
    initPrivacyPage();
    addSmoothScroll();
    observeVisibility();
    getLastUpdated();
});

export {
    initPrivacyPage,
    toggleSection,
    expandAllSections,
    collapseAllSections,
    generateTableOfContents,
    highlightActiveSection,
    createControls,
    addSmoothScroll,
    observeVisibility
};