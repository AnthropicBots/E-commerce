// Wrapped in an IIFE so top-level names (cart, elements, escapeHTML, ...)
// stay local and don't collide with the globals declared by other scripts
// loaded on this page (e.g. auth.js also declares `const elements`).
(() => {

// CART STATE
// kept in a mutable binding and re-read on every render so the summary
// reflects the latest cart (e.g. after the backend sync finishes on login)
let cart =
    AppUtils.getCart();

// require authentication
const currentUser =
    AppUtils.requireAuth();

if (
    !currentUser
) {

    throw new Error(
        "Authentication required"
    );
}

// EMPTY CART REDIRECT
if (
    !AppUtils.safeArray(
        cart
    ).length
) {

    AppUtils.notify(
        "Your cart is empty!",
        "error"
    );

    setTimeout(
        () => {

            window.location.href =
                "cart.html";

        },
        1000
    );

    throw new Error(
        "Empty cart"
    );
}

// CHECKOUT ELEMENTS
const elements = {
    checkoutItems:
        document.getElementById(
            "checkout-items"
        ),

    subtotal:
        document.getElementById(
            "checkout-subtotal"
        ),

    tax:
        document.getElementById(
            "checkout-tax"
        ),

    shipping:
        document.getElementById(
            "checkout-shipping"
        ),

    total:
        document.getElementById(
            "checkout-total"
        ),

    cardDetails:
        document.getElementById(
            "card-details"
        ),

    checkoutForm:
        document.getElementById(
            "checkout-form"
        ),

    paymentMethods:
        document.querySelectorAll(
            'input[name="payment"]'
        ),

    fullName:
        document.getElementById(
            "full-name"
        ),

    email:
        document.getElementById(
            "email"
        ),

    phone:
        document.getElementById(
            "phone"
        ),

    city:
        document.getElementById(
            "city"
        ),

    state:
        document.getElementById(
            "state"
        ),

    zip:
        document.getElementById(
            "zip"
        ),

    address:
        document.getElementById(
            "address"
        ),

    cardNumber:
        document.getElementById(
            "card-number"
        ),

    expiry:
        document.getElementById(
            "expiry"
        ),

    cvv:
        document.getElementById(
            "cvv"
        ),

    placeOrderBtn:
        document.querySelector(
            '#checkout-form button[type="submit"]'
        ),

    promoInput:
        document.getElementById("promo-code-input"),

    applyPromoBtn:
        document.getElementById("apply-promo-btn"),

    promoMessage:
        document.getElementById("promo-message"),

    discountRow:
        document.getElementById("checkout-discount-row"),

    discountAmount:
        document.getElementById("checkout-discount"),

    promoLabel:
        document.getElementById("applied-promo-label")
};

// PROMO STATE
let appliedPromo = null;
let currentDiscount = 0;

// escape html
function escapeHTML(
    value
) {

    return String(
        value || ""
    )

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );
}

// SAFE HELPERS
function safePrice(
    value
) {

    const parsed =
        parseFloat(
            value
        );

    return isNaN(parsed)
        ? 0
        : parsed;
}

function safeQty(
    value
) {

    const parsed =
        parseInt(
            value,
            10
        );

    return isNaN(parsed)
        ? 1
        : Math.max(
            1,
            parsed
        );
}

// cart items may carry `qty` (local) or `quantity` (backend sync)
function itemQty(
    item
) {

    return safeQty(
        item && item.qty != null
            ? item.qty
            : item && item.quantity
    );
}

// INLINE FIELD ERRORS
function showError(
    input,
    message
) {

    if (!input) {
        return;
    }

    input.classList.add("invalid");

    const errorEl =
        document.getElementById(
            `${input.id}-error`
        );

    if (errorEl) {
        errorEl.textContent = message;
    }
}

function clearError(
    input
) {

    if (!input) {
        return;
    }

    input.classList.remove("invalid");

    const errorEl =
        document.getElementById(
            `${input.id}-error`
        );

    if (errorEl) {
        errorEl.textContent = "";
    }
}

// Luhn checksum for card numbers
function luhnValid(
    number
) {

    let sum = 0;
    let shouldDouble = false;

    for (let i = number.length - 1; i >= 0; i--) {

        let digit = parseInt(number[i], 10);

        if (shouldDouble) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }

        sum += digit;
        shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
}

// MM/YY expiry that is a real month and not in the past
function isValidExpiry(
    value
) {

    const match =
        /^(\d{2})\/(\d{2})$/.exec(value);

    if (!match) {
        return false;
    }

    const month = parseInt(match[1], 10);
    const year = 2000 + parseInt(match[2], 10);

    if (month < 1 || month > 12) {
        return false;
    }

    const now = new Date();

    // first day of the month AFTER the expiry month
    const expiryEnd = new Date(year, month, 1);

    return expiryEnd > now;
}

// CALCULATE TOTALS
function calculateTotals() {

    const subtotal =
        cart.reduce(
            (
                sum,
                item
            ) => {

                return (
                    sum +
                    (
                        safePrice(
                            item.price
                        ) *
                        itemQty(
                            item
                        )
                    )
                );
            },
            0
        );

    const tax =
        subtotal * 0.18;

    const shipping =
        subtotal > 0
        &&
        subtotal < 999
            ? 49
            : 0;

    const total =
        Math.max(0, subtotal - currentDiscount) +
        tax +
        shipping;

    return {
        subtotal,
        tax,
        shipping,
        discount: currentDiscount,
        total
    };
}

// RENDER CHECKOUT
function renderCheckout() {

    if (
        !elements.checkoutItems
    ) {
        return;
    }

    // re-read so the summary reflects the latest cart state
    cart =
        AppUtils.safeArray(
            AppUtils.getCart()
        );

    elements.checkoutItems.innerHTML =
        "";

    const fragment =
        document.createDocumentFragment();

    cart.forEach(
        (
            item
        ) => {

            const qty =
                itemQty(
                    item
                );

            const price =
                safePrice(
                    item.price
                );

            const itemTotal =
                qty * price;

            const div =
                document.createElement(
                    "div"
                );

            div.classList.add(
                "checkout-item"
            );

            div.innerHTML =
                `
                    <div class="checkout-item-info">

                        <span>
                            ${escapeHTML(
                                item.name || "Product"
                            )}
                        </span>

                        <small>
                            Qty: ${qty}
                        </small>

                    </div>

                    <span>
                        ${
                            AppUtils.formatPrice(
                                itemTotal
                            )
                        }
                    </span>
                `;

            fragment.appendChild(
                div
            );
        }
    );

    elements.checkoutItems.appendChild(
        fragment
    );

    const totals =
        calculateTotals();

    if (
        elements.subtotal
    ) {

        elements.subtotal.innerText =
            AppUtils.formatPrice(
                totals.subtotal
            );
    }

    if (
        elements.tax
    ) {

        elements.tax.innerText =
            AppUtils.formatPrice(
                totals.tax
            );
    }

    if (
        elements.shipping
    ) {

        elements.shipping.innerText =
            totals.shipping === 0
                ? "Free"
                : AppUtils.formatPrice(
                    totals.shipping
                );
    }

    if (
        elements.discountRow
    ) {
        if (currentDiscount > 0) {
            elements.discountRow.style.display = "flex";
            elements.discountAmount.innerText = "- " + AppUtils.formatPrice(currentDiscount);
            if (appliedPromo) {
                elements.promoLabel.innerText = appliedPromo.code;
            }
        } else {
            elements.discountRow.style.display = "none";
        }
    }

    if (
        elements.total
    ) {

        elements.total.innerText =
            AppUtils.formatPrice(
                totals.total
            );
    }
}

renderCheckout();

// PROMO LOGIC
if (elements.applyPromoBtn) {
    elements.applyPromoBtn.addEventListener("click", async () => {
        const code = elements.promoInput.value.trim();
        
        if (!code) {
            elements.promoMessage.innerText = "Please enter a promo code";
            elements.promoMessage.style.color = "red";
            return;
        }

        if (appliedPromo && appliedPromo.code === code) {
            return; // Already applied
        }

        // If removing
        if (elements.applyPromoBtn.innerText === "Remove") {
            appliedPromo = null;
            currentDiscount = 0;
            elements.promoInput.value = "";
            elements.promoInput.disabled = false;
            elements.applyPromoBtn.innerText = "Apply";
            elements.applyPromoBtn.style.background = "#088178";
            elements.promoMessage.innerText = "Promo code removed";
            elements.promoMessage.style.color = "#333";
            renderCheckout();
            return;
        }

        elements.applyPromoBtn.innerText = "Validating...";
        elements.applyPromoBtn.disabled = true;

        try {
            const { subtotal } = calculateTotals();
            
            const data = await AppUtils.apiRequest("/promos/validate", {
                method: "POST",
                body: JSON.stringify({ promoCode: code, cartTotal: subtotal })
            });

            if (data.success) {
                appliedPromo = data.promo;
                currentDiscount = data.discount;
                elements.promoMessage.innerText = `Promo applied successfully! You saved ${AppUtils.formatPrice(currentDiscount)}`;
                elements.promoMessage.style.color = "green";
                
                elements.promoInput.disabled = true;
                elements.applyPromoBtn.innerText = "Remove";
                elements.applyPromoBtn.style.background = "#d9534f";
                
                renderCheckout();
            } else {
                elements.promoMessage.innerText = data.message || "Invalid promo code";
                elements.promoMessage.style.color = "red";
            }
        } catch (error) {
            elements.promoMessage.innerText = "Error validating promo code";
            elements.promoMessage.style.color = "red";
        } finally {
            elements.applyPromoBtn.disabled = false;
            if (!appliedPromo) {
                elements.applyPromoBtn.innerText = "Apply";
            }
        }
    });
}

// PAYMENT METHOD TOGGLE
// show card fields only for the card method; clear their errors otherwise
function syncCardDetailsVisibility() {

    const selected =
        document.querySelector(
            'input[name="payment"]:checked'
        );

    const isCard =
        selected
        &&
        selected.value === "card";

    if (
        elements.cardDetails
    ) {
        elements.cardDetails.style.display =
            isCard
                ? "block"
                : "none";
    }

    if (!isCard) {
        clearError(elements.cardNumber);
        clearError(elements.expiry);
        clearError(elements.cvv);
    }
}

elements.paymentMethods.forEach(
    (
        method
    ) => {

        method.addEventListener(
            "change",
            syncCardDetailsVisibility
        );
    }
);

// set the correct initial visibility
syncCardDetailsVisibility();

// VALIDATION
function validateCheckoutForm() {

    let valid = true;

    const fail = (
        input,
        message
    ) => {
        showError(input, message);
        valid = false;
    };

    // clear previous errors
    [
        elements.fullName,
        elements.email,
        elements.phone,
        elements.city,
        elements.state,
        elements.zip,
        elements.address,
        elements.cardNumber,
        elements.expiry,
        elements.cvv
    ].forEach(clearError);

    // billing fields
    if (!elements.fullName.value.trim()) {
        fail(elements.fullName, "Full name is required.");
    }

    const email = elements.email.value.trim();

    if (!email) {
        fail(elements.email, "Email address is required.");
    } else if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        fail(elements.email, "Enter a valid email address.");
    }

    const phone = elements.phone.value.trim();

    if (!phone) {
        fail(elements.phone, "Phone number is required.");
    } else if (
        !/^[6-9]\d{9}$/.test(phone)
    ) {
        fail(elements.phone, "Enter a valid 10-digit phone number.");
    }

    if (!elements.city.value.trim()) {
        fail(elements.city, "City is required.");
    }

    if (!elements.state.value.trim()) {
        fail(elements.state, "State is required.");
    }

    const zip = elements.zip.value.trim();

    if (!zip) {
        fail(elements.zip, "ZIP / PIN code is required.");
    } else if (
        !/^\d{5,6}$/.test(zip)
    ) {
        fail(elements.zip, "Enter a valid 5–6 digit ZIP / PIN code.");
    }

    if (!elements.address.value.trim()) {
        fail(elements.address, "Address is required.");
    }

    // payment method
    const selectedPayment =
        document.querySelector(
            'input[name="payment"]:checked'
        );

    if (!selectedPayment) {

        AppUtils.notify(
            "Select a payment method.",
            "error"
        );

        valid = false;

    } else if (selectedPayment.value === "card") {

        // card details are only required when paying by card
        const cardNumber =
            (elements.cardNumber.value || "")
                .replace(/\s+/g, "");

        if (!cardNumber) {
            fail(elements.cardNumber, "Card number is required.");
        } else if (
            !/^\d{13,19}$/.test(cardNumber)
            ||
            !luhnValid(cardNumber)
        ) {
            fail(elements.cardNumber, "Enter a valid card number.");
        }

        const expiry = elements.expiry.value.trim();

        if (!expiry) {
            fail(elements.expiry, "Expiry date is required.");
        } else if (!isValidExpiry(expiry)) {
            fail(elements.expiry, "Enter a valid future expiry (MM/YY).");
        }

        const cvv = elements.cvv.value.trim();

        if (!cvv) {
            fail(elements.cvv, "CVV is required.");
        } else if (
            !/^\d{3,4}$/.test(cvv)
        ) {
            fail(elements.cvv, "Enter a valid 3–4 digit CVV.");
        }
    }

    if (!valid) {

        AppUtils.notify(
            "Please correct the highlighted fields.",
            "error"
        );

        const firstInvalid =
            document.querySelector(
                "#checkout-form .invalid"
            );

        if (firstInvalid) {
            firstInvalid.focus();
        }
    }

    return valid;
}

// clear a field's error as soon as the user edits it
[
    elements.fullName,
    elements.email,
    elements.phone,
    elements.city,
    elements.state,
    elements.zip,
    elements.address,
    elements.cardNumber,
    elements.expiry,
    elements.cvv
].forEach(
    (input) => {

        if (!input) {
            return;
        }

        input.addEventListener(
            "input",
            () => clearError(input)
        );
    }
);

// CREATE ORDER PAYLOAD
function createOrderPayload() {

    const selectedPayment =
        document.querySelector(
            'input[name="payment"]:checked'
        );

    const totals =
        calculateTotals();

    return {

        customer: {

            name:
                elements.fullName.value.trim(),

            email:
                elements.email.value.trim(),

            phone:
                elements.phone.value.trim()
        },

        address: {

            city:
                elements.city.value.trim(),

            state:
                elements.state.value.trim(),

            zip:
                elements.zip.value.trim(),

            fullAddress:
                elements.address.value.trim()
        },

        paymentMethod:
            selectedPayment.value
                .toLowerCase(),

        total:
            totals.total,
            
        promoCode: appliedPromo ? appliedPromo.code : null,

        items:
            AppUtils.safeArray(
                cart
            ).map(
                (
                    item
                ) => ({

                    id:
                        item.id,

                    qty:
                        itemQty(
                            item
                        ),

                    color:
                        item.color || "",

                    size:
                        item.size || ""
                })
            )
    };
}

