// ELEMENTS
const elements = {
    contactForm: document.getElementById("contact-form"),
    name: document.getElementById("name"),
    email: document.getElementById("email"),
    subject: document.getElementById("subject"),
    message: document.getElementById("message")
};

// CONTACT FORM SUBMISSION
if (elements.contactForm) {
    elements.contactForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = elements.name.value.trim();
        const email = elements.email.value.trim();
        const subject = elements.subject.value.trim();
        const message = elements.message.value.trim();

        if (!name || !email || !subject || !message) {
            notify("Please fill all fields.", "error");
            return;
        }
        
        const emailRegex = /^[^ ]+@[^ ]+\.[a-z]{2,3}$/;
        if (!emailRegex.test(email)) {
            notify("Please enter a valid email.", "error");
            return;
        }
        
        notify("Message submitted successfully!", "success");
        elements.contactForm.reset();
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