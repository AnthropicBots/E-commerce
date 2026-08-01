// CART STATE
const cart =
    AppUtils.getCart();

const appliedCoupon =
    AppUtils.getJSON(
        "appliedCoupon",
        ""
    );

// No sign-in gate. Requiring an account before a stranger can pay is the
// abandonment this page exists to stop causing; the order carries the contact
// details either way, and the server settles who placed it.

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

    shippingMethodNote:
        document.getElementById(
            "checkout-shipping-method"
        ),

    deliveryOptions:
        document.getElementById(
            "delivery-options"
        ),

    freeShippingProgress:
        document.getElementById(
            "free-shipping-progress"
        ),

    discount:
        document.getElementById(
            "checkout-discount"
        ),

    discountRow:
        document.getElementById(
            "checkout-discount-row"
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

// DELIVERY OPTION
//
// Which option the shopper picked, and nothing else. What it costs is never
// held here: the server prices the selection and the summary renders whatever
// comes back, so there is no figure on this page the browser could send.
let selectedShippingMethod =
    null;

// Where the parcel is going, as far as the form knows so far. Rates can depend
// on it, so it travels with every quote; the order is re-priced against the
// address it is actually placed with, so this can only ever be an estimate the
// server has to agree with.
function currentDestination() {

    const pincode =
        elements.zip
            ? elements.zip.value.trim()
            : "";

    if (
        !pincode
    ) {
        return null;
    }

    return {

        pincode,

        city:
            elements.city
                ? elements.city.value.trim()
                : "",

        state:
            elements.state
                ? elements.state.value.trim()
                : ""
    };
}

// CALCULATE TOTALS
async function calculateTotals() {

    return AppUtils.fetchCartQuote(
        cart,
        appliedCoupon,
        selectedShippingMethod,
        currentDestination()
    );
}

function renderDeliveryOptions(
    options,
    currency
) {

    if (
        !elements.deliveryOptions
    ) {
        return;
    }

    const available =
        AppUtils.safeArray(
            options
        );

    if (
        !available.length
    ) {

        // The quote could not be reached, or this basket has nothing to
        // deliver. Saying so is better than an empty box, and leaving the
        // selection untouched means the order still goes out on the default.
        elements.deliveryOptions.innerHTML =
            '<p class="delivery-options-loading">Delivery options are unavailable right now — your order will be sent by our standard service.</p>';

        return;
    }

    elements.deliveryOptions.innerHTML =
        available
            .map(
                (
                    option
                ) => `
                    <label class="delivery-option${option.isSelected ? " is-selected" : ""}">

                        <input
                            type="radio"
                            name="delivery"
                            value="${escapeHTML(option.code)}"
                            ${option.isSelected ? "checked" : ""}
                        >

                        <span class="delivery-option-body">

                            <span class="delivery-option-label">
                                ${escapeHTML(option.label)}
                            </span>

                            <small class="delivery-option-description">
                                ${escapeHTML(option.description || "")}
                            </small>

                        </span>

                        <span class="delivery-option-cost">
                            ${
                                option.cost === 0
                                    ? "Free"
                                    : AppUtils.formatPrice(
                                        option.cost,
                                        currency
                                    )
                            }
                        </span>

                    </label>
                `
            )
            .join("");

    const selected =
        available.find(
            (
                option
            ) => option.isSelected
        );

    selectedShippingMethod =
        selected
            ? selected.code
            : null;

    elements.deliveryOptions
        .querySelectorAll(
            'input[name="delivery"]'
        )
        .forEach(
            (
                input
            ) => {

                input.addEventListener(
                    "change",
                    async () => {

                        selectedShippingMethod =
                            input.value;

                        // Re-price rather than adjust the total locally. The
                        // charge for an option is the server's to state, and
                        // the two must not be able to disagree.
                        await refreshSummary();
                    }
                );
            }
        );
}

function renderTotals(
    totals
) {

    // The breakdown states the currency it was priced in; trust that over the
    // local constant so display can never drift from what is charged.
    const currency =
        totals.currency;

    if (
        elements.subtotal
    ) {

        elements.subtotal.innerText =
            AppUtils.formatPrice(
                totals.subtotal,
                currency
            );
    }

    if (
        elements.tax
    ) {

        elements.tax.innerText =
            AppUtils.formatPrice(
                totals.tax,
                currency
            );
    }

    if (
        elements.shipping
    ) {

        elements.shipping.innerText =
            totals.shipping === 0
                ? "Free"
                : AppUtils.formatPrice(
                    totals.shipping,
                    currency
                );
    }

    if (
        elements.shippingMethodNote
    ) {

        // Naming the option next to the charge is what makes the line
        // reconcilable — "Shipping ₹149" alone does not say what was bought.
        elements.shippingMethodNote.innerText =
            totals.shippingMethod
                ? `(${totals.shippingMethod.label})`
                : "";
    }

    const discount =
        Number(totals.discount) || 0;

    if (
        elements.discountRow
    ) {

        elements.discountRow.style.display =
            discount > 0
                ? ""
                : "none";
    }

    if (
        elements.discount
    ) {

        elements.discount.innerText =
            `-${AppUtils.formatPrice(discount, currency)}`;
    }

    if (
        elements.total
    ) {

        elements.total.innerText =
            AppUtils.formatPrice(
                totals.total,
                currency
            );
    }
}

// Re-price the basket and repaint the summary, returning the figures that were
// shown so the caller can submit exactly those — the shopper must never be
// asked to confirm one total and charged another.
async function refreshSummary() {

    const totals =
        await calculateTotals();

    renderTotals(
        totals
    );

    renderDeliveryOptions(
        totals.shippingOptions,
        totals.currency
    );

    if (
        elements.freeShippingProgress
    ) {

        elements.freeShippingProgress.innerText =
            AppUtils.formatFreeShippingProgress(
                totals.freeShipping,
                totals.currency
            );
    }

    return totals;
}

// A rate can depend on where the parcel is going, so the summary follows the
// address rather than waiting for the order to be placed to reveal the real
// figure. Debounced, because this fires on every keystroke in a PIN code.
if (
    elements.zip
) {

    elements.zip.addEventListener(
        "input",
        AppUtils.debounce(
            () => {

                if (
                    /^\d{5,6}$/.test(
                        elements.zip.value.trim()
                    )
                ) {

                    refreshSummary();
                }
            },
            500
        )
    );
}

// RENDER CHECKOUT
async function renderCheckout() {

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
        await refreshSummary();

    if (
        !totals.isServerQuote
    ) {

        AppUtils.notify(
            "Showing estimated totals — we could not reach the server. Your order will be priced when you place it.",
            "warning"
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
async function createOrderPayload() {

    const selectedPayment =
        document.querySelector(
            'input[name="payment"]:checked'
        );

    const totals =
        await refreshSummary();

    return {

        customer: {

            name:
                elements.fullName.value.trim(),

            email:
                elements.email.value.trim(),

            phone:
                elements.phone.value.trim()
        },

        // Saved address book (#1347). When the shopper picked a saved address,
        // the id goes along with the form values; the backend merges the two,
        // letting explicit form edits win, so picking an address and then
        // changing the phone number does what it looks like it does.
        addressId:
            (window.AddressBook && AddressBook.getSelectedId())
                || null,

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

        // The code only. The server looks up what it costs, so nothing about
        // the delivery charge travels in this payload.
        shippingMethod:
            selectedShippingMethod,

        total:
            totals.total,

        // Without this the backend never sees the coupon the shopper applied
        // and quietly charges them the undiscounted price.
        promoCode:
            appliedCoupon || null,

        // Set when this basket came back through a recovery link (#1429). The
        // backend decides whether it attributes anything; sending one it does
        // not recognise costs the order nothing.
        recoveryRef:
            AppUtils.getRecoveryRef(),

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

const TOTAL_MISMATCH_CODE =
    "ORDER_TOTAL_MISMATCH";

// Turns an unsuccessful API response into an error the submit handler can
// present. A rejected total is the one failure the shopper can act on, so it
// keeps the server's wording — which names both figures — and is flagged so
// the summary gets repainted before they retry.
function orderFailure(
    response
) {

    const failure =
        new Error(
            (response && response.message)
            || "Failed to place order."
        );

    failure.isTotalMismatch =
        Boolean(
            response
            &&
            response.code === TOTAL_MISMATCH_CODE
        );

    failure.requiresChallenge =
        Boolean(
            response
            &&
            (
                response.requiresChallenge
                || response.code === "CHALLENGE_REQUIRED"
            )
        );

    failure.challenge =
        response && response.challenge
            ? response.challenge
            : null;

    failure.raw = response || null;

    return failure;
}

// ==================== BOT-RESISTANT CHECKOUT PoW (#1396) ====================

function mintIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return `chk_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

async function sha256Hex(message) {
    const data = new TextEncoder().encode(message);
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Vanilla JS PoW solver — finds nonce so
 * sha256(challengeId:idempotencyKey:nonce) starts with `difficulty` hex zeros.
 */
async function solveCheckoutPow(challenge, onProgress) {
    const challengeId = challenge.challengeId;
    const idempotencyKey = challenge.idempotencyKey;
    const difficulty = Number(challenge.difficulty) || 3;
    const prefix = challenge.prefix || "0".repeat(difficulty);
    const maxAttempts = 2_000_000;

    for (let nonce = 0; nonce < maxAttempts; nonce += 1) {
        const digest = await sha256Hex(`${challengeId}:${idempotencyKey}:${nonce}`);
        if (digest.startsWith(prefix)) {
            return { nonce: String(nonce), digest };
        }
        if (onProgress && nonce > 0 && nonce % 500 === 0) {
            onProgress(nonce);
            // Yield so the UI can paint "Verifying..." without freezing.
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    throw new Error("Could not solve checkout challenge in time. Please try again.");
}

async function ensureCheckoutChallenge(order, idempotencyKey, initialResponse) {
    let challenge = initialResponse && initialResponse.challenge;

    if (!challenge) {
        const issued = await AppUtils.apiRequest("/checkout/challenge/issue", {
            method: "POST",
            headers: {
                "Idempotency-Key": idempotencyKey
            },
            body: JSON.stringify({
                idempotencyKey,
                riskScore: initialResponse && initialResponse.riskScore,
                riskLevel: initialResponse && initialResponse.riskLevel
            })
        });

        if (!issued.success || !issued.challenge) {
            throw new Error(
                (issued && issued.message) || "Failed to start checkout challenge."
            );
        }
        challenge = issued.challenge;
    }

    if (
        elements.placeOrderBtn
    ) {
        elements.placeOrderBtn.innerText = "Verifying you are human…";
    }

    AppUtils.notify(
        "Extra verification needed for this checkout — solving a quick challenge…",
        "info"
    );

    const solution = await solveCheckoutPow(challenge);

    const verified = await AppUtils.apiRequest("/checkout/challenge/verify", {
        method: "POST",
        headers: {
            "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
            challengeId: challenge.challengeId,
            nonce: solution.nonce,
            idempotencyKey
        })
    });

    if (!verified.success) {
        throw new Error(
            (verified && verified.message) || "Checkout challenge failed."
        );
    }

    return {
        idempotencyKey,
        challengeId: challenge.challengeId,
        nonce: solution.nonce
    };
}

function challengeHeaders(proof) {
    if (!proof) {
        return {};
    }
    return {
        "Idempotency-Key": proof.idempotencyKey,
        "X-Checkout-Challenge-Id": proof.challengeId,
        "X-Checkout-Challenge-Nonce": proof.nonce
    };
}

/**
 * Place order / payment-intent with automatic PoW retry when risk-gated.
 */
async function placeOrderWithChallenge(path, order, idempotencyKey) {
    let proof = { idempotencyKey, challengeId: "", nonce: "" };

    let response = await AppUtils.apiRequest(path, {
        method: "POST",
        headers: {
            "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
            ...order,
            idempotencyKey
        })
    });

    if (
        response
        && !response.success
        && (
            response.requiresChallenge
            || response.code === "CHALLENGE_REQUIRED"
        )
    ) {
        proof = await ensureCheckoutChallenge(order, idempotencyKey, response);

        if (
            elements.placeOrderBtn
        ) {
            elements.placeOrderBtn.innerText = "Processing...";
        }

        response = await AppUtils.apiRequest(path, {
            method: "POST",
            headers: challengeHeaders(proof),
            body: JSON.stringify({
                ...order,
                idempotencyKey: proof.idempotencyKey,
                challengeId: proof.challengeId,
                challengeNonce: proof.nonce
            })
        });
    }

    return response;
}

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

            const order = await createOrderPayload();
            const selectedPaymentMethod = order.paymentMethod;
            const idempotencyKey = mintIdempotencyKey();

            // Whichever branch runs, the id of the order the server created.
            let placedOrderId = null;

            // And the number the shopper was given for it. It is the only
            // handle a guest has, so it is what the confirmation page is sent.
            let placedOrderNumber = null;

            try {
                if (selectedPaymentMethod === "card") {
                    // 1. Create Payment Intent (PoW gate may challenge first)
                    const intentRes = await placeOrderWithChallenge(
                        "/orders/create-payment-intent",
                        order,
                        idempotencyKey
                    );

                    if (!intentRes.success) {
                        throw orderFailure(intentRes);
                    }

                    placedOrderId = intentRes.orderId;
                    placedOrderNumber = intentRes.orderNumber;

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
                    // Fallback for COD/UPI — challenge gate targets scripted COD.
                    const data = await placeOrderWithChallenge(
                        "/orders",
                        order,
                        idempotencyKey
                    );

                    if (!data.success) {
                        throw orderFailure(data);
                    }

                    placedOrderId = data.orderId;
                    placedOrderNumber = data.orderNumber;

                    AppUtils.notify("Order placed successfully! 🎉", "success");
                }

                // What the confirmation page needs to read this order back
                // when there is no account to read it through.
                AppUtils.rememberGuestOrder(
                    placedOrderNumber,
                    order.customer.email
                );

                // clear cart
                AppUtils.clearCart();
                AppUtils.clearCartToken();
                AppUtils.removeStorage("appliedCoupon");

                // The recovery is spent on the order that just used it. Left
                // in place it would go on to claim the next order too.
                AppUtils.clearRecoveryRef();

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
                            `success.html?id=${encodeURIComponent(placedOrderId)}`;

                    },
                    1200
                );

            } catch (
                error
            ) {

                console.error(
                    "ORDER ERROR:",
                    error
                );

                if (
                    error.isTotalMismatch
                ) {

                    await refreshSummary();

                    AppUtils.notify(
                        `${error.message} The summary has been updated — please review it and try again.`,
                        "error"
                    );

                } else {

                    AppUtils.notify(
                        error.message ||
                        "Failed to place order.",
                        "error"
                    );
                }

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

window.addEventListener("currencyUpdated", () => {
    if (typeof renderCheckout === "function") {
        renderCheckout();
    }
});


