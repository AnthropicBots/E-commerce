// current order
let currentOrder = null;

// get order id from url
const orderId = new URLSearchParams(window.location.search).get("id");



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

function renderOrderSearchForm() {
    if (elements.loadingState) {
        elements.loadingState.style.display = "none";
    }

    if (elements.orderDetails) {
        elements.orderDetails.style.display = "none";
    }

    if (elements.errorState) {
        elements.errorState.style.display = "none";
    }

    const card = document.getElementById("order-card");

    card.innerHTML = `
        <div class="order-search">
            <h3>Track Your Order</h3>

            <p>
                Enter your Order ID below to view your order details.
            </p>

            <input
                id="order-id-input"
                type="text"
                placeholder="Enter your Order ID"
            >

            <button id="track-order-btn" class="btn">
                Track Order
            </button>
        </div>
    `;

    document
        .getElementById("track-order-btn")
        .addEventListener("click", () => {

            const id = document
                .getElementById("order-id-input")
                .value
                .trim();

            if (!id) {
                AppUtils.notify(
                    "Please enter an Order ID",
                    "warning"
                );
                return;
            }

            window.location.href =
                `order.html?id=${encodeURIComponent(id)}`;
        });
       
        document
    .getElementById("order-id-input")
    .addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            document.getElementById("track-order-btn").click();
        }
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

// ─── Render helpers ──────────────────────────────────────────────────────────

/**
 * Populate the order detail view with the data returned by /orders/:id/status.
 * Called after a successful fetch, and again on every Socket.IO status-update
 * event so the page stays current without a reload.
 */
function renderOrderDetails(order) {
    if (!order) return;

    // Keep currentOrder in sync for other helpers that may read it.
    currentOrder = order;

    // Swap loading → detail view.
    if (elements.loadingState) elements.loadingState.style.display = 'none';
    if (elements.errorState)   elements.errorState.style.display   = 'none';
    if (elements.orderDetails) elements.orderDetails.style.display = 'block';

    // ── Header ────────────────────────────────────────────────────────────────
    if (elements.orderId) {
        elements.orderId.textContent = `Order #${escapeHTML(order.order_number || order.id || '')}`;
    }
    if (elements.orderDate) {
        elements.orderDate.textContent = formatDate(order.created_at);
    }

    // ── Status badge ──────────────────────────────────────────────────────────
    if (elements.statusBadge) {
        const status = (order.status || 'pending').toLowerCase();
        const label  = status.charAt(0).toUpperCase() + status.slice(1);
        elements.statusBadge.textContent = label;
        elements.statusBadge.dataset.status = status;
    }

    // ── Delivery info ─────────────────────────────────────────────────────────
    if (elements.estimatedDelivery) {
        const raw = order.estimated_delivery || order.estimated_delivery_from;
        elements.estimatedDelivery.textContent = raw ? formatDate(raw) : 'N/A';
    }

    const deliveryMethodEl = document.getElementById('delivery-method');
    if (deliveryMethodEl && order.shipping_method) {
        deliveryMethodEl.textContent = order.shipping_method;
    }

    if (elements.trackingNumber) {
        elements.trackingNumber.textContent = order.tracking_number || 'Not yet assigned';
    }

    // ── Tracking ladder ───────────────────────────────────────────────────────
    updateTrackingSteps(order.status);

    // ── Animated delivery canvas ──────────────────────────────────────────────
    if (!deliveryCanvasTracker) {
        deliveryCanvasTracker = new DeliveryRouteCanvas('delivery-tracking-canvas');
    }
    deliveryCanvasTracker.setStatus(order.status);

    // ── Items list ────────────────────────────────────────────────────────────
    renderOrderItems(order.items || []);

    // ── Wire action buttons (guard against double-binding on re-render) ───────
    const downloadBtn = document.getElementById('download-invoice-btn');
    if (downloadBtn && !downloadBtn.dataset.bound) {
        downloadBtn.dataset.bound = '1';
        downloadBtn.addEventListener('click', handleDownloadInvoice);
    }

    const printBtn = document.getElementById('print-order-btn');
    if (printBtn && !printBtn.dataset.bound) {
        printBtn.dataset.bound = '1';
        printBtn.addEventListener('click', () => window.print());
    }
}

/**
 * Illuminate the tracking-step circles that correspond to the order's
 * current status and every stage that precedes it.
 */
function updateTrackingSteps(status) {
    const statusOrder = ['pending', 'processing', 'shipped', 'delivered'];
    const idx = statusOrder.indexOf((status || 'pending').toLowerCase());

    // pending-step is always active (already has the class in the HTML).
    if (elements.processingStep) {
        elements.processingStep.classList.toggle('active-step', idx >= 1);
    }
    if (elements.shippedStep) {
        elements.shippedStep.classList.toggle('active-step', idx >= 2);
    }
    if (elements.deliveredStep) {
        elements.deliveredStep.classList.toggle('active-step', idx >= 3);
    }
}

/**
 * Render the list of items inside #order-items-container.
 */
function renderOrderItems(items) {
    if (!elements.orderItemsContainer) return;

    if (!items.length) {
        elements.orderItemsContainer.innerHTML = '<p style="color:#888;">No items found for this order.</p>';
        return;
    }

    elements.orderItemsContainer.innerHTML = items.map(item => {
        const name      = escapeHTML(item.name || 'Product');
        const qty       = Number(item.qty)   || 1;
        const price     = parseFloat(item.price) || 0;
        const lineTotal = price * qty;
        const imgSrc    = escapeHTML(item.img || item.image || 'assets/images/placeholder.png');

        return `
            <div class="order-item">
                <div class="order-item-left">
                    <img src="${imgSrc}" alt="${name}" loading="lazy" width="70">
                    <div>
                        <h4>${name}</h4>
                        <p style="color:#888; font-size:0.9rem;">Qty: ${qty}</p>
                    </div>
                </div>
                <div class="order-item-right">
                    <p style="font-weight:600;">${AppUtils.formatPrice(lineTotal)}</p>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Fetch the PDF invoice for the current order from the backend and
 * trigger a browser file download — no new tab, no popup.
 *
 * GET /api/orders/:id/invoice  →  application/pdf
 */
async function handleDownloadInvoice() {
    const btn = document.getElementById('download-invoice-btn');

    // Loading state
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Generating…';
    }

    try {
        const token = localStorage.getItem('token');
        const res   = await fetch(`${CONFIG.API_BASE}/orders/${orderId}/invoice`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.message || `Server responded ${res.status}`);
        }

        const blob    = await res.blob();
        const url     = URL.createObjectURL(blob);
        const anchor  = document.createElement('a');
        anchor.href     = url;
        anchor.download = `invoice-${orderId}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);

        AppUtils.notify('Invoice downloaded successfully', 'success');
    } catch (error) {
        console.error('Invoice download error:', error);
        AppUtils.notify(error.message || 'Failed to download invoice', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-download" aria-hidden="true"></i> Download Invoice';
        }
    }
}


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

                    // Re-read the timeline so the newly recorded transition
                    // appears without a page reload.
                    window.OrderTimeline?.load(targetOrderId);
                }
                fetchOrderStatus();
            }
        });
    } catch (e) {
        console.warn("Socket.IO connection warning:", e);
    }
}

document.addEventListener("DOMContentLoaded", () => {

    if (!orderId) {
        renderOrderSearchForm();
        return;
    }

    fetchOrderStatus();

    // Status history (#1351). The four tracking steps were hardcoded with no
    // dates behind them, because an order's status was a single mutable field
    // and "shipped on the 4th" was not information this page could reach.
    window.OrderTimeline?.load(orderId);

    initSocketOrderTracker(orderId);
});