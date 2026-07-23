// CART STATE
const cart =
    AppUtils.getCart();

const appliedCoupon =
    AppUtils.getJSON(
        "appliedCoupon",
        ""
    );

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

    addressCounter:
        document.getElementById(
            "address-char-count"
        ),

    placeOrderBtn:
        document.querySelector(
            '#checkout-form button[type="submit"]'
        )
};

const ADDRESS_LIMIT = 250;

function updateAddressCharacterCount() {

    if (
        !elements.address ||
        !elements.addressCounter
    ) {
        return;
    }

    const length =
        elements.address.value.length;

    elements.addressCounter.textContent =
        length;

    const counter =
        elements.addressCounter.parentElement;

    if (
        length >= (ADDRESS_LIMIT - 20)
    ) {

        counter.classList.add(
            "limit-reached"
        );

        elements.address.classList.add(
            "limit-reached"
        );

    } else {

        counter.classList.remove(
            "limit-reached"
        );

        elements.address.classList.remove(
            "limit-reached"
        );
    }
}

if (
    elements.address
) {

    updateAddressCharacterCount();

    elements.address.addEventListener(
        "input",
        updateAddressCharacterCount
    );
}

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

// CALCULATE TOTALS
function calculateTotals() {

    return AppUtils.calculateCartTotals(
        cart,
        appliedCoupon
    );
}

// RENDER CHECKOUT
function renderCheckout() {

    if (
        !elements.checkoutItems
    ) {
        return;
    }

    elements.checkoutItems.innerHTML =
        "";

    const fragment =
        document.createDocumentFragment();

    cart.forEach(
        (
            item
        ) => {

            const qty =
                safeQty(
                    item.qty
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
        elements.total
    ) {

        elements.total.innerText =
            AppUtils.formatPrice(
                totals.total
            );
    }
}

renderCheckout();

// STRIPE SETUP
let stripe, elementsStripe, cardElement;
try {
    stripe = Stripe('pk_test_TYooMQauvdEDq54NiTphI7jx'); // Placeholder key
    elementsStripe = stripe.elements();
    cardElement = elementsStripe.create('card', {
        style: {
            base: {
                color: '#32325d',
                fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
                fontSmoothing: 'antialiased',
                fontSize: '16px',
                '::placeholder': {
                    color: '#aab7c4'
                }
            },
            invalid: {
                color: '#fa755a',
                iconColor: '#fa755a'
            }
        }
    });
    
    if (elements.cardDetails) {
        cardElement.mount('#card-element');
        cardElement.on('change', function(event) {
            const displayError = document.getElementById('card-errors');
            if (event.error) {
                displayError.textContent = event.error.message;
            } else {
                displayError.textContent = '';
            }
        });
    }
} catch(e) {
    console.error("Stripe initialization failed", e);
}

// PAYMENT METHOD TOGGLE
elements.paymentMethods.forEach((method) => {
    method.addEventListener("change", () => {
        if (!elements.cardDetails) return;
        elements.cardDetails.style.display = method.value === "card" ? "block" : "none";
    });
});

function validateCheckoutForm() {

    let isValid = true;

    // helper to show/clear inline errors
    function showError(fieldId, errorId, message) {
        const field = document.getElementById(fieldId);
        const error = document.getElementById(errorId);
        if (!field.value.trim()) {
            if (error) error.textContent = message;
            field.style.border = "1px solid red";
            isValid = false;
        } else {
            if (error) error.textContent = "";
            field.style.border = "";
        }
    }

    // validate each field
    showError("full-name", "full-name-error", "Full name is required.");
    showError("email", "email-error", "Email address is required.");
    showError("phone", "phone-error", "Phone number is required.");
    showError("city", "city-error", "City is required.");
    showError("state", "state-error", "State is required.");
    showError("zip", "zip-error", "ZIP code is required.");
    showError("address", "address-error", "Address is required.");

    if (!isValid) {
        AppUtils.notify("Please fill all required fields.", "error");
        return false;
    }

    // email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(elements.email.value.trim())) {
        document.getElementById("email-error").textContent =
            "Enter a valid email address.";
        elements.email.style.border = "1px solid red";
        AppUtils.notify("Enter a valid email address.", "error");
        return false;
    }

    // phone validation
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(elements.phone.value.trim())) {
        document.getElementById("phone-error").textContent =
            "Enter a valid 10-digit phone number.";
        elements.phone.style.border = "1px solid red";
        AppUtils.notify("Enter a valid 10-digit phone number.", "error");
        return false;
    }

    // zip validation
    const zipRegex = /^\d{5,6}$/;
    if (!zipRegex.test(elements.zip.value.trim())) {
        document.getElementById("zip-error").textContent =
            "Enter a valid ZIP / PIN code.";
        elements.zip.style.border = "1px solid red";
        AppUtils.notify("Enter a valid ZIP / PIN code.", "error");
        return false;
    }

    // payment method
    const selectedPayment =
        document.querySelector('input[name="payment"]:checked');
    if (!selectedPayment) {
        AppUtils.notify("Select a payment method.", "error");
        return false;
    }

    return true;
}
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
                        safeQty(
                            item.qty
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

            const order = createOrderPayload();
            const selectedPaymentMethod = order.paymentMethod;

            try {
                if (selectedPaymentMethod === "card") {
                    // 1. Create Payment Intent
                    const intentRes = await AppUtils.apiRequest("/orders/create-payment-intent", {
                        method: "POST",
                        body: JSON.stringify(order)
                    });

                    if (!intentRes.success) {
                        throw new Error(intentRes.message || "Failed to initialize payment");
                    }

                    // 2. Confirm Card Payment with Stripe
                    const { error, paymentIntent } = await stripe.confirmCardPayment(intentRes.clientSecret, {
                        payment_method: {
                            card: cardElement,
                            billing_details: {
                                name: order.customer.name,
                                email: order.customer.email
                            }
                        }
                    });

                    if (error) {
                        // Display error in #card-errors
                        const displayError = document.getElementById('card-errors');
                        displayError.textContent = error.message;
                        throw new Error(error.message);
                    } else if (paymentIntent.status === 'succeeded') {
                        AppUtils.notify("Payment successful! Order placed. 🎉", "success");
                    }
                } else {
                    // Fallback for COD/UPI
                    const data = await AppUtils.apiRequest("/orders", {
                        method: "POST",
                        body: JSON.stringify(order)
                    });

                    if (!data.success) {
                        throw new Error(data.message || "Failed to place order");
                    }
                    
                    AppUtils.notify("Order placed successfully! 🎉", "success");
                }

                // clear cart
                AppUtils.clearCart();
                AppUtils.removeStorage("appliedCoupon");

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


