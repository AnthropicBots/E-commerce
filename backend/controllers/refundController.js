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

    try {
        const [orders] = await db.query(
            "SELECT user_id, status, delivered_at, created_at FROM orders WHERE id = ? LIMIT 1",
            [orderId]
        );

        const order = safeArray(orders)[0];

        if (!order || order.user_id !== userId) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        if (order.status !== ELIGIBLE_ORDER_STATUS) {
            return res.status(400).json({
                success: false,
                message: "Only delivered orders are eligible for a return"
            });
        }

        if (isReturnWindowExpired(order)) {
            return res.status(400).json({
                success: false,
                message: `The ${RETURN_WINDOW_DAYS}-day return window for this order has closed`
            });
        }

        const [items] = await db.query(
            "SELECT id, product_id, qty FROM order_items WHERE id = ? AND order_id = ? LIMIT 1",
            [orderItemId, orderId]
        );

        const item = safeArray(items)[0];

        if (!item) {
            return res.status(400).json({
                success: false,
                message: "The selected item is not part of this order"
            });
        }

        const quantity = requestedQty === null ? item.qty : requestedQty;

        if (quantity < 1 || quantity > item.qty) {
            return res.status(400).json({
                success: false,
                message: `Return quantity must be between 1 and ${item.qty}`
            });
        }

        if (await RefundRequest.hasOpenRequestForItem(orderItemId)) {
            return res.status(409).json({
                success: false,
                message: "An open return request already exists for this item"
            });
        }

        const requestId = await RefundRequest.create({
            userId,
            orderId,
            orderItemId,
            productId: item.product_id,
            reason,
            quantity
        });

        const created = await RefundRequest.findById(requestId);

        return res.status(201).json({
            success: true,
            message: "Return request submitted",
            data: created ? created.toJSON() : { id: requestId }
        });
    } catch (error) {
        console.error("CREATE REFUND REQUEST ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to submit return request"
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
    listMyRequests,
    listAll,
    approveRequest,
    rejectRequest
};
