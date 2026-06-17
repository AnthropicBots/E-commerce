// elements
const elements = {
    ordersContainer:
        AppUtils.$(
            "#orders-history-container"
        ),

    ordersCount:
        AppUtils.$(
            "#orders-history-count"
        )
};

// empty state
function renderEmptyState(
    message
) {
    if (
        elements.ordersContainer
    ) {
        elements.ordersContainer.innerHTML =
            `
                <p class="empty-orders">
                    ${message}
                </p>
            `;
    }
}

// format date
function formatOrderDate(
    date
) {
    if (
        !date
    ) {
        return "N/A";
    }

    const parsedDate =
        new Date(date);

    return isNaN(
        parsedDate.getTime()
    )
        ? "N/A"
        : parsedDate.toLocaleDateString();
}

// render orders
async function renderOrders() {
    if (
        !elements.ordersContainer
    ) {
        return;
    }

    try {
        const data = await AppUtils.apiRequest("/orders/my-orders");
        const orders = data.orders || [];

        // render count
        if (
            elements.ordersCount
        ) {
            elements.ordersCount.innerText =
                Array.isArray(orders)
                    ? orders.length
                    : 0;
        }

        elements.ordersContainer.innerHTML =
            "";

        if (
            !Array.isArray(orders)
            ||
            orders.length === 0
        ) {
            renderEmptyState(
                "No past orders found."
            );
            return;
        }

        const fragment =
            document.createDocumentFragment();

        orders.forEach(
            (order) => {
                const div =
                    document.createElement(
                        "div"
                    );
                div.classList.add(
                    "order-history-item"
                );

                const isCancellable = ["pending", "processing"].includes((order.status || "").toLowerCase());
                const cancelBtnHtml = isCancellable
                    ? `<button class="btn btn-sm" style="color:red; border:1px solid red; padding: 4px 8px; border-radius:4px; background:transparent; cursor:pointer;" onclick="cancelHistoryOrder(${order.id})">Cancel Order</button>`
                    : "";

                div.innerHTML =
                    `
                        <h4>
                            Order ID:
                            ${order.id || "N/A"}
                        </h4>
                        <p>
                            Date:
                            ${formatOrderDate(order.created_at)}
                        </p>
                        <p style="display:flex; justify-content:space-between; align-items:center;">
                            <span>
                                Status:
                                <span class="order-status">
                                    ${order.status || "Pending"}
                                </span>
                            </span>
                            ${cancelBtnHtml}
                        </p>
                        <div class="order-items-list">
                            ${(order.items || [])
                                .map(
                                    (item) => `
                                        <div class="order-item">
                                            <img
                                                src="${AppUtils.defaultImage(item.img || item.image)}"
                                                alt="${item.name || "Product"}"
                                                loading="lazy"
                                            >
                                            <div>
                                                <h5>
                                                    ${item.name || "Product"}
                                                </h5>
                                                <p>
                                                    Qty:
                                                    ${item.qty || 1}
                                                </p>
                                                <p>
                                                    ${AppUtils.formatPrice(
                                                        (
                                                            parseFloat(item.price) || 0
                                                        ) * (
                                                            item.qty || 1
                                                        )
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    `
                                )
                                .join("")}
                        </div>
                    `;
                fragment.appendChild(
                    div
                );
            }
        );
        elements.ordersContainer.appendChild(
            fragment
        );
    } catch (error) {
        console.error("Failed to fetch orders history:", error);
    }
}

window.cancelHistoryOrder = async (orderId) => {
    if (!window.confirm("Are you sure you want to cancel this order?")) {
        return;
    }
    
    try {
        const response = await AppUtils.apiRequest(`/orders/${orderId}/cancel`, {
            method: "PATCH"
        });
        
        if (response.success) {
            AppUtils.notify("Order cancelled successfully", "success");
            renderOrders();
        } else {
            AppUtils.notify(response.message || "Failed to cancel order", "error");
        }
    } catch (error) {
        AppUtils.notify(error.message || "An error occurred", "error");
    }
};

// init
document.addEventListener(
    "DOMContentLoaded",
    () => {
        renderOrders();
    }
);