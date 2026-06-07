(() => {
    // ELEMENTS
    const elements = {
        faqBoxes:
            document.querySelectorAll(
                ".faq-box"
            )
    };

    // FAQ TOGGLE
    elements.faqBoxes.forEach(
        (box) => {
            const question =
                box.querySelector(
                    ".faq-question"
                );
            if(!question) return;
            question.addEventListener(
                "click",
                () => {
                    elements.faqBoxes.forEach(
                        (item) => {
                            if(item !== box){
                                item.classList.remove(
                                    "active"
                                );
                                // Reset accessibility state and reset icon for other items
                                const itemQuestion =
                                    item.querySelector(
                                        ".faq-question"
                                    );
                                if (
                                    itemQuestion
                                ) {
                                    itemQuestion.setAttribute(
                                        "aria-expanded",
                                        "false"
                                    );
                                    const icon =
                                        itemQuestion.querySelector(
                                            "i"
                                        );
                                    if (
                                        icon
                                    ) {
                                        icon.className =
                                            "fas fa-plus";
                                    }
                                }
                            }
                        }
                    );
                    box.classList.toggle(
                        "active"
                    );

                    const isActive =
                        box.classList.contains(
                            "active"
                        );
                    question.setAttribute(
                        "aria-expanded",
                        String(isActive)
                    );

                    const icon =
                        question.querySelector(
                            "i"
                        );
                    if (
                        icon
                    ) {
                        icon.className =
                            isActive
                                ? "fas fa-minus"
                                : "fas fa-plus";
                    }
                }
            );
        }
    );
})();