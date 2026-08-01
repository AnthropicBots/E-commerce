// No sign-in gate: a shopper who just paid without an account still has to be
// shown what they bought. There are two ways to reach the order and the page
// takes whichever applies -- an account reads it by id, a guest reads it back
// with the order number and the email it was placed with.

// get order id from url
const orderId =
    new URLSearchParams(
        window.location.search
    ).get("id");

const guestOrder =
    AppUtils.readGuestOrder();

// invalid access
if (
    !orderId
    &&
    !guestOrder
) {

    AppUtils.notify(
        "Invalid order",
        "error"
    );

    setTimeout(
        () => {

            window.location.href =
                "shop.html";

        },
        1000
    );

    throw new Error(
        "Missing order reference"
    );
}

// elements
const elements = {

    orderId:
        document.getElementById(
            "order-id"
        ),

    orderDate:
        document.getElementById(
            "order-date"
        ),

    successIcon:
        document.querySelector(
            ".success-icon"
        )
};

// Read the order the way this shopper is entitled to. An account holder reads
// their own order by id; anyone else presents the pair they were given at
// checkout. `id` is preferred when both are available because it is the
// authoritative read and carries the full record.
async function requestOrder() {

    if (
        orderId
        &&
        AppUtils.isAuthenticated()
    ) {

        const response =
            await AppUtils.apiRequest(
                `/orders/${orderId}`
            );

        return response && response.order
            ? { success: response.success, order: response.order }
            : { success: false };
    }

    const response =
        await AppUtils.apiRequest(
            "/orders/lookup",
            {
                method: "POST",
                body: JSON.stringify(guestOrder)
            }
        );

    if (
        !response
        ||
        !response.success
        ||
        !response.order
    ) {

        return { success: false };
    }

    // The guest view names its fields for the client rather than after the
    // columns, so it is mapped onto the shape this page already renders.
    return {
        success: true,

        order: {
            order_number: response.order.orderNumber,
            created_at: response.order.placedAt,
            total: response.order.totals
                ? response.order.totals.total
                : null,
            items: response.order.items
        }
    };
}

// fetch order
async function fetchOrder() {

    try {

        const response =
            await requestOrder();

        if (
            !response.success
            ||
            !response.order
        ) {

            AppUtils.notify(
                "Order not found",
                "error"
            );

            setTimeout(
                () => {

                    window.location.href =
                        "shop.html";

                },
                1000
            );

            return;
        }

        const order =
            response.order;

        // render order id — the order number in preference to the internal id,
        // since that is what the shopper was given and what support will ask for
if (elements.orderId) {
    elements.orderId.innerText = order.order_number || order.id || "N/A";
}

// render order date
if (elements.orderDate) {
    elements.orderDate.innerText =
        order.created_at
            ? new Date(order.created_at).toLocaleDateString()
            : "N/A";
}

// render order total
const orderTotal = document.getElementById("order-total");
if (orderTotal) {
    // `total` is the column; `total_price` was never one, so this read has
    // always shown N/A.
    const total = order.total ?? order.total_price;
    orderTotal.innerText = total ? AppUtils.formatPrice(total) : "N/A";
}

// render order items
const orderItemsList = document.getElementById("order-items-list");
if (orderItemsList && Array.isArray(order.items) && order.items.length) {
    orderItemsList.innerHTML = order.items.map(item => `
        <li style="margin-bottom:6px;">
            ${AppUtils.escapeHTML(item.name || "Product")} 
            x${item.qty || 1} — 
            ${AppUtils.formatPrice(item.price || 0)}
        </li>
    `).join("");
} else if (orderItemsList) {
    orderItemsList.innerHTML = "<li>No item details available.</li>";
}

    } catch (error) {

        console.error(
            "SUCCESS PAGE ERROR:",
            error
        );

        AppUtils.notify(
            "Failed to load order",
            "error"
        );
    }
}

// success animation
function playSuccessAnimation() {

    if (
        !elements.successIcon
    ) {
        return;
    }

    elements.successIcon.animate(
        [
            {
                transform:
                    "scale(0)"
            },

            {
                transform:
                    "scale(1.1)"
            },

            {
                transform:
                    "scale(1)"
            }
        ],
        {
            duration:
                800,

            easing:
                "ease"
        }
    );
}

// init
document.addEventListener(
    "DOMContentLoaded",
    () => {

        fetchOrder();

        playSuccessAnimation();
    }
);