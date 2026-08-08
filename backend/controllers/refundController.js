const db = require("../config/db");
const RefundRequest = require("../models/RefundRequest");
const stockCounter = require("../services/stockCounterService");
const {
    safeArray,
    safeInteger,
    safeUUID,
    sanitizeString
} = require("../utils/helpers");

// Returns are only offered once an order has actually reached the customer.
const ELIGIBLE_ORDER_STATUS = "delivered";
const RETURN_WINDOW_DAYS = 30;
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 1000;
const MAX_ADMIN_NOTE_LENGTH = 1000;
const REFUND_STATUSES = ["pending", "approved", "rejected", "refunded"];

// The window runs from delivery when we have it, otherwise from order
// creation so orders delivered before delivered_at was tracked still resolve.
function isReturnWindowExpired(order) {
    const reference = order.delivered_at || order.created_at;

    if (!reference) {
        return false;
    }

    const referenceTime = new Date(reference).getTime();

    if (Number.isNaN(referenceTime)) {
        return false;
    }

    const ageInDays = (Date.now() - referenceTime) / (1000 * 60 * 60 * 24);

    return ageInDays > RETURN_WINDOW_DAYS;
}

const createRequest = async (req, res) => {
    const userId = safeUUID(req.user?.id);
    const orderId = safeUUID(req.body.orderId);
    const orderItemId = safeInteger(req.body.orderItemId);
    const reason = sanitizeString(req.body.reason);
    const requestedQty =
        req.body.quantity === undefined || req.body.quantity === null
            ? null
            : safeInteger(req.body.quantity);

    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    if (!orderId) {
        return res.status(400).json({
            success: false,
            message: "Invalid order ID"
        });
    }

    if (orderItemId < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid order item"
        });
    }

    if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
        return res.status(400).json({
            success: false,
            message: `Reason must be between ${MIN_REASON_LENGTH} and ${MAX_REASON_LENGTH} characters`
        });
    }

    // The whole submission runs in one transaction (#1477). The units already
    // claimed on this line have to be counted and the new request inserted
    // without anything landing in between -- read on the pool and written on the
    // pool, two submissions arriving together both saw the same figure, both
    // passed, and the line went out over its quantity.
    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [orders] = await connection.query(
            "SELECT user_id, status, delivered_at, created_at FROM orders WHERE id = ? LIMIT 1",
            [orderId]
        );

        const order = safeArray(orders)[0];

        if (!order || order.user_id !== userId) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        if (order.status !== ELIGIBLE_ORDER_STATUS) {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: "Only delivered orders are eligible for a return"
            });
        }

        if (isReturnWindowExpired(order)) {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: `The ${RETURN_WINDOW_DAYS}-day return window for this order has closed`
            });
        }

        // `FOR UPDATE` on the order line, not on the requests. The line is the
        // thing there is exactly one of, so it is what two concurrent
        // submissions for the same item can serialize on; locking the request
        // rows would lock nothing when there are none yet, which is precisely
        // the case that races.
        const [items] = await connection.query(
            `SELECT id, product_id, qty
               FROM order_items
              WHERE id = ? AND order_id = ?
              LIMIT 1
              FOR UPDATE`,
            [orderItemId, orderId]
        );

        const item = safeArray(items)[0];

        if (!item) {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: "The selected item is not part of this order"
            });
        }

        const purchasedQty = safeInteger(item.qty);
        const claimedQty = await RefundRequest.claimedQuantityForItem(
            orderItemId,
            connection
        );
        const returnableQty = Math.max(purchasedQty - claimedQty, 0);

        if (returnableQty < 1) {
            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: "Every unit of this item has already been returned",
                data: {
                    purchased_quantity: purchasedQty,
                    claimed_quantity: claimedQty,
                    returnable_quantity: 0
                }
            });
        }

        // Omitting the quantity means "the rest of it", which is what it always
        // meant -- it just used to resolve to the quantity purchased rather than
        // the quantity still returnable.
        const quantity = requestedQty === null ? returnableQty : requestedQty;

        if (quantity < 1 || quantity > returnableQty) {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: claimedQty > 0
                    ? `You have already returned ${claimedQty} of ${purchasedQty}. `
                      + `Return quantity must be between 1 and ${returnableQty}`
                    : `Return quantity must be between 1 and ${returnableQty}`,
                data: {
                    purchased_quantity: purchasedQty,
                    claimed_quantity: claimedQty,
                    returnable_quantity: returnableQty
                }
            });
        }

        const requestId = await RefundRequest.create(
            {
                userId,
                orderId,
                orderItemId,
                productId: item.product_id,
                reason,
                quantity
            },
            connection
        );

        const created = await RefundRequest.findById(requestId, { connection });

        await connection.commit();

        return res.status(201).json({
            success: true,
            message: "Return request submitted",
            data: {
                ...(created ? created.toJSON() : { id: requestId }),
                purchased_quantity: purchasedQty,
                returnable_quantity: returnableQty - quantity
            }
        });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("CREATE REFUND REQUEST ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to submit return request"
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * What is still returnable on a delivered order.
 *
 * There was no way to ask (#1477). A customer looking at a delivered order could
 * only find out what was left by submitting a request and reading the refusal,
 * and the refusal did not say how many were left either.
 *
 * Every line of the order is listed, including ones that are fully returned, so
 * the caller can render the whole order rather than only its remainder.
 */
const listReturnable = async (req, res) => {
    const userId = safeUUID(req.user?.id);
    const orderId = safeUUID(req.params.orderId);

    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    if (!orderId) {
        return res.status(400).json({
            success: false,
            message: "Invalid order ID"
        });
    }

    try {
        const [orders] = await db.query(
            "SELECT user_id, status, delivered_at, created_at FROM orders WHERE id = ? LIMIT 1",
            [orderId]
        );

        const order = safeArray(orders)[0];

        // Same answer for "no such order" and "not yours". Distinguishing them
        // tells an unauthenticated guesser which order ids exist.
        if (!order || order.user_id !== userId) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        const [items] = await db.query(
            `SELECT id, product_id, variant_id, name, qty
               FROM order_items
              WHERE order_id = ?
              ORDER BY id ASC`,
            [orderId]
        );

        const claimed = await RefundRequest.claimedQuantitiesForOrder(orderId);

        const eligible = order.status === ELIGIBLE_ORDER_STATUS;
        const windowExpired = isReturnWindowExpired(order);
        const orderIsReturnable = eligible && !windowExpired;

        const lines = safeArray(items).map((item) => {
            const purchased = safeInteger(item.qty);
            const claimedForItem = claimed.get(Number(item.id)) || 0;
            const returnable = Math.max(purchased - claimedForItem, 0);

            return {
                order_item_id: item.id,
                product_id: item.product_id,
                variant_id: item.variant_id ?? null,
                name: item.name,
                purchased_quantity: purchased,
                claimed_quantity: claimedForItem,
                // Gated on the order as well as the line: a line with units left
                // is not returnable if the window has closed, and saying so here
                // saves the caller re-deriving it.
                returnable_quantity: orderIsReturnable ? returnable : 0
            };
        });

        return res.status(200).json({
            success: true,
            message: "Returnable quantities fetched",
            data: {
                order_id: orderId,
                order_status: order.status,
                returns_open: orderIsReturnable,
                reason: orderIsReturnable
                    ? null
                    : (!eligible
                        ? "Only delivered orders are eligible for a return"
                        : `The ${RETURN_WINDOW_DAYS}-day return window for this order has closed`),
                items: lines
            }
        });
    } catch (error) {
        console.error("LIST RETURNABLE ITEMS ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch returnable quantities"
        });
    }
};

const listMyRequests = async (req, res) => {
    const userId = safeUUID(req.user?.id);

    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    try {
        const requests = await RefundRequest.findByUser(userId);

        return res.status(200).json({
            success: true,
            message: "Return requests fetched",
            data: requests.map((request) => request.toJSON())
        });
    } catch (error) {
        console.error("LIST MY REFUND REQUESTS ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch return requests"
        });
    }
};

const listAll = async (req, res) => {
    const status = req.query.status
        ? sanitizeString(req.query.status).toLowerCase()
        : null;

    if (status && !REFUND_STATUSES.includes(status)) {
        return res.status(400).json({
            success: false,
            message: `Status must be one of: ${REFUND_STATUSES.join(", ")}`
        });
    }

    try {
        const requests = await RefundRequest.list({ status });

        return res.status(200).json({
            success: true,
            message: "Return requests fetched",
            data: requests.map((request) => request.toJSON())
        });
    } catch (error) {
        console.error("LIST REFUND REQUESTS ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch return requests"
        });
    }
};

const approveRequest = async (req, res) => {
    const adminId = safeUUID(req.user?.id);
    const requestId = safeInteger(req.params.id);
    const adminNote = normalizeAdminNote(req.body.note);

    if (requestId < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid request ID"
        });
    }

    if (adminNote && adminNote.length > MAX_ADMIN_NOTE_LENGTH) {
        return res.status(400).json({
            success: false,
            message: `Admin note cannot exceed ${MAX_ADMIN_NOTE_LENGTH} characters`
        });
    }

    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const request = await RefundRequest.findById(requestId, {
            connection,
            forUpdate: true
        });

        if (!request) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Return request not found"
            });
        }

        if (request.status !== "pending") {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: "Only pending requests can be approved"
            });
        }

        // Credit the counter the sale drew down. The order item records which
        // variant was bought; an item placed before that was recorded has none,
        // and the return can only be credited to the product total.
        let variantId = null;

        if (request.orderItemId) {
            const [items] = await connection.query(
                "SELECT variant_id FROM order_items WHERE id = ? LIMIT 1",
                [request.orderItemId]
            );

            variantId = safeArray(items)[0]?.variant_id ?? null;
        }

        await stockCounter.restoreStock(connection, {
            productId: request.productId,
            variantId,
            quantity: request.quantity
        });

        await RefundRequest.updateStatus(
            requestId,
            { status: "approved", adminNote, reviewedBy: adminId },
            connection
        );

        await connection.commit();

        const updated = await RefundRequest.findById(requestId);

        return res.status(200).json({
            success: true,
            message: "Return request approved and inventory restocked",
            data: updated ? updated.toJSON() : null
        });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("APPROVE REFUND REQUEST ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to approve return request"
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

const rejectRequest = async (req, res) => {
    const adminId = safeUUID(req.user?.id);
    const requestId = safeInteger(req.params.id);
    const adminNote = normalizeAdminNote(req.body.note);

    if (requestId < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid request ID"
        });
    }

    if (adminNote && adminNote.length > MAX_ADMIN_NOTE_LENGTH) {
        return res.status(400).json({
            success: false,
            message: `Admin note cannot exceed ${MAX_ADMIN_NOTE_LENGTH} characters`
        });
    }

    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const request = await RefundRequest.findById(requestId, {
            connection,
            forUpdate: true
        });

        if (!request) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Return request not found"
            });
        }

        if (request.status !== "pending") {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: "Only pending requests can be rejected"
            });
        }

        await RefundRequest.updateStatus(
            requestId,
            { status: "rejected", adminNote, reviewedBy: adminId },
            connection
        );

        await connection.commit();

        const updated = await RefundRequest.findById(requestId);

        return res.status(200).json({
            success: true,
            message: "Return request rejected",
            data: updated ? updated.toJSON() : null
        });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("REJECT REFUND REQUEST ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to reject return request"
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

function normalizeAdminNote(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const note = sanitizeString(value);

    return note.length ? note : null;
}

module.exports = {
    createRequest,
    listReturnable,
    listMyRequests,
    listAll,
    approveRequest,
    rejectRequest
};
