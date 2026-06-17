// dashboard order elements
const dashboardOrderElements = {
    ordersContainer:
        document.getElementById(
            "orders-list"
        ),

    ordersCount:
        document.getElementById(
            "orders-count"
        )
};

// order badge color
function getOrderStatusClass(
    status = "pending"
) {
    switch (
        status.toLowerCase()
    ) {
        case "delivered":
            return "success";

        case "processing":
            return "warning";

        case "cancelled":
            return "danger";

        default:
            return "info";
    }
}

// render orders
async function renderDashboardOrders() {
    if (
        !dashboardOrderElements.ordersContainer
    ) {
        return;
    }

    try {
        const data = await AppUtils.apiRequest("/orders/my-orders");
        const orders = data.orders || [];

        if (
            dashboardOrderElements.ordersCount
        ) {
            dashboardOrderElements.ordersCount.innerText =
                orders.length;
        }

        if (
            !orders.length
        ) {
            if (typeof renderDashboardEmptyState === "function") {
                renderDashboardEmptyState(
                    dashboardOrderElements.ordersContainer,
                    "No orders found."
                );
            }
            return;
        }

        dashboardOrderElements.ordersContainer.innerHTML =
            "";

        orders.forEach(
            (order) => {
                const card =
                    document.createElement(
                        "div"
                    );

                card.className =
                    "dashboard-order-card";

                const isCancellable = ["pending", "processing"].includes((order.status || "").toLowerCase());
                const cancelBtnHtml = isCancellable
                    ? `<button class="btn btn-sm" style="color:red; border:1px solid red; padding: 4px 8px; border-radius:4px; background:transparent; cursor:pointer;" onclick="cancelDashboardOrder(${order.id})">Cancel Order</button>`
                    : "";

                card.innerHTML = `
                    <div class="dashboard-order-top">
                        <div>
                            <h4>
                                Order #${
                                    order.id
                                }
                            </h4>

                            <small>
                                ${
                                    order.created_at
                                    ? new Date(order.created_at).toLocaleDateString()
                                    : "Recently"
                                }
                            </small>
                        </div>

                        <span class="
                            order-status-badge
                            ${
                                getOrderStatusClass(
                                    order.status
                                )
                            }
                        ">
                            ${
                                order.status
                                || "Pending"
                            }
                        </span>
                    </div>

                    <div class="dashboard-order-body">
                        <p>
                            Items:
                            ${
                                order.items?.length
                                || 0
                            }
                        </p>

                        <strong>
                            ${
                                AppUtils.formatPrice(
                                    order.total || 0
                                )
                            }
                        </strong>
                    </div>
                    ${cancelBtnHtml ? `<div style="text-align: right; margin-top: 10px;">${cancelBtnHtml}</div>` : ""}
                `;

                dashboardOrderElements
                    .ordersContainer
                    .appendChild(
                        card
                    );
            }
        );
    } catch (error) {
        console.error("Failed to fetch dashboard orders:", error);
    }
}

window.cancelDashboardOrder = async (orderId) => {
    if (!window.confirm("Are you sure you want to cancel this order?")) {
        return;
    }
    
    try {
        const response = await AppUtils.apiRequest(`/orders/${orderId}/cancel`, {
            method: "PATCH"
        });
        
        if (response.success) {
            AppUtils.notify("Order cancelled successfully", "success");
            renderDashboardOrders();
        } else {
            AppUtils.notify(response.message || "Failed to cancel order", "error");
        }
    } catch (error) {
        AppUtils.notify(error.message || "An error occurred", "error");
    }
};

// expose globally
window.renderDashboardOrders =
    renderDashboardOrders;