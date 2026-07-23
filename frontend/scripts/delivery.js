// ELEMENTS
const elements = {
    scrollBtn: document.getElementById('back-to-top'),
    backBtn: document.querySelector('.back-btn')
};

// SCROLL TO TOP
if (elements.scrollBtn) {
    window.addEventListener('scroll', () => {
        elements.scrollBtn.classList.toggle('visible', window.scrollY > 300);
    });
    elements.scrollBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// BACK BUTTON
if (elements.backBtn) {
    elements.backBtn.addEventListener('click', () => {
        history.back();
    });
}
