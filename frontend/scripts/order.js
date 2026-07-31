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

        const data = await AppUtils.apiRequest(`/orders/${orderId}/status`);

        if (!data.success) {
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

// Delivery Canvas Tracker Instance
let deliveryCanvasTracker = null;

class DeliveryRouteCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas || !this.canvas.getContext) return;
        this.ctx = this.canvas.getContext("2d");
        this.animationId = null;
        this.progress = 0; // 0.0 to 1.0
        this.targetProgress = 0;
        this.status = "pending";

        this.waypoints = [
            { x: 80, y: 110, label: "Warehouse", icon: "🏬" },
            { x: 280, y: 110, label: "Processing", icon: "📦" },
            { x: 520, y: 110, label: "In Transit", icon: "🚚" },
            { x: 720, y: 110, label: "Destination", icon: "🏡" }
        ];

        this.init();
    }

    init() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        this.animate();
    }

    setStatus(status) {
        this.status = String(status || "pending").toLowerCase();
        const statusMap = {
            pending: 0.0,
            processing: 0.33,
            shipped: 0.66,
            delivered: 1.0
        };
        this.targetProgress = statusMap[this.status] !== undefined ? statusMap[this.status] : 0.0;
    }

    animate() {
        const diff = this.targetProgress - this.progress;
        if (Math.abs(diff) > 0.001) {
            this.progress += diff * 0.04;
        } else {
            this.progress = this.targetProgress;
        }

        this.draw();
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    draw() {
        const { ctx, canvas, waypoints, progress } = this;
        if (!ctx || !canvas) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw background grid lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }

        // Draw inactive path polyline
        ctx.beginPath();
        ctx.moveTo(waypoints[0].x, waypoints[0].y);
        for (let i = 1; i < waypoints.length; i++) {
            ctx.lineTo(waypoints[i].x, waypoints[i].y);
        }
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.stroke();

        // Draw active path line with progress glow
        const totalDist = waypoints[waypoints.length - 1].x - waypoints[0].x;
        const currentX = waypoints[0].x + totalDist * progress;

        ctx.beginPath();
        ctx.moveTo(waypoints[0].x, waypoints[0].y);
        ctx.lineTo(currentX, waypoints[0].y);
        ctx.strokeStyle = "#088178";
        ctx.lineWidth = 6;
        ctx.shadowColor = "#34d399";
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow

        // Draw waypoints
        waypoints.forEach((wp) => {
            const isReached = currentX >= wp.x - 5;

            ctx.beginPath();
            ctx.arc(wp.x, wp.y, 22, 0, Math.PI * 2);
            ctx.fillStyle = isReached ? "#088178" : "#1e293b";
            ctx.strokeStyle = isReached ? "#34d399" : "#475569";
            ctx.lineWidth = 3;
            ctx.fill();
            ctx.stroke();

            ctx.font = "16px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(wp.icon, wp.x, wp.y);

            ctx.font = isReached ? "bold 12px sans-serif" : "12px sans-serif";
            ctx.fillStyle = isReached ? "#38bdf8" : "#94a3b8";
            ctx.fillText(wp.label, wp.x, wp.y + 40);
        });

        // Draw animated truck marker
        ctx.font = "24px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🚚", currentX, waypoints[0].y - 28);
    }
}

function initSocketOrderTracker(targetOrderId) {
    if (typeof window.io === "undefined") return;
    try {
        const socket = window.io(CONFIG.API_BASE.replace("/api", ""), {
            transports: ["websocket", "polling"]
        });

        socket.on("connect", () => {
            console.log("Socket.IO connected for order tracking:", targetOrderId);
            socket.emit("join_order_room", { orderId: targetOrderId });
            const liveText = document.getElementById("live-status-text");
            if (liveText) liveText.textContent = "Live Socket Sync";
        });

        socket.on("order_status_updated", (data) => {
            if (data && (String(data.orderId) === String(targetOrderId) || String(data.id) === String(targetOrderId))) {
                if (typeof AppUtils !== "undefined" && AppUtils.notify) {
                    AppUtils.notify(`Order status updated: ${(data.status || "").toUpperCase()}`, "info");
                }
                fetchOrderStatus();
            }
        });
    } catch (e) {
        console.warn("Socket.IO connection warning:", e);
    }
}

// render order details
function renderOrderDetails(order) {
    currentOrder = order;

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

    // Update Interactive Canvas Delivery Map
    if (!deliveryCanvasTracker) {
        deliveryCanvasTracker = new DeliveryRouteCanvas("delivery-tracking-canvas");
    }
    if (deliveryCanvasTracker) {
        deliveryCanvasTracker.setStatus(status);
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
            stepEl.style.opacity = '0.7';
        } else {
            stepEl.style.opacity = '0.4';
        }
    });

    renderReturnAction(order);
}

// render the "Request Return" entry point for delivered orders
function renderReturnAction(order) {
    const existing = document.getElementById("order-return-action");
    if (existing) existing.remove();

    if ((order.status || "").toLowerCase() !== "delivered") return;
    if (!elements.orderDetails) return;

    const wrapper = document.createElement("div");
    wrapper.id = "order-return-action";
    wrapper.style.cssText = "text-align: center; margin-top: 16px;";
    wrapper.innerHTML = `
        <button type="button" class="btn" style="padding: 10px 24px; border: 2px solid #111; border-radius: 8px; background: transparent; color: #111; cursor: pointer;">
            <i class="fas fa-undo"></i> Request Return
        </button>
    `;
    wrapper.querySelector("button").addEventListener("click", () => {
        window.openReturnModal(order);
    });

    const itemsSection = elements.orderItemsContainer
        ? elements.orderItemsContainer.closest(".order-items")
        : null;

    if (itemsSection && itemsSection.parentNode) {
        itemsSection.parentNode.insertBefore(wrapper, itemsSection.nextSibling);
    } else {
        elements.orderDetails.appendChild(wrapper);
    }
}

// init
document.addEventListener("DOMContentLoaded", () => {
    fetchOrderStatus();
    initSocketOrderTracker(orderId);
});