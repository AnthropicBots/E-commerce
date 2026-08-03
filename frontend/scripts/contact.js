// ELEMENTS
const elements = {
    contactForm: document.getElementById("contact-form"),
    name: document.getElementById("name"),
    email: document.getElementById("email"),
    subject: document.getElementById("subject"),
    message: document.getElementById("message")
};

// A top-level domain is two or more letters. The previous `{2,3}` turned away
// .info, .store, .online and every other modern TLD before the request was
// even attempted.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

// The server's floor, so the form says so before a round trip rather than
// after one. Mirrors MIN_MESSAGE_LENGTH in backend/services/contactService.js.
const MIN_MESSAGE_LENGTH = 10;

// CONTACT FORM SUBMISSION
if (elements.contactForm) {
    elements.contactForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const name = elements.name.value.trim();
        const email = elements.email.value.trim();
        const subject = elements.subject.value.trim();
        const message = elements.message.value.trim();

        if (!name || !email || !subject || !message) {
            notify("Please fill all fields.", "error");
            return;
        }

        if (!EMAIL_PATTERN.test(email)) {
            notify("Please enter a valid email.", "error");
            return;
        }

        if (message.length < MIN_MESSAGE_LENGTH) {
            notify(
                `Please write at least ${MIN_MESSAGE_LENGTH} characters so we can help.`,
                "error"
            );
            return;
        }

        const submitButton = elements.contactForm.querySelector(
            "button[type='submit'], input[type='submit']"
        );

        if (submitButton) {
            submitButton.disabled = true;
        }

        try {
            const response = await AppUtils.apiRequest("/contact", {
                method: "POST",
                body: JSON.stringify({ name, email, subject, message })
            });

            // apiRequest resolves with `{ success: false, ... }` on a non-2xx
            // instead of rejecting, so `await` returning is not evidence the
            // message arrived. This branch is the fix for #1445: the form
            // reported "submitted successfully" over a 404 for as long as the
            // endpoint did not exist, and would have gone on doing it for any
            // 4xx or 5xx afterwards.
            if (response && response.success) {
                notify(
                    response.message || "Message submitted successfully!",
                    "success"
                );
                elements.contactForm.reset();
                return;
            }

            notify(
                (response && response.message) ||
                    "Failed to send message. Please try again.",
                "error"
            );
        } catch (error) {
            console.error("CONTACT SUBMIT ERROR:", error);
            notify("Failed to send message. Please try again.", "error");
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
            }
        }
    });
}

// INTERACTIVE STAR RATINGS
// We wrap everything safely to ensure elements exist when the script runs
function initStars() {
    const starRows = document.querySelectorAll('.stars');

    starRows.forEach(row => {
        const stars = row.querySelectorAll('i');

        stars.forEach(star => {
            // 1. Highlight stars on Hover
            star.addEventListener('mouseover', function() {
                const currentHoverValue = parseInt(this.getAttribute('data-value'));
                if (!currentHoverValue) return; // Guard clause if data-value is missing

                stars.forEach(s => {
                    const starValue = parseInt(s.getAttribute('data-value'));
                    s.style.color = (starValue <= currentHoverValue) ? '#ffb300' : '#e2e8f0';
                });
            });

            // 2. Reset back to locked rating when mouse leaves the row
            row.addEventListener('mouseleave', function() {
                stars.forEach(s => {
                    s.style.color = s.classList.contains('active') ? '#ffb300' : '#e2e8f0';
                });
            });

            // 3. Lock the rating when Clicked
            star.addEventListener('click', function() {
                const clickedValue = parseInt(this.getAttribute('data-value'));
                if (!clickedValue) return;

                stars.forEach(s => {
                    const starValue = parseInt(s.getAttribute('data-value'));
                    if (starValue <= clickedValue) {
                        s.classList.add('active');
                    } else {
                        s.classList.remove('active');
                    }
                });
            });
        });
    });
}

// Run script safely regardless of script placement tag type
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initStars);
} else {
    initStars();
}