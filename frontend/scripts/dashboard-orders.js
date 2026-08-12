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

// How many orders the dashboard panel shows. It is a summary, not the history
// -- the full paged list lives on the orders page.
const DASHBOARD_ORDERS_LIMIT = 5;

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
        // The endpoint is paginated (#1545), so ask for a page explicitly
        // rather than relying on whatever the server's default happens to be.
        const data = await AppUtils.apiRequest(
            `/orders/my-orders?page=1&limit=${DASHBOARD_ORDERS_LIMIT}`
        );

        const orders = data.orders || [];

        if (
            dashboardOrderElements.ordersCount
        ) {
            // `total` is every order the account has; `orders.length` is only
            // how many fit on this panel. The badge means the former.
            dashboardOrderElements.ordersCount.innerText =
                Number.isFinite(Number(data.total))
                    ? Number(data.total)
                    : orders.length;
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

                const isReturnable = (order.status || "").toLowerCase() === "delivered";
                const returnBtnHtml = isReturnable
                    ? `<button class="btn btn-sm" style="color:#111; border:1px solid #111; padding: 4px 8px; border-radius:4px; background:transparent; cursor:pointer;" onclick="openReturnModal('${order.id}')">Request Return</button>`
                    : "";

                const actionsHtml = [cancelBtnHtml, returnBtnHtml].filter(Boolean).join(" ");

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
                    ${actionsHtml ? `<div style="text-align: right; margin-top: 10px; display:flex; gap:8px; justify-content:flex-end;">${actionsHtml}</div>` : ""}
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