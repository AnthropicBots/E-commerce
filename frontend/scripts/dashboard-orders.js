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
        case "refunded":
            return "success";

        case "processing":
        case "approved":
        case "in_transit":
        case "received":
            return "warning";

        case "cancelled":
        case "rejected":
            return "danger";

        default:
            return "info";
    }
}

function renderRmaTimeline(timeline) {
    if (!timeline || !Array.isArray(timeline.steps)) {
        return "";
    }

    if (timeline.terminal && timeline.outcome) {
        return `<p style="margin:8px 0 0; font-size:0.8rem; color:#b91c1c;">Outcome: ${AppUtils.escapeHTML(timeline.outcome)}</p>`;
    }

    const stepsHtml = timeline.steps
        .map((step) => {
            const color =
                step.state === "done"
                    ? "#16a34a"
                    : step.state === "current"
                      ? "#111"
                      : "#9ca3af";
            const weight = step.state === "current" ? "700" : "400";
            return `<span style="color:${color}; font-weight:${weight}; font-size:0.75rem;">${AppUtils.escapeHTML(step.label)}</span>`;
        })
        .join(` <span style="color:#d1d5db;">→</span> `);

    return `<div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">${stepsHtml}</div>`;
}

function renderRmaCard(rma) {
    const status = (rma.status || "requested").toLowerCase();
    const canShip = status === "approved";
    const canCancel = status === "requested" || status === "pending";

    const actions = [];
    if (canShip) {
        actions.push(
            `<button type="button" class="btn btn-sm" style="padding:4px 8px; border:1px solid #111; background:transparent; border-radius:4px; cursor:pointer;" onclick="markRmaInTransit(${rma.id})">Mark shipped</button>`
        );
    }
    if (canCancel) {
        actions.push(
            `<button type="button" class="btn btn-sm" style="padding:4px 8px; border:1px solid #b91c1c; color:#b91c1c; background:transparent; border-radius:4px; cursor:pointer;" onclick="cancelDashboardRma(${rma.id})">Cancel</button>`
        );
    }

    return `
        <div class="dashboard-rma-card" style="border-top:1px solid #eee; margin-top:10px; padding-top:10px;">
            <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
                <div>
                    <strong style="font-size:0.85rem;">${AppUtils.escapeHTML(rma.rma_number || `RMA #${rma.id}`)}</strong>
                    <div style="font-size:0.75rem; color:#666;">Order #${AppUtils.escapeHTML(String(rma.order_id || ""))}</div>
                </div>
                <span class="order-status-badge ${getOrderStatusClass(status)}">${AppUtils.escapeHTML(status)}</span>
            </div>
            ${renderRmaTimeline(rma.timeline)}
            ${actions.length ? `<div style="margin-top:8px; display:flex; gap:6px; justify-content:flex-end;">${actions.join("")}</div>` : ""}
        </div>
    `;
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

        let rmas = [];
        try {
            const rmaRes = await AppUtils.apiRequest("/refunds/mine");
            if (rmaRes && rmaRes.success) {
                rmas = AppUtils.safeArray(rmaRes.data);
            }
        } catch (rmaErr) {
            console.warn("Failed to load RMA list:", rmaErr);
        }

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
            if (rmas.length) {
                dashboardOrderElements.ordersContainer.innerHTML +=
                    `<div class="dashboard-order-card"><h4>Your returns</h4>${rmas.map(renderRmaCard).join("")}</div>`;
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
                    ? `<button class="btn btn-sm" style="color:red; border:1px solid red; padding: 4px 8px; border-radius:4px; background:transparent; cursor:pointer;" onclick="cancelDashboardOrder('${order.id}')">Cancel Order</button>`
                    : "";

                const isReturnable = (order.status || "").toLowerCase() === "delivered";
                const returnBtnHtml = isReturnable
                    ? `<button class="btn btn-sm" style="color:#111; border:1px solid #111; padding: 4px 8px; border-radius:4px; background:transparent; cursor:pointer;" onclick="openReturnModal('${order.id}')">Request Return</button>`
                    : "";

                const actionsHtml = [cancelBtnHtml, returnBtnHtml].filter(Boolean).join(" ");

                const orderRmas = rmas.filter(
                    (r) => String(r.order_id) === String(order.id)
                );
                const rmaHtml = orderRmas.map(renderRmaCard).join("");

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
                    ${rmaHtml}
                `;

                dashboardOrderElements
                    .ordersContainer
                    .appendChild(
                        card
                    );
            }
        );

        const listedIds = new Set(orders.map((o) => String(o.id)));
        const orphanRmas = rmas.filter((r) => !listedIds.has(String(r.order_id)));
        if (orphanRmas.length) {
            const wrap = document.createElement("div");
            wrap.className = "dashboard-order-card";
            wrap.innerHTML = `<h4>Other returns</h4>${orphanRmas.map(renderRmaCard).join("")}`;
            dashboardOrderElements.ordersContainer.appendChild(wrap);
        }
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

window.markRmaInTransit = async (rmaId) => {
    const tracking = window.prompt("Optional shipping tracking number:", "") || "";
    try {
        const response = await AppUtils.apiRequest(`/refunds/${rmaId}/in-transit`, {
            method: "POST",
            body: JSON.stringify({ tracking })
        });
        if (response.success) {
            AppUtils.notify("Return marked as in transit", "success");
            renderDashboardOrders();
        } else {
            AppUtils.notify(response.message || "Could not update RMA", "error");
        }
    } catch (error) {
        AppUtils.notify(error.message || "Could not update RMA", "error");
    }
};

window.cancelDashboardRma = async (rmaId) => {
    if (!window.confirm("Cancel this return request?")) {
        return;
    }
    try {
        const response = await AppUtils.apiRequest(`/refunds/${rmaId}/cancel`, {
            method: "POST",
            body: JSON.stringify({})
        });
        if (response.success) {
            AppUtils.notify("Return request cancelled", "success");
            renderDashboardOrders();
        } else {
            AppUtils.notify(response.message || "Could not cancel RMA", "error");
        }
    } catch (error) {
        AppUtils.notify(error.message || "Could not cancel RMA", "error");
    }
};

// expose globally
window.renderDashboardOrders =
    renderDashboardOrders;
