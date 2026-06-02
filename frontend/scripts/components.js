// load component
const loadComponent =
    async (
        id,
        file
    ) => {

        const element =
            document.getElementById(
                id
            );

        if (
            !element
        ) {
            return false;
        }

        element.innerHTML =
            `
                <div class="component-loading">
                    Loading...
                </div>
            `;

        try {
            const controller =
                new AbortController();

            const timeout =
                setTimeout(
                    () => {
                        controller.abort();
                    },
                    8000
                );

            const response =
                await fetch(
                    file,
                    {
                        signal:
                            controller.signal
                    }
                );

            clearTimeout(
                timeout
            );

            if (
                !response.ok
            ) {
                throw new Error(
                    `Failed to load ${file}`
                );
            }

            const data =
                await response.text();

            element.innerHTML =
                data;

            return true;

        } catch (error) {
            console.error(
                `Error loading component: ${file}`,
                error
            );

            element.innerHTML =
                `
                    <div class="component-error">
                        Failed to load component.
                    </div>
                `;

            return false;
        }
    };

// initialize components
async function initializeComponents() {
    await Promise.all([
        loadComponent(
            "navbar",
            "components/navbar.html"
        ),

        loadComponent(
            "footer",
            "components/footer.html"
        )
    ]);

    // notify components ready
    document.dispatchEvent(
        new CustomEvent(
            "componentsLoaded"
        )
    );

    // Initialize newsletter
    initializeNewsletter();
}

// newsletter helper
function initializeNewsletter() {
    const newsletterForm = document.querySelector("#newsletter form, #newsletter .form");
    if (!newsletterForm) {
        return;
    }

    if (newsletterForm.tagName === "FORM") {
        newsletterForm.addEventListener("submit", handleNewsletterSubmit);
    } else {
        const button = newsletterForm.querySelector("button");
        if (button) {
            button.addEventListener("click", handleNewsletterSubmit);
        }
        // Also listen to enter key in input
        const input = newsletterForm.querySelector("input");
        if (input) {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    handleNewsletterSubmit(e);
                }
            });
        }
    }
}

function handleNewsletterSubmit(event) {
    event.preventDefault();
    const form = document.querySelector("#newsletter form, #newsletter .form");
    if (!form) return;

    const input = form.querySelector("input");
    const email = input?.value.trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !validEmail.test(email)) {
        if (typeof window.showToast === "function") {
            window.showToast("Please enter a valid email", "error");
        } else if (typeof notify === "function") {
            notify("Please enter a valid email", "error");
        } else {
            alert("Please enter a valid email");
        }
        return;
    }

    if (typeof window.showToast === "function") {
        window.showToast("Newsletter subscription successful!", "success");
    } else if (typeof notify === "function") {
        notify("Newsletter subscription successful!", "success");
    } else {
        alert("Newsletter subscription successful!");
    }

    if (form.tagName === "FORM") {
        form.reset();
    } else if (input) {
        input.value = "";
    }
}

// init
document.addEventListener(
    "DOMContentLoaded",
    () => {
        initializeComponents();
    }
);