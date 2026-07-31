// hero image slider + hero rotating text (Issue #1272 Touch-Gesture Optimization)

/**
 * TouchInertiaCarousel - Optimized Hardware-Accelerated Touch Carousel
 * Features:
 *  - Passive event listeners ({ passive: true }) to eliminate main-thread scroll blocking
 *  - rAF (requestAnimationFrame) throttled updates to avoid layout shifts (CLS) & dropped frames
 *  - Dynamic inertia calculation (fling physics with exponential velocity decay)
 *  - Full event listener & timer cleanup on destroy to eliminate memory leaks
 */
class TouchInertiaCarousel {
    constructor(element, options = {}) {
        if (!element) return;
        this.container = typeof element === 'string' ? document.querySelector(element) : element;
        if (!this.container) return;

        // Prevent duplicate initializations (Memory Leak fix)
        if (this.container.__touchCarouselInstance) {
            this.container.__touchCarouselInstance.destroy();
        }
        this.container.__touchCarouselInstance = this;

        this.options = Object.assign({
            friction: 0.94,
            velocityMultiplier: 1.2,
            minVelocityThreshold: 0.08,
            onSwipeNext: null,
            onSwipePrev: null
        }, options);

        this.isDragging = false;
        this.startX = 0;
        this.lastX = 0;
        this.lastTime = 0;
        this.velocity = 0;
        this.rafId = null;

        // Bound listener callbacks for clean removal
        this.handleTouchStart = this.handleTouchStart.bind(this);
        this.handleTouchMove = this.handleTouchMove.bind(this);
        this.handleTouchEnd = this.handleTouchEnd.bind(this);
        this.handleTouchCancel = this.handleTouchCancel.bind(this);

        this.init();
    }

    init() {
        this.container.classList.add('touch-carousel');
        const options = { passive: true };
        this.container.addEventListener('touchstart', this.handleTouchStart, options);
        this.container.addEventListener('touchmove', this.handleTouchMove, options);
        this.container.addEventListener('touchend', this.handleTouchEnd, options);
        this.container.addEventListener('touchcancel', this.handleTouchCancel, options);

        this.container.addEventListener('mousedown', this.handleTouchStart, options);
        this.container.addEventListener('mousemove', this.handleTouchMove, options);
        this.container.addEventListener('mouseup', this.handleTouchEnd, options);
        this.container.addEventListener('mouseleave', this.handleTouchCancel, options);
    }

    handleTouchStart(e) {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        const point = e.touches ? e.touches[0] : e;
        this.isDragging = true;
        this.startX = point.clientX;
        this.lastX = point.clientX;
        this.lastTime = performance.now();
        this.velocity = 0;

        this.container.classList.add('is-dragging');
    }

    handleTouchMove(e) {
        if (!this.isDragging) return;

        const point = e.touches ? e.touches[0] : e;
        const now = performance.now();
        const deltaX = this.lastX - point.clientX;
        const deltaTime = Math.max(1, now - this.lastTime);

        this.velocity = (deltaX / deltaTime) * this.options.velocityMultiplier;
        this.lastX = point.clientX;
        this.lastTime = now;

        if (!this.rafId) {
            this.rafId = requestAnimationFrame(() => {
                this.container.scrollLeft += deltaX;
                this.rafId = null;
            });
        }
    }

    handleTouchEnd(e) {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.container.classList.remove('is-dragging');

        const endX = e.changedTouches ? e.changedTouches[0].clientX : this.lastX;
        const totalDelta = this.startX - endX;

        if (Math.abs(totalDelta) > 50) {
            if (totalDelta > 0 && typeof this.options.onSwipeNext === 'function') {
                this.options.onSwipeNext();
            } else if (totalDelta < 0 && typeof this.options.onSwipePrev === 'function') {
                this.options.onSwipePrev();
            }
        }

        this.applyInertia();
    }

    handleTouchCancel() {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.container.classList.remove('is-dragging');
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    applyInertia() {
        if (Math.abs(this.velocity) < this.options.minVelocityThreshold) {
            return;
        }

        const step = () => {
            if (Math.abs(this.velocity) < this.options.minVelocityThreshold) {
                this.rafId = null;
                return;
            }

            this.container.scrollLeft += this.velocity * 16;
            this.velocity *= this.options.friction;

            this.rafId = requestAnimationFrame(step);
        };

        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(step);
    }

    destroy() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        const options = { passive: true };
        if (this.container) {
            this.container.removeEventListener('touchstart', this.handleTouchStart, options);
            this.container.removeEventListener('touchmove', this.handleTouchMove, options);
            this.container.removeEventListener('touchend', this.handleTouchEnd, options);
            this.container.removeEventListener('touchcancel', this.handleTouchCancel, options);

            this.container.removeEventListener('mousedown', this.handleTouchStart, options);
            this.container.removeEventListener('mousemove', this.handleTouchMove, options);
            this.container.removeEventListener('mouseup', this.handleTouchEnd, options);
            this.container.removeEventListener('mouseleave', this.handleTouchCancel, options);

            this.container.classList.remove('touch-carousel', 'is-dragging');
            delete this.container.__touchCarouselInstance;
        }
    }
}

window.TouchInertiaCarousel = TouchInertiaCarousel;

const heroTexts = [
    "Limited Deals",
    "Value Offers",
    "Save upto 70%",
    "New Arrivals"
];

let heroIntervalId = null;

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

    const nextSlide = () => {
        slides[index].classList.remove('is-active');
        index = (index + 1) % slides.length;
        slides[index].classList.add('is-active');
    };

    const prevSlide = () => {
        slides[index].classList.remove('is-active');
        index = (index - 1 + slides.length) % slides.length;
        slides[index].classList.add('is-active');
    };

    if (heroIntervalId) clearInterval(heroIntervalId);
    heroIntervalId = setInterval(nextSlide, 4000);

    // Attach touch gestures for mobile swipe
    new TouchInertiaCarousel(slider, {
        onSwipeNext: nextSlide,
        onSwipePrev: prevSlide
    });
}

initHeroSlider();

let heroIndex = 0;
const heroHeading = document.querySelector("#hero h1");

if (heroHeading) {
    setInterval(() => {
        heroIndex = (heroIndex + 1) % heroTexts.length;
        heroHeading.style.opacity = "0";

        setTimeout(() => {
            heroHeading.innerText = heroTexts[heroIndex];
            heroHeading.style.opacity = "1";
        }, 300);
    }, 4000);
}

// countdown timer
const countdown = document.getElementById("countdown");

if (countdown) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 5);

    function updateCountdown() {
        const now = new Date().getTime();
        const distance = targetDate - now;

        if (distance < 0) {
            countdown.innerHTML = "Offer Expired ";
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        countdown.innerHTML = `${days}d ${hours}h ${minutes}m`;
    }

    updateCountdown();
    setInterval(updateCountdown, 60000);
}
