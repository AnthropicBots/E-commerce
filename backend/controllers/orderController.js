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
const stockCounter = require("../services/stockCounterService");
// Read in the catch blocks of createOrder and createPaymentIntent, to tell an
// unknown delivery method from a server fault. The require went missing, so
// the branch meant to classify the error threw a ReferenceError of its own and
// buried whatever actually went wrong (#1444).
const shippingService = require("../services/shipping.service");

const {
    safeNumber,
    safeInteger,
    sanitizeString,
    getPagination,
    buildPaginationMeta,
    maskPhone,
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
// Guest checkout (#1427).
const guestCart = require("../services/guestCartService");
const { findGuestOrder } = require("../services/guestOrderService");

// The most orders one page of the customer's history may carry. The list is
// rendered as cards, so a page that needs scrolling past this is a page nobody
// reads; the number matches MAX_PRODUCT_LIMIT so the two paginated customer
// surfaces behave the same. `orderRoutes` rejects anything above 100 outright;
// a request between the two is clamped here and reports the clamped figure
// back in the pagination meta rather than pretending it was honoured (#1545).
const MAX_ORDER_PAGE_SIZE = 50;

/** What `?limit=` defaults to when the client does not ask for a page size. */
const DEFAULT_ORDER_PAGE_SIZE = 10;

// The statuses `?status=` may name. Same list `orderRoutes` validates against,
// so a value that clears the route is a value this can filter on.
const ORDER_HISTORY_STATUSES = Object.freeze([
    "pending",
    "processing",
    "shipped",
    "delivered",
    "cancelled"
]);

/**
 * Whoever is checking out, and the cart they are checking out of (#1427).
 *
 * `cartIdentity` has already settled which of the two it is and refused
 * anything else, so this only has to look the cart up. A guest with no
 * resolvable cart is not turned away: what is being bought is the posted
 * basket, priced server-side, and the cart row only exists here so it can be
 * closed. A shopper whose token went stale between the last cart write and
 * the checkout has still built a real order.
 */
const resolveCheckoutIdentity = async (req, connection) => {
    const identity = req.cartIdentity || { userId: req.user?.id || null, guestToken: null };
    const userId = identity.userId || null;

    if (userId) {
        return { userId, cartId: null, isGuest: false };
    }

    return {
        userId: null,
        cartId: await guestCart.findCartIdByToken(identity.guestToken, connection),
        isGuest: true
    };
};

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
                addressId,
                // Delivery options (#1430). A code naming one of the offered
                // methods; the server looks up what it costs.
                shippingMethod
            } = req.body;

            const checkout = await resolveCheckoutIdentity(req, connection);

            // Resolve a saved address into the same flat shape the manual form
            // posts, so everything below this point is unchanged whichever way
            // the shopper checked out.
            //
            // The lookup is scoped to the calling user by addressService, so an
            // id belonging to somebody else resolves to null and is rejected as
            // "not found" rather than silently shipping to a stranger. A guest
            // has no address book, so an id from one is simply not theirs.
            if (addressId && !checkout.userId) {
                return res.status(404)
                    .json({
                        success: false,
                        message:
                            "Saved address not found"
                    });
            }

            if (addressId) {
                const resolved = await addressService.resolveForOrder(
                    checkout.userId,
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

            // Validate inventory locks with structured 409 on conflict (#1260).
            //
            // A reservation is held against an account, so a guest basket has
            // none to validate. Nothing is oversold by skipping the check: the
            // stock deduction inside the order service is guarded on the stock
            // it is deducting from, and that is what actually prevents it. A
            // guest simply does not get the fifteen minutes an account gets to
            // finish paying.
            if (checkout.userId) {
                const lockCheck = await inventoryReservationService.validateCartLocksDetailed(
                    checkout.userId,
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
            }

            // create order via service
            const result =
                await createOrderService(
                    connection,
                    {
                        user_id: checkout.userId,
                        cart_id: checkout.cartId,
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
                        promo_code: promoCode ? sanitizeString(promoCode) : null,
                        shipping_method: shippingMethod
                            ? sanitizeString(shippingMethod)
                            : null
                    }
                );
            
            // Consume inventory locks after successful stock deduction
            if (checkout.userId) {
                await inventoryReservationService.consumeLocks(checkout.userId, items, connection);
            }

            // The order's first history entry, written before the commit so it
            // shares the order's fate. Without it a brand-new order has an
            // empty timeline, and "when was this placed" is only answerable
            // from a different table.
            await orderStatusHistoryService.recordTransition(connection, {
                orderId: result.orderId,
                fromStatus: null,
                toStatus: "pending",
                source: "customer",
                changedBy: safeUUID(checkout.userId),
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
                await addressService.markAddressUsed(checkout.userId, addressId);
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
                    // The only handle a guest will have on this order, so it
                    // is returned whoever placed it rather than only to them.
                    orderNumber:
                        result.orderNumber,
                    breakdown:
                        result.breakdown
                });

        } catch (error) {
            if (connection) {
                await connection.rollback();
            }

            // Release reservation locks if the transaction failed mid-checkout
            try {
                if (req.cartIdentity?.userId || req.user?.id) {
                    await inventoryReservationService.releaseUserLocks(
                        req.cartIdentity?.userId || req.user.id
                    );
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

            // A delivery option that names nothing is a bad request, not a
            // server fault, and the message lists what is on offer.
            if (error.code === shippingService.UNKNOWN_METHOD_CODE) {
                return res.status(400).json({
                    success: false,
                    code: shippingService.UNKNOWN_METHOD_CODE,
                    message: error.message
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
    // `created_at DESC`, not `id DESC`.
    //
    // `orders.id` is a CHAR(36) filled with `crypto.randomUUID()`
    // (order.service.js), so ordering by it descending orders a random string.
    // The customer's history came back shuffled: a purchase from last year
    // could sit above one from this morning, and "your latest order" was
    // whichever UUID happened to sort highest (#1545).
    //
    // `id` stays on as the tie-breaker. Two orders placed in the same second
    // need a total order, or pagination overlaps and drops rows between pages
    // -- the same reason the product list carries one.
    const ORDER_BY = "ORDER BY created_at DESC, id DESC";

    // A soft-deleted order is not one of the customer's orders. The column has
    // been there from the start and is honoured elsewhere -- giftCardService
    // refuses to settle an order carrying `deleted_at` -- but this list read
    // straight past it.
    const conditions = ["user_id = ?", "deleted_at IS NULL"];
    const filterParams = [req.user.id];

    // The route has validated `?status=` since it was written, and the handler
    // never read it -- so "Get current user orders with pagination and
    // filtering" filtered nothing. Re-checked here against the same list
    // rather than trusted, because the handler is reachable from tests and
    // from any future mount that does not carry the route's validator.
    const requestedStatus = sanitizeString(req.query.status || "")
        .trim()
        .toLowerCase();

    // Echoed back as null when nothing was applied. Reflecting the requested
    // value regardless would tell a client its filter took effect when the
    // list it is looking at is unfiltered.
    const appliedStatus = ORDER_HISTORY_STATUSES.includes(requestedStatus)
        ? requestedStatus
        : null;

    if (appliedStatus) {
        conditions.push("status = ?");
        filterParams.push(appliedStatus);
    }

    const WHERE = `WHERE ${conditions.join(" AND ")}`;

    // Paginated, because an order history grows for as long as the account
    // lives. This returned every order ever placed in one response, which is
    // the defect #1349 fixed for reviews.
    const { page, limit, offset } = getPagination(
        req.query.page,
        req.query.limit ?? DEFAULT_ORDER_PAGE_SIZE,
        MAX_ORDER_PAGE_SIZE
    );

    try {
        // The count runs against the same WHERE the page does. A total drawn
        // from a different predicate is a pager that promises pages which come
        // back empty.
        const [countRows] = await db.query(
            `SELECT COUNT(*) AS total FROM orders ${WHERE}`,
            filterParams
        );

        const total = Number(safeArray(countRows)[0]?.total || 0);

        const [results] = await db.query(
            `
                SELECT
                    id,
                    order_number,
                    customer_name,
                    payment_method,
                    payment_status,
                    total,
                    status,
                    created_at
                FROM orders
                ${WHERE}
                ${ORDER_BY}
                LIMIT ?
                OFFSET ?
            `,
            [...filterParams, limit, offset]
        );

        res.status(200).json({
            success: true,
            ...buildPaginationMeta(total, page, limit),
            count: safeArray(results).length,
            status: appliedStatus,
            orders: safeArray(results)
        });
    } catch (err) {
        console.error("GET USER ORDERS ERROR:", err);
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

    // Same rule as the list, and for the same reason it applies to products:
    // an order hidden from the history but readable at its own URL is not
    // hidden. It applies to admins too -- `ORDER_READ_ANY` is permission to
    // read any *order*, not to read past a delete (#1545).
    let query = `
        SELECT *
        FROM orders
        WHERE id = ? AND deleted_at IS NULL
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
    // If cancelling a previously un-cancelled order, put the units back on the
    // counter the sale took them from. Crediting only the product total would
    // leave the size the shopper actually cancelled permanently short.
    if (newStatus === "cancelled" && currentStatus !== "cancelled") {
        const [items] = await connection.query(
            "SELECT product_id, variant_id, qty FROM order_items WHERE order_id = ?",
            [id]
        );

        for (const item of safeArray(items)) {
            if (item.product_id) {
                await stockCounter.restoreStock(connection, {
                    productId: item.product_id,
                    variantId: item.variant_id,
                    quantity: item.qty
                });
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

        const { customer, address, items, total, promoCode, shippingMethod } = req.body;

        const checkout = await resolveCheckoutIdentity(req, connection);

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

        // A guest holds no reservations to validate; see createOrder above for
        // why that does not put stock at risk.
        if (checkout.userId) {
            const lockCheck = await inventoryReservationService.validateCartLocksDetailed(
                checkout.userId,
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
        }

        const result = await createOrderService(connection, {
            user_id: checkout.userId,
            cart_id: checkout.cartId,
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
            promo_code: promoCode ? sanitizeString(promoCode) : null,
            shipping_method: shippingMethod ? sanitizeString(shippingMethod) : null
        });

        if (checkout.userId) {
            await inventoryReservationService.consumeLocks(checkout.userId, items, connection);
        }

        // Charge what the engine priced, never what the browser claimed.
        const chargeableTotal = result.breakdown.total;

        // Charge via chaos-aware payment helper so injected / real failures
        // always release inventory locks and roll back the order txn (#1398).
        const chaosProxy = require("../services/chaosProxy");
        const paymentIntentResult = await chaosProxy.chargeWithLockRelease({
            charge: () =>
                paymentService.createPaymentIntent(chargeableTotal, CURRENCY.code, {
                    orderId: result.orderId,
                    userId: checkout.userId
                }),
            rollback: async () => {
                await connection.rollback();
            },
            releaseLocks: async () => {
                if (checkout.userId) {
                    await inventoryReservationService.releaseUserLocks(checkout.userId);
                }
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
            orderNumber: result.orderNumber,
            breakdown: result.breakdown
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        try {
            if (req.cartIdentity?.userId || req.user?.id) {
                await inventoryReservationService.releaseUserLocks(
                    req.cartIdentity?.userId || req.user.id
                );
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

        if (error.code === shippingService.UNKNOWN_METHOD_CODE) {
            return res.status(400).json({
                success: false,
                code: shippingService.UNKNOWN_METHOD_CODE,
                message: error.message
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
 *
 * The delivery option the order was sold, its charge and the window it was
 * promised for ride along, because "when is this arriving" is the question the
 * timeline is opened to answer (#1430).
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

    let query =
        "SELECT id, status, created_at, shipping_method, shipping_cost, " +
        "estimated_delivery_from, estimated_delivery FROM orders WHERE id = ?";
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
 * POST /api/orders/lookup
 *
 * An order found without an account, on the pair the shopper was given at
 * checkout: the order number and the email it was placed with (#1427).
 *
 * The credentials arrive in the body rather than the path so they do not
 * accumulate in access logs, proxy caches and browser history, which is where
 * a bearer credential in a URL ends up.
 *
 * Every failure is the same 404 with the same wording. Distinguishing "no such
 * order" from "wrong email" would answer, one request at a time, whether a
 * given address has ever shopped here.
 */
const lookupGuestOrder = async (req, res) => {
    try {
        const order = await findGuestOrder({
            orderNumber: req.body?.orderNumber,
            email: req.body?.email
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "No order matches that order number and email address"
            });
        }

        return res.status(200).json({
            success: true,
            order: {
                orderNumber: order.order_number,
                status: order.status,
                paymentStatus: order.payment_status,
                paymentMethod: order.payment_method,
                placedAt: order.created_at,
                updatedAt: order.updated_at,
                trackingNumber: order.tracking_number,
                customerName: order.customer_name,
                // The caller proved they know the email, so it is theirs to
                // see. They proved nothing about the phone number, and a
                // number is worth more to somebody who should not have it
                // than it is to the shopper reading their own order.
                customerPhone: maskPhone(order.customer_phone),
                deliveryAddress: {
                    fullAddress: order.full_address,
                    city: order.city,
                    state: order.state,
                    zip: order.zip
                },
                totals: {
                    subtotal: order.subtotal,
                    tax: order.tax,
                    shipping: order.shipping_cost,
                    discount: order.discount_amount,
                    total: order.total
                },
                items: safeArray(order.items)
            }
        });
    } catch (error) {
        console.error("GUEST ORDER LOOKUP ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to look up the order"
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

// What the recovery programme brought back, and which message brought it
// (#1429). Read straight off the orders that recorded it, so the figure does
// not move when the reporting code does.
const getRecoveryReport = async (req, res) => {
    try {
        const days = safeInteger(req.query.days, 30);

        const [revenue, byStage] = await Promise.all([
            cartRecoveryAttribution.getRecoveredRevenue({ days }),
            cartRecoveryAttribution.getRecoveryByStage({ days })
        ]);

        return res.status(200).json({
            success: true,
            data: { ...revenue, byStage }
        });
    } catch (error) {
        console.error("GET RECOVERY REPORT ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to build the recovery report"
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
    // Defined above but left out of this list, so `orderController.getRecoveryReport`
    // was `undefined` and `router.get("/reports/recovery", …)` threw
    // "argument handler must be a function" while orderRoutes.js was being
    // required -- the whole server failed to boot (#1444).
    getRecoveryReport,
    lookupGuestOrder,
    getOrderStatus,
    updateOrderStatus,
    cancelUserOrder,
    validateOrder,
    getOrderSummary,
    downloadInvoice,
    createPaymentIntent,
    exportOrders
};

