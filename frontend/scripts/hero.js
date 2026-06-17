// hero image slider + hero rotating text
const heroTexts = [
    "Limited Deals",
    "Value Offers",
    "Save upto 70%",
    "New Arrivals"
];

function initHeroSlider() {
    const slider = document.getElementById('hero-slider');
    if (!slider) return;

    const slides = Array.from(slider.querySelectorAll('.hero-slide'));
    if (!slides.length) return;

    let index = 0;

    slides.forEach((img, i) => {
        if (i === 0) img.classList.add('is-active');
        else img.classList.remove('is-active');
    });

    setInterval(() => {
        slides[index].classList.remove('is-active');
        index = (index + 1) % slides.length;
        slides[index].classList.add('is-active');
    }, 4000);
}

initHeroSlider();

let heroIndex = 0;
const heroHeading =
    document.querySelector(
        "#hero h1"
    );

if (heroHeading) {
    setInterval(() => {
        heroIndex =
            (
                heroIndex + 1
            ) % heroTexts.length;

        heroHeading.style.opacity =
            "0";

        setTimeout(
            () => {
                heroHeading.innerText =
                    heroTexts[
                        heroIndex
                    ];

                heroHeading.style.opacity =
                    "1";
            },
            300
        );

    }, 4000);
}

// countdown timer
const countdown =
    document.getElementById(
        "countdown"
    );

if (countdown) {
    const targetDate =
        new Date();

    targetDate.setDate(
        targetDate.getDate() + 5
    );

    function updateCountdown() {
        const now =
            new Date().getTime();

        const distance =
            targetDate - now;

        if (distance < 0) {
            countdown.innerHTML =
                "Offer Expired ";

            return;
        }

        const days =
            Math.floor(
                distance /
                (
                    1000 *
                    60 *
                    60 *
                    24
                )
            );

        const hours =
            Math.floor(
                (
                    distance %
                    (
                        1000 *
                        60 *
                        60 *
                        24
                    )
                ) /
                (
                    1000 *
                    60 *
                    60
                )
            );

        const minutes =
            Math.floor(
                (
                    distance %
                    (
                        1000 *
                        60 *
                        60
                    )
                ) /
                (
                    1000 *
                    60
                )
            );
        countdown.innerHTML =
            `${days}d ${hours}h ${minutes}m`;
    }

    updateCountdown();
    setInterval(
        updateCountdown,
        60000
    );
}