// PLACE ORDER
let isSubmitting =
    false;

if (
    elements.checkoutForm
) {

    elements.checkoutForm.addEventListener(
        "submit",
        async (
            event
        ) => {

            event.preventDefault();

            if (
                isSubmitting
            ) {
                return;
            }

            if (
                !validateCheckoutForm()
            ) {
                return;
            }

            isSubmitting =
                true;

            // loading button
            if (
                elements.placeOrderBtn
            ) {

                elements.placeOrderBtn.disabled =
                    true;

                elements.placeOrderBtn.innerText =
                    "Processing...";
            }

            const order =
                createOrderPayload();

            try {

                const data =
                    await AppUtils.apiRequest(
                        "/orders",
                        {
                            method: "POST",
                            body:
                                JSON.stringify(
                                    order
                                )
                        }
                    );

                if (
                    data.success
                ) {

                    AppUtils.notify(
                        "Order placed successfully! 🎉",
                        "success"
                    );

                    // clear cart
                    AppUtils.saveCart(
                        []
                    );

                    // update ui
                    if (
                        typeof updateCartCount ===
                        "function"
                    ) {

                        updateCartCount();
                    }

                    if (
                        typeof renderCartDrawer ===
                        "function"
                    ) {

                        renderCartDrawer();
                    }

                    // redirect
                    setTimeout(
                        () => {

                            window.location.href =
                                `success.html?id=${data.orderId}`;

                        },
                        1200
                    );

                } else {

                    AppUtils.notify(
                        data.message ||
                        "Failed to place order.",
                        "error"
                    );
                }

            } catch (
                error
            ) {

                console.error(
                    "ORDER ERROR:",
                    error
                );

                AppUtils.notify(
                    "Failed to place order.",
                    "error"
                );

            } finally {

                isSubmitting =
                    false;

                if (
                    elements.placeOrderBtn
                ) {

                    elements.placeOrderBtn.disabled =
                        false;

                    elements.placeOrderBtn.innerText =
                        "Place Order";
                }
            }
        }
    );
}

})();