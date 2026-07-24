// current order
let currentOrder = null;

// get order id from url
const orderId =
    new URLSearchParams(
        window.location.search
    ).get("id");

// redirect if missing order id
if (!orderId) {
    window.location.href = "shop.html";
}

// elements
const elements = {
    loadingState: document.getElementById("loading-state"),
    orderDetails: document.getElementById("order-details"),
    errorState: document.getElementById("error-state"),
    orderItemsContainer: document.getElementById("order-items-container"),
    orderId: document.getElementById("order-id"),
    orderDate: document.getElementById("order-date"),
    statusBadge: document.getElementById("status-badge"),
    estimatedDelivery: document.getElementById("estimated-delivery"),
    trackingNumber: document.getElementById("tracking-number"),
    processingStep: document.getElementById("processing-step"),
    shippedStep: document.getElementById("shipped-step"),
    deliveredStep: document.getElementById("delivered-step")
};

// escape html
function escapeHTML(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Helper: format date
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// fetch order status
async function fetchOrderStatus() {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = 'signin.html';
            return;
        }

        const response = await fetch(`/api/orders/${orderId}/status`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to fetch order');
        }

        renderOrderDetails(data.data);
    } catch (error) {
        console.error('Order tracking error:', error);
        if (elements.loadingState) elements.loadingState.style.display = 'none';
        if (elements.errorState) elements.errorState.style.display = 'block';
        AppUtils.notify('Failed to load order details', 'error');
    }
}

// render order details
function renderOrderDetails(order) {
    // Hide loading, show details
    if (elements.loadingState) elements.loadingState.style.display = 'none';
    if (elements.orderDetails) elements.orderDetails.style.display = 'block';

    // Order summary
    if (elements.orderId) {
        elements.orderId.textContent = 'Order #' + order.id;
    }
    if (elements.orderDate) {
        elements.orderDate.textContent = formatDate(order.created_at);
    }

    // Status badge
    const status = order.status || 'pending';
    if (elements.statusBadge) {
        elements.statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        elements.statusBadge.className = 'status-badge';
        elements.statusBadge.classList.add(status.toLowerCase());
    }

    // Shipping details
    if (elements.estimatedDelivery) {
        elements.estimatedDelivery.textContent = order.estimated_delivery || 'Not available';
    }
    if (elements.trackingNumber) {
        elements.trackingNumber.textContent = order.tracking_number || 'Not available';
    }

    // Order items
    if (elements.orderItemsContainer) {
        const items = order.items || [];
        if (items.length === 0) {
            elements.orderItemsContainer.innerHTML = '<p>No items found</p>';
        } else {
            const fragment = document.createDocumentFragment();
            items.forEach(item => {
                const div = document.createElement('div');
                div.classList.add('order-item');
                const price = parseFloat(item.price) || 0;
                const qty = parseInt(item.quantity) || 1;
                div.innerHTML = `
                    <div class="order-item-left">
                        <div>
                            <h4>${escapeHTML(item.product_name || 'Product')}</h4>
                            <p>Quantity: ${qty}</p>
                        </div>
                    </div>
                    <h4>${AppUtils.formatPrice(price * qty)}</h4>
                `;
                fragment.appendChild(div);
            });
            elements.orderItemsContainer.innerHTML = '';
            elements.orderItemsContainer.appendChild(fragment);
        }
    }

    // Timeline
    const statuses = ['pending', 'processing', 'shipped', 'delivered'];
    const currentStatus = status.toLowerCase();
    const currentStatusIndex = statuses.indexOf(currentStatus);

    // Update each step
    const stepIds = ['pending-step', 'processing-step', 'shipped-step', 'delivered-step'];
    stepIds.forEach((stepId, index) => {
        const stepEl = document.getElementById(stepId);
        if (!stepEl) return;
        const isCompleted = index <= currentStatusIndex;
        const isActive = index === currentStatusIndex;

        stepEl.classList.remove('active-step');
        if (isActive) {
            stepEl.classList.add('active-step');
        } else if (isCompleted) {
            // Keep it completed (no class needed, but we can style completed differently)
            stepEl.style.opacity = '0.7';
        } else {
            stepEl.style.opacity = '0.4';
        }
    });
}

// init
document.addEventListener("DOMContentLoaded", () => {
    fetchOrderStatus();
});