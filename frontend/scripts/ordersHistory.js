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

// How many orders one request asks for. The endpoint is paginated (#1545);
// asking for a page is how you get one, and asking for none used to get you
// every order the account had ever placed.
const ORDERS_PAGE_SIZE = 10;

// Which page is on screen, and whether there is another one behind it.
const state = {
    page: 1,
    totalPages: 1,
    total: 0,
    loading: false
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

/**
 * The "Showing 1-10 of 34" line and the page buttons.
 *
 * Rendered only when there is more than one page. A single-page history is the
 * common case and a pager on it is noise.
 */
function renderPager(shownOnPage) {
    if (state.totalPages <= 1) {
        return null;
    }

    const firstOnPage =
        (state.page - 1) * ORDERS_PAGE_SIZE + 1;

    const lastOnPage =
        firstOnPage + shownOnPage - 1;

    const pager =
        document.createElement("div");

    pager.className =
        "orders-history-pager";

    pager.innerHTML =
        `
            <button
                type="button"
                class="orders-page-prev"
                ${state.page <= 1 ? "disabled" : ""}
            >
                Previous
            </button>
            <span class="orders-page-status">
                Showing ${firstOnPage}-${lastOnPage} of ${state.total}
            </span>
            <button
                type="button"
                class="orders-page-next"
                ${state.page >= state.totalPages ? "disabled" : ""}
            >
                Next
            </button>
        `;

    pager
        .querySelector(".orders-page-prev")
        ?.addEventListener("click", () => {
            goToOrdersPage(state.page - 1);
        });

    pager
        .querySelector(".orders-page-next")
        ?.addEventListener("click", () => {
            goToOrdersPage(state.page + 1);
        });

    return pager;
}

/**
 * Move to a page, clamped to the range that exists.
 *
 * Guarded on `state.loading` so a double-click does not put two requests in
 * flight and render whichever happens to come back last.
 */
function goToOrdersPage(page) {
    const target =
        Math.min(
            Math.max(1, page),
            Math.max(1, state.totalPages)
        );

    if (
        state.loading
        ||
        target === state.page
    ) {
        return;
    }

    state.page = target;
    renderOrders();
}

// render orders
async function renderOrders() {
    if (
        !elements.ordersContainer
    ) {
        return;
    }

    state.loading = true;

    try {
        const params =
            new URLSearchParams({
                page: String(state.page),
                limit: String(ORDERS_PAGE_SIZE)
            });

        const data = await AppUtils.apiRequest(
            `/orders/my-orders?${params.toString()}`
        );

        const orders = data.orders || [];

        // `total` is every order the account has, not the length of this page.
        // The count next to the heading means "your orders", so it has to come
        // from the pagination meta rather than from `orders.length`.
        state.total =
            Number.isFinite(Number(data.total))
                ? Number(data.total)
                : (Array.isArray(orders) ? orders.length : 0);

        state.totalPages =
            Math.max(1, Number(data.totalPages) || 1);

        // A page that no longer exists -- the last order on page 3 was
        // cancelled and removed while it was on screen -- steps back rather
        // than showing an empty list under a pager that says there is more.
        if (
            state.page > state.totalPages
        ) {
            state.page = state.totalPages;
            state.loading = false;
            return renderOrders();
        }

        // render count
        if (
            elements.ordersCount
        ) {
            elements.ordersCount.innerText =
                state.total;
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

                const isReturnable = (order.status || "").toLowerCase() === "delivered";
                const returnBtnHtml = isReturnable
                    ? `<button class="btn btn-sm" style="color:#111; border:1px solid #111; padding: 4px 8px; border-radius:4px; background:transparent; cursor:pointer;" onclick="openReturnModal('${order.id}')">Request Return</button>`
                    : "";

                const actionsHtml = [cancelBtnHtml, returnBtnHtml].filter(Boolean).join(" ");

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
                            <span style="display:flex; gap:8px;">
                                ${actionsHtml}
                            </span>
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

        const pager =
            renderPager(orders.length);

        if (pager) {
            elements.ordersContainer.appendChild(
                pager
            );
        }
    } catch (error) {
        console.error("Failed to fetch orders history:", error);

        // A failed page turn used to log to the console and leave the previous
        // page on screen under a pager that had already moved, which reads as
        // "this page is identical to the last one". Say what happened instead.
        renderEmptyState(
            "Could not load your orders. Please try again."
        );
    } finally {
        state.loading = false;
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