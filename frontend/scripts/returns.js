// Customer-facing return / refund-request flow.
//
// Exposes window.openReturnModal(orderOrId): resolves the order's line items
// (using an already-loaded order object when available, otherwise fetching the
// order status endpoint), then shows a lightweight modal where the customer
// picks an item, quantity and reason before POSTing to /api/refunds/request.

(function () {
    const MODAL_ID = "return-request-modal";

    function closeModal() {
        const existing = document.getElementById(MODAL_ID);

        if (existing) {
            existing.remove();
        }
    }

    async function resolveOrder(orderOrId) {
        if (
            orderOrId
            && typeof orderOrId === "object"
            && AppUtils.safeArray(orderOrId.items).length
        ) {
            return orderOrId;
        }

        const orderId =
            orderOrId && typeof orderOrId === "object"
                ? orderOrId.id
                : orderOrId;

        const data = await AppUtils.apiRequest(`/orders/${orderId}/status`);

        return data.order || data.data || null;
    }

    function buildModal(order, items) {
        closeModal();

        const overlay = document.createElement("div");
        overlay.id = MODAL_ID;
        overlay.style.cssText =
            "position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px;";

        const optionsHtml = items
            .map((item) => {
                const qty = AppUtils.safeInteger(item.qty ?? item.quantity, 1);
                const name = AppUtils.escapeHTML(
                    item.name || item.product_name || "Item"
                );

                return `<option value="${item.id}" data-qty="${qty}">${name} (Qty ${qty})</option>`;
            })
            .join("");

        overlay.innerHTML = `
            <div class="return-modal-card" style="background:#fff; border-radius:8px; padding:20px; width:min(420px, 100%); box-shadow:0 10px 30px rgba(0,0,0,0.2);">
                <h3 style="margin:0 0 12px;">Request a Return</h3>
                <p style="margin:0 0 16px; color:#666; font-size:0.85rem;">Order #${AppUtils.escapeHTML(order.id)}</p>

                <label for="return-item" style="display:block; margin-bottom:6px; font-size:0.85rem;">Item</label>
                <select id="return-item" style="width:100%; padding:8px; margin-bottom:12px; border:1px solid #ddd; border-radius:4px;">
                    ${optionsHtml}
                </select>

                <label for="return-qty" style="display:block; margin-bottom:6px; font-size:0.85rem;">Quantity</label>
                <input id="return-qty" type="number" min="1" value="1" style="width:100%; padding:8px; margin-bottom:12px; border:1px solid #ddd; border-radius:4px;">

                <label for="return-reason" style="display:block; margin-bottom:6px; font-size:0.85rem;">Reason</label>
                <textarea id="return-reason" rows="3" placeholder="Tell us why you're returning this item" style="width:100%; padding:8px; margin-bottom:16px; border:1px solid #ddd; border-radius:4px; resize:vertical;"></textarea>

                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button type="button" id="return-cancel" class="btn btn-sm" style="padding:8px 14px; border:1px solid #ccc; background:transparent; border-radius:4px; cursor:pointer;">Cancel</button>
                    <button type="button" id="return-submit" class="btn btn-sm" style="padding:8px 14px; border:none; background:#111; color:#fff; border-radius:4px; cursor:pointer;">Submit Request</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const itemSelect = overlay.querySelector("#return-item");
        const qtyInput = overlay.querySelector("#return-qty");

        // Cap the quantity input at the quantity actually ordered for the
        // selected line so the request can never exceed what was purchased.
        const syncQtyMax = () => {
            const option = itemSelect.options[itemSelect.selectedIndex];
            const maxQty = option
                ? AppUtils.safeInteger(option.dataset.qty, 1)
                : 1;

            qtyInput.max = maxQty;

            if (AppUtils.safeInteger(qtyInput.value, 1) > maxQty) {
                qtyInput.value = maxQty;
            }
        };

        syncQtyMax();
        itemSelect.addEventListener("change", syncQtyMax);

        overlay.querySelector("#return-cancel").addEventListener(
            "click",
            closeModal
        );

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
                closeModal();
            }
        });

        overlay.querySelector("#return-submit").addEventListener(
            "click",
            () => submitReturn(order.id, overlay)
        );
    }

    async function submitReturn(orderId, overlay) {
        const orderItemId = AppUtils.safeInteger(
            overlay.querySelector("#return-item").value,
            0
        );
        const quantity = AppUtils.safeInteger(
            overlay.querySelector("#return-qty").value,
            1
        );
        const reason = (overlay.querySelector("#return-reason").value || "").trim();

        if (!orderItemId) {
            AppUtils.notify("Please select an item to return", "error");
            return;
        }

        if (reason.length < 5) {
            AppUtils.notify(
                "Please add a short reason (at least 5 characters)",
                "error"
            );
            return;
        }

        const submitBtn = overlay.querySelector("#return-submit");
        submitBtn.disabled = true;

        try {
            const response = await AppUtils.apiRequest("/refunds/request", {
                method: "POST",
                body: JSON.stringify({
                    orderId,
                    orderItemId,
                    quantity,
                    reason
                })
            });

            if (response.success) {
                AppUtils.notify("Return request submitted", "success");
                closeModal();
            } else {
                AppUtils.notify(
                    response.message || "Failed to submit return request",
                    "error"
                );
                submitBtn.disabled = false;
            }
        } catch (error) {
            AppUtils.notify(
                error.message || "Failed to submit return request",
                "error"
            );
            submitBtn.disabled = false;
        }
    }

    async function openReturnModal(orderOrId) {
        if (!orderOrId) {
            return;
        }

        try {
            const order = await resolveOrder(orderOrId);
            const items = AppUtils.safeArray(order && order.items);

            if (!order || !items.length) {
                AppUtils.notify(
                    "No items are available to return for this order",
                    "error"
                );
                return;
            }

            buildModal(order, items);
        } catch (error) {
            AppUtils.notify(
                error.message || "Failed to load order items",
                "error"
            );
        }
    }

    window.openReturnModal = openReturnModal;
})();
