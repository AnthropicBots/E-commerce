const db =
    require("../config/db");

const {
    createOrderService,
    TOTAL_MISMATCH_CODE
} = require(
    "../services/order.service"
);

const { PERMISSIONS, hasPermission, isAdminRole } = require("../config/policy");
const paymentService = require("../services/payment.service");
const CURRENCY = require("../config/currency");
const { generateInvoicePdf } = require("../services/invoice.service");
const inventoryReservationService = require("../services/inventoryReservationService");

const {
    safeNumber,
    safeInteger,
    sanitizeString,
    getPagination,
    buildPaginationMeta,
    safeArray,
    safeUUID
} = require(
    "../utils/helpers"
);

// Saved address book (#1347).
const addressService = require("../services/addressService");
// Order status history (#1351). Every status change records who, when, from
// what, and why -- inside the same transaction as the change itself.
const orderStatusHistoryService = require("../services/orderStatusHistoryService");

// create order
const createOrder =
    async (
        req,
        res
    ) => {
        let connection;
        try {
            connection = await db.getConnection();

            let {
                customer,
                address,
                paymentMethod,
                items,
                total,
                promoCode,
                // Saved address book (#1347). A signed-in shopper can send an
                // id instead of retyping the whole address.
                addressId
            } = req.body;

            // Resolve a saved address into the same flat shape the manual form
            // posts, so everything below this point is unchanged whichever way
            // the shopper checked out.
            //
            // The lookup is scoped to the calling user by addressService, so an
            // id belonging to somebody else resolves to null and is rejected as
            // "not found" rather than silently shipping to a stranger.
            if (addressId) {
                const resolved = await addressService.resolveForOrder(
                    req.user.id,
                    sanitizeString(addressId)
                );

                if (!resolved) {
                    return res.status(404)
                        .json({
                            success: false,
                            message:
                                "Saved address not found"
                        });
                }

                // Anything the client also sent explicitly wins, so a shopper
                // who picked a saved address and then edited the recipient in
                // the form gets what they typed.
                address = { ...resolved.address, ...(address || {}) };
                customer = { ...resolved.customer, ...(customer || {}) };
                addressId = resolved.addressId;
            }

            // validation
            if (
                !customer
                ||
                !customer.name
                ||
                !customer.email
            ) {
                return res.status(400)
                    .json({
                        success: false,
                        message:
                            "Customer information required"
                    });
            }

            if (
                !address
                ||
                !address.fullAddress
            ) {
                return res.status(400)
                    .json({
                        success: false,
                        message:
                            "Delivery address required"
                    });
            }

            if (
                !Array.isArray(
                    items
                )
                ||
                !items.length
            ) {
                return res.status(400)
                    .json({
                        success: false,
                        message:
                            "Order items required"
                    });
            }

            // Shape check only. The submitted total is a claim; the order
            // service prices the basket itself and rejects a claim that does
            // not match.
            if (
                safeNumber(total) <= 0
            ) {
                return res.status(400)
                    .json({
                        success: false,
                        message:
                            "Invalid order total"
                    });
            }

            const validPaymentMethods = [
                "cod",
                "card",
                "upi",
                "paypal"
            ];

            if (
                !validPaymentMethods.includes(
                    sanitizeString(
                        paymentMethod
                    ).toLowerCase()
                )
            ) {

                return res.status(400)
                    .json({
                        success: false,
                        message:
                            "Invalid payment method"
                    });
            }

            // begin transaction
            await connection.beginTransaction();

            // Validate inventory locks with structured 409 on conflict (#1260)
            const lockCheck = await inventoryReservationService.validateCartLocksDetailed(
                req.user.id,
                items,
                connection
            );
            if (!lockCheck.ok) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    code: lockCheck.code || "INVENTORY_CONFLICT",
                    message: lockCheck.message || "Inventory locks expired or insufficient stock",
                    productId: lockCheck.productId,
                    availableStock: lockCheck.availableStock,
                    requested: lockCheck.requested
                });
            }

            // create order via service
            const result =
                await createOrderService(
                    connection,
                    {
                        user_id: req.user.id,
                        customer_name: sanitizeString(customer.name),
                        customer_email: sanitizeString(customer.email),
                        customer_phone: sanitizeString(customer.phone),
                        city: sanitizeString(address.city),
                        state: sanitizeString(address.state),
                        zip: sanitizeString(address.zip),
                        full_address: sanitizeString(address.fullAddress),
                        address_id: addressId ? sanitizeString(addressId) : null,
                        payment_method: sanitizeString(paymentMethod).toLowerCase(),
                        total: safeNumber(total),
                        items,
                        promo_code: promoCode ? sanitizeString(promoCode) : null
                    }
                );
            
            // Consume inventory locks after successful stock deduction
            await inventoryReservationService.consumeLocks(req.user.id, items, connection);

            // The order's first history entry, written before the commit so it
            // shares the order's fate. Without it a brand-new order has an
            // empty timeline, and "when was this placed" is only answerable
            // from a different table.
            await orderStatusHistoryService.recordTransition(connection, {
                orderId: result.orderId,
                fromStatus: null,
                toStatus: "pending",
                source: "customer",
                changedBy: safeUUID(req.user?.id),
                changedByName: sanitizeString(customer.name || ""),
                reason: "Order placed",
                metadata: { paymentMethod: sanitizeString(paymentMethod).toLowerCase() },
                request: req
            });

            // commit transaction
            await connection.commit();

            // Ordering metadata for the address list, written after the commit
            // and deliberately not awaited into the order's fate: a failed
            // timestamp must not fail a placed order. The service swallows its
            // own errors.
            if (addressId) {
                await addressService.markAddressUsed(req.user.id, addressId);
            }

            return res.status(201)
                .json({
                    success: true,
                    message:
                        "Order placed successfully",
                    addressId:
                        addressId || null,
                    orderId:
                        result.orderId,
                    breakdown:
                        result.breakdown
                });

        } catch (error) {
            if (connection) {
                await connection.rollback();
            }

            // Release reservation locks if the transaction failed mid-checkout
            try {
                if (req.user?.id) {
                    await inventoryReservationService.releaseUserLocks(req.user.id);
                }
            } catch (_) { /* ignore */ }

            if (error.code === TOTAL_MISMATCH_CODE) {
                return res.status(409)
                    .json({
                        success: false,
                        code: TOTAL_MISMATCH_CODE,
                        message: error.message,
                        submittedTotal: error.submittedTotal,
                        computedTotal: error.computedTotal
                    });
            }

            if (
                error.code === "INVENTORY_CONFLICT"
                || /insufficient stock/i.test(error.message || "")
            ) {
                return res.status(409).json({
                    success: false,
                    code: "INVENTORY_CONFLICT",
                    message: error.message || "Insufficient stock",
                    productId: error.productId,
                    availableStock: error.availableStock ?? null,
                    requested: error.requested ?? null
                });
            }

            console.error(
                "CREATE ORDER ERROR:",
                error
            );

            return res.status(500)
                .json({
                    success: false,
                    message: "Failed to create order"
                });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    };

// get all orders
const getAllOrders = async (req, res) => {
    const {
        page,
        limit,
        offset
    } = getPagination(
        req.query.page,
        req.query.limit,
        50
    );

    const countQuery = `
        SELECT COUNT(*) AS total
        FROM orders
    `;

    try {
        const [countResults] = await db.query(countQuery);
        const total = Number(countResults?.[0]?.total || 0);

        const query = `
            SELECT
                id,
                user_id,
                customer_name,
                customer_email,
                payment_method,
                total,
                status,
                created_at
            FROM orders
            ORDER BY id DESC
            LIMIT ?
            OFFSET ?
        `;

        const [results] = await db.query(query, [limit, offset]);

        res.status(200).json({
            success: true,
            page,
            limit,
            total,
            ...buildPaginationMeta(total, page, limit),
            orders: safeArray(results)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// get user orders
const getUserOrders = async (req, res) => {
    const query = `
        SELECT
            id,
            customer_name,
            payment_method,
            total,
            status,
            created_at
        FROM orders
        WHERE user_id = ?
        ORDER BY id DESC
    `;

    try {
        const [results] = await db.query(query, [req.user.id]);
        res.status(200).json({
            success: true,
            orders: safeArray(results)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// get order by id
const getOrderById = async (req, res) => {
    const id = safeUUID(req.params.id);

    if (!id) {
        return res.status(400).json({
            success: false,
            message: "Invalid order ID"
        });
    }

    let query = `
        SELECT *
        FROM orders
        WHERE id = ?
    `;

    const queryParams = [id];

    // normal users can only access own orders
    if (!hasPermission(req.user, PERMISSIONS.ORDER_READ_ANY)) {
        query += `
            AND user_id = ?
        `;
        queryParams.push(req.user.id);
    }

    try {
        const [results] = await db.query(query, queryParams);

        if (!safeArray(results).length) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        const [items] = await db.query(
            "SELECT * FROM order_items WHERE order_id = ?",
            [id]
        );

        const orderData = {
            ...results[0],
            items: safeArray(items)
        };

        res.status(200).json({
            success: true,
            order: orderData,
            data: orderData
        });
    } catch (err) {
        console.error("GET ORDER BY ID ERROR:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// get order status (Issue #778 / frontend order status tracking)
const getOrderStatus = async (req, res) => {
    const id = safeUUID(req.params.id);

    if (!id) {
        return res.status(400).json({
            success: false,
            message: "Invalid order ID"
        });
    }

    let query = `
        SELECT *
        FROM orders
        WHERE id = ?
    `;

    const queryParams = [id];

    // normal users can only access own orders
    if (!hasPermission(req.user, PERMISSIONS.ORDER_READ_ANY)) {
        query += `
            AND user_id = ?
        `;
        queryParams.push(req.user.id);
    }

    try {
        const [results] = await db.query(query, queryParams);

        if (!safeArray(results).length) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        const [items] = await db.query(
            "SELECT * FROM order_items WHERE order_id = ?",
            [id]
        );

        const orderData = {
            ...results[0],
            items: safeArray(items)
        };

        res.status(200).json({
            success: true,
            order: orderData,
            data: orderData
        });
    } catch (err) {
        console.error("GET ORDER STATUS ERROR:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// shared helper for updating order status and managing inventory
/**
 * Apply a status change and record it.
 *
 * `context` carries the provenance the history needs -- who made the change,
 * from which surface, and why. Without it every entry would be an anonymous
 * `system` row, which answers none of the questions a status history exists
 * for.
 */
const performOrderStatusUpdate = async (connection, id, currentStatus, newStatus, context = {}) => {
    // if cancelling a previously un-cancelled order, restore stock
    if (newStatus === "cancelled" && currentStatus !== "cancelled") {
        const [items] = await connection.query(
            "SELECT product_id, qty FROM order_items WHERE order_id = ?",
            [id]
        );

        for (const item of safeArray(items)) {
            if (item.product_id) {
                await connection.query(
                    "UPDATE products SET stock = stock + ? WHERE id = ?",
                    [item.qty, item.product_id]
                );
            }
        }
    }

    // update order status
    await connection.query(
        "UPDATE orders SET status = ? WHERE id = ?",
        [newStatus, id]
    );

    // Record the transition in the SAME transaction as the status write.
    //
    // This is the whole point: a history written separately can be missing
    // rows because the second write failed, and a history written before a
    // rolled-back status change is worse than none. It also sets the
    // shipped_at / delivered_at / cancelled_at columns, which have been in the
    // schema from the start and were never written (#1351).
    await orderStatusHistoryService.recordTransition(connection, {
        orderId: id,
        fromStatus: currentStatus,
        toStatus: newStatus,
        source: context.source || "system",
        changedBy: context.changedBy || null,
        changedByName: context.changedByName || null,
        reason: context.reason || null,
        metadata: context.metadata || null,
        request: context.request || null
    });
};

// update order status
const updateOrderStatus = async (req, res) => {
    const id = safeUUID(req.params.id);
    const newStatus = sanitizeString(req.body.status).toLowerCase();

    const validStatuses = [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled"
    ];

    if (!id) {
        return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    if (!validStatuses.includes(newStatus)) {
        return res.status(400).json({ success: false, message: "Invalid order status" });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // fetch current order status
        const [orders] = await connection.query(
            "SELECT status FROM orders WHERE id = ? FOR UPDATE",
            [id]
        );

        if (!safeArray(orders).length) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const currentStatus = orders[0].status;

        await performOrderStatusUpdate(connection, id, currentStatus, newStatus, {
            source: "admin",
            changedBy: safeUUID(req.user?.id),
            changedByName: sanitizeString(req.user?.name || ""),
            // An admin changing a status without saying why is the case
            // support cannot reconstruct, so the field is offered even though
            // it is optional.
            reason: sanitizeString(req.body?.reason || "") || null,
            request: req
        });

        await connection.commit();

        return res.status(200).json({ success: true, message: "Order status updated" });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error("UPDATE ORDER STATUS ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// cancel user order
const cancelUserOrder = async (req, res) => {
    const id = safeUUID(req.params.id);

    if (!id) {
        return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Ownership is enforced by requireOwnership on the route; the row is
        // re-read under FOR UPDATE because the cancellation decision depends on
        // the status, which must not move between the check and the write.
        const [orders] = await connection.query(
            "SELECT user_id, status FROM orders WHERE id = ? FOR UPDATE",
            [id]
        );

        if (!safeArray(orders).length) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const currentStatus = orders[0].status;

        // check if order can be cancelled
        if (["shipped", "delivered", "cancelled"].includes(currentStatus)) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: `Cannot cancel a ${currentStatus} order` });
        }

        await performOrderStatusUpdate(connection, id, currentStatus, "cancelled", {
            source: "customer",
            changedBy: safeUUID(req.user?.id),
            changedByName: sanitizeString(req.user?.name || ""),
            reason: sanitizeString(req.body?.reason || "") || "Cancelled by customer",
            request: req
        });

        await connection.commit();

        return res.status(200).json({ success: true, message: "Order cancelled successfully" });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error("CANCEL ORDER ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// validate order data before submission
const validateOrder = (req, res) => {
    try {
        const { validateOrderDataService } = require("../services/order.service");
        const result = validateOrderDataService(req.body);
        if (!result.isValid) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: result.errors
            });
        }
        return res.status(200).json({
            success: true,
            message: "Validation successful"
        });
    } catch (error) {
        console.error("VALIDATE ORDER ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// get order summary
const getOrderSummary = async (req, res) => {
    try {
        const id = safeUUID(req.params.id);
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID"
            });
        }

        const { getOrderSummaryById } = require("../services/order.service");
        const summary = await getOrderSummaryById(db, id);
        if (!summary) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }
        return res.status(200).json({
            success: true,
            summary
        });
    } catch (err) {
        console.error("GET ORDER SUMMARY ERROR:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// download invoice
const downloadInvoice = async (req, res) => {
    try {
        const orderId = req.params.id;
        
        // Fetch order details
        const [orders] = await db.query("SELECT * FROM orders WHERE id = ?", [orderId]);
        if (!orders || orders.length === 0) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        const order = orders[0];

        // Ownership is enforced by requireOwnership on the route.

        // Fetch order items
        const [items] = await db.query("SELECT * FROM order_items WHERE order_id = ?", [orderId]);

        // Generate PDF
        const pdfBuffer = await generateInvoicePdf(order, items);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice-${orderId}.pdf"`);
        return res.status(200).send(pdfBuffer);
    } catch (error) {
        console.error("Error generating invoice:", error);
        return res.status(500).json({ success: false, message: "Failed to generate invoice" });
    }
};

// create payment intent
const createPaymentIntent = async (req, res) => {
    let connection;
    try {
        connection = await db.getConnection();

        const { customer, address, items, total, promoCode } = req.body;

        if (!customer || !customer.name || !customer.email) {
            return res.status(400).json({ success: false, message: "Customer information required" });
        }
        if (!address || !address.fullAddress) {
            return res.status(400).json({ success: false, message: "Delivery address required" });
        }
        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: "Order items required" });
        }
        // Shape check only; the charged amount comes from the order service.
        if (safeNumber(total) <= 0) {
            return res.status(400).json({ success: false, message: "Invalid order total" });
        }

        await connection.beginTransaction();

        const lockCheck = await inventoryReservationService.validateCartLocksDetailed(
            req.user.id,
            items,
            connection
        );
        if (!lockCheck.ok) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                code: lockCheck.code || "INVENTORY_CONFLICT",
                message: lockCheck.message || "Inventory locks expired or insufficient stock",
                productId: lockCheck.productId,
                availableStock: lockCheck.availableStock,
                requested: lockCheck.requested
            });
        }

        const result = await createOrderService(connection, {
            user_id: req.user.id,
            customer_name: sanitizeString(customer.name),
            customer_email: sanitizeString(customer.email),
            customer_phone: sanitizeString(customer.phone),
            city: sanitizeString(address.city),
            state: sanitizeString(address.state),
            zip: sanitizeString(address.zip),
            full_address: sanitizeString(address.fullAddress),
            payment_method: 'card',
            total: safeNumber(total),
            items,
            promo_code: promoCode ? sanitizeString(promoCode) : null
        });

        await inventoryReservationService.consumeLocks(req.user.id, items, connection);

        // Charge what the engine priced, never what the browser claimed.
        const chargeableTotal = result.breakdown.total;

        // Charge via chaos-aware payment helper so injected / real failures
        // always release inventory locks and roll back the order txn (#1398).
        const chaosProxy = require("../services/chaosProxy");
        const paymentIntentResult = await chaosProxy.chargeWithLockRelease({
            charge: () =>
                paymentService.createPaymentIntent(chargeableTotal, CURRENCY.code, {
                    orderId: result.orderId,
                    userId: req.user.id
                }),
            rollback: async () => {
                await connection.rollback();
            },
            releaseLocks: async () => {
                await inventoryReservationService.releaseUserLocks(req.user.id);
            }
        });
        if (!paymentIntentResult.success) {
            return res.status(paymentIntentResult.status || 500).json({
                success: false,
                message: paymentIntentResult.error || "Payment service temporarily unavailable. Please try again.",
                code: paymentIntentResult.code || "PAYMENT_UNAVAILABLE"
            });
        }

        await connection.query("UPDATE orders SET payment_intent_id = ? WHERE id = ?", [paymentIntentResult.paymentIntentId, result.orderId]);

        await connection.commit();

        return res.status(201).json({
            success: true,
            clientSecret: paymentIntentResult.clientSecret,
            orderId: result.orderId,
            breakdown: result.breakdown
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        try {
            if (req.user?.id) {
                await inventoryReservationService.releaseUserLocks(req.user.id);
            }
        } catch (_) { /* ignore */ }

        if (error.code === TOTAL_MISMATCH_CODE) {
            return res.status(409).json({
                success: false,
                code: TOTAL_MISMATCH_CODE,
                message: error.message,
                submittedTotal: error.submittedTotal,
                computedTotal: error.computedTotal
            });
        }

        if (
            error.code === "INVENTORY_CONFLICT"
            || /insufficient stock/i.test(error.message || "")
        ) {
            return res.status(409).json({
                success: false,
                code: "INVENTORY_CONFLICT",
                message: error.message || "Insufficient stock",
                productId: error.productId,
                availableStock: error.availableStock ?? null,
                requested: error.requested ?? null
            });
        }

        console.error("CREATE PAYMENT INTENT ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to create payment intent" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// export orders as CSV (admin/support)
const exportOrders = async (req, res) => {
    try {
        const { status } = req.query;
        let query = `
            SELECT 
                id, 
                user_id, 
                customer_name, 
                customer_email, 
                customer_phone, 
                city, 
                state, 
                zip, 
                full_address, 
                payment_method, 
                total, 
                status, 
                created_at
            FROM orders
        `;
        const params = [];

        if (status) {
            query += " WHERE status = ?";
            params.push(status.trim().toLowerCase());
        }

        query += " ORDER BY created_at DESC";

        const [orders] = await db.query(query, params);

        const { Parser } = require('json2csv');
        const fields = [
            'id', 'user_id', 'customer_name', 'customer_email', 'customer_phone',
            'city', 'state', 'zip', 'full_address', 'payment_method', 'total', 'status', 'created_at'
        ];
        
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(safeArray(orders));

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=orders_${Date.now()}.csv`);
        return res.status(200).send(csv);

    } catch (error) {
        console.error("CSV EXPORT ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to export orders as CSV"
        });
    }
};

/**
 * GET /api/orders/:id/timeline
 *
 * The order's progress: a ladder of steps for rendering, plus the recorded
 * history behind it.
 *
 * Ownership is checked the same way getOrderById does -- the user_id predicate
 * is added for callers who cannot read any order, so somebody else's order is
 * *not found* rather than forbidden. A 403 on an order id confirms the order
 * exists.
 *
 * The administrative roles additionally see the actor, the request metadata
 * and internal reasons; everyone else sees only their own stated reasons.
 */
const getOrderTimeline = async (req, res) => {
    const id = safeUUID(req.params.id);

    if (!id) {
        return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Two different questions, so two different predicates. Reading somebody
    // else's order is the same capability getOrderById grants, which support
    // holds; seeing the actor and the internal notes is not, and stays with
    // the administrative roles.
    const canReadAnyOrder = hasPermission(req.user, PERMISSIONS.ORDER_READ_ANY);
    const canSeeInternalDetail = isAdminRole(req.user?.role);

    let query = "SELECT id, status, created_at FROM orders WHERE id = ?";
    const params = [id];

    if (!canReadAnyOrder) {
        query += " AND user_id = ?";
        params.push(req.user.id);
    }

    try {
        const [orders] = await db.query(query, params);
        const order = safeArray(orders)[0];

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const timeline = await orderStatusHistoryService.getTimeline(order, {
            includeInternal: canSeeInternalDetail
        });

        return res.status(200).json({ success: true, data: timeline });
    } catch (error) {
        console.error("GET ORDER TIMELINE ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to load the order timeline"
        });
    }
};

/**
 * GET /api/orders/reports/fulfilment  (admin)
 *
 * Average hours to ship and to deliver. This is what the shipped_at /
 * delivered_at columns were in the schema for, and it has never been
 * answerable because nothing wrote them (#1351).
 */
const getFulfilmentReport = async (req, res) => {
    try {
        const stats = await orderStatusHistoryService.getFulfilmentStats({
            from: req.query.from,
            to: req.query.to
        });

        return res.status(200).json({ success: true, data: stats });
    } catch (error) {
        console.error("GET FULFILMENT REPORT ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to build the fulfilment report"
        });
    }
};

module.exports = {
    createOrder,
    getAllOrders,
    getUserOrders,
    getOrderById,
    getOrderTimeline,
    getFulfilmentReport,
    getOrderStatus,
    updateOrderStatus,
    cancelUserOrder,
    validateOrder,
    getOrderSummary,
    downloadInvoice,
    createPaymentIntent,
    exportOrders
};

