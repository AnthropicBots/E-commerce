/**
 * Refund / RMA controller — state machine + fraud guards (#1389).
 */

"use strict";

const db = require("../config/db");
const RefundRequest = require("../models/RefundRequest");
const {
    RMA_STATUS,
    REASON_CODES,
    POLICY,
    OPEN_STATUSES,
    RmaError,
    normalizeStatus,
    assertTransition,
    assertPolicyWindow,
    isValidReasonCode,
    addressFingerprint,
    fingerprint,
    evaluateFraudVelocity,
    trackingTimeline,
    generateRmaNumber
} = require("../services/refundStateMachine");
const {
    safeArray,
    safeInteger,
    safeUUID,
    sanitizeString
} = require("../utils/helpers");

const MAX_ADMIN_NOTE_LENGTH = 1000;
const ALL_STATUSES = [
    ...Object.values(RMA_STATUS),
    "pending"
];

function daysAgoIso(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
}

function normalizeAdminNote(value) {
    if (value === undefined || value === null) return null;
    const note = sanitizeString(value);
    return note.length ? note : null;
}

function enrichRequest(request) {
    if (!request) return null;
    const json = request.toJSON ? request.toJSON() : request;
    return {
        ...json,
        timeline: trackingTimeline(json.status)
    };
}

async function gatherVelocitySignals(request, connection = db) {
    const since24h = daysAgoIso(1);
    const since7d = daysAgoIso(7);

    const [
        userRequestCount24h,
        addressRequestCount7d,
        paymentRequestCount7d,
        openRequestsForUser,
        priorRefundsSameProduct30d
    ] = await Promise.all([
        RefundRequest.countByUserSince(request.userId, since24h, connection),
        RefundRequest.countByFingerprint(
            "address",
            request.addressFingerprint,
            since7d,
            connection
        ),
        RefundRequest.countByFingerprint(
            "payment",
            request.paymentFingerprint,
            since7d,
            connection
        ),
        RefundRequest.countOpenForUser(request.userId, connection),
        RefundRequest.countProductRefunds30d(
            request.userId,
            request.productId,
            connection
        )
    ]);

    return evaluateFraudVelocity({
        userRequestCount24h,
        addressRequestCount7d,
        paymentRequestCount7d,
        openRequestsForUser,
        priorRefundsSameProduct30d
    });
}

async function transitionRma({
    requestId,
    toStatus,
    actorId,
    adminNote = null,
    shippingTracking = undefined,
    requireFraudCheck = false,
    restockOnApprove = false
}) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const request = await RefundRequest.findById(requestId, {
            connection,
            forUpdate: true
        });

        if (!request) {
            throw new RmaError("Return request not found", {
                status: 404,
                code: "RMA_NOT_FOUND"
            });
        }

        const fromStatus = request.status;
        assertTransition(fromStatus, toStatus);

        let fraud = null;
        if (requireFraudCheck && normalizeStatus(toStatus) === RMA_STATUS.APPROVED) {
            fraud = await gatherVelocitySignals(request, connection);
            if (fraud.blocked) {
                const err = new RmaError(
                    `RMA approval blocked by fraud velocity guards (score ${fraud.score})`,
                    { status: 409, code: "RMA_FRAUD_BLOCKED" }
                );
                err.fraud = fraud;
                throw err;
            }
        }

        if (restockOnApprove && normalizeStatus(toStatus) === RMA_STATUS.APPROVED) {
            let variantId = null;
            if (request.orderItemId) {
                const [items] = await connection.query(
                    "SELECT variant_id FROM order_items WHERE id = ? LIMIT 1",
                    [request.orderItemId]
                );
                variantId = safeArray(items)[0]?.variant_id ?? null;
            }
            if (request.productId) {
                await connection.query(
                    "UPDATE products SET stock = stock + ? WHERE id = ?",
                    [request.quantity, request.productId]
                );
            }
            if (variantId) {
                await connection.query(
                    "UPDATE product_variants SET stock = stock + ? WHERE id = ?",
                    [request.quantity, variantId]
                );
            }
        }

        await RefundRequest.updateStatus(
            requestId,
            {
                status: toStatus,
                adminNote,
                reviewedBy: actorId,
                shippingTracking,
                fraudScore: fraud ? fraud.score : undefined,
                fraudFlags: fraud ? fraud.flags : undefined
            },
            connection
        );

        await RefundRequest.recordTransition(
            {
                rmaId: requestId,
                fromStatus,
                toStatus,
                actorId,
                note: adminNote,
                meta: fraud ? { fraud } : null
            },
            connection
        );

        await connection.commit();

        const updated = await RefundRequest.findById(requestId);
        return { request: updated, fraud };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// ==================== CUSTOMER ====================

const createRequest = async (req, res) => {
    const userId = safeUUID(req.user?.id);
    const orderId = safeUUID(req.body.orderId);
    const orderItemId = safeInteger(req.body.orderItemId);
    const reason = sanitizeString(req.body.reason);
    const reasonCodeRaw = sanitizeString(req.body.reasonCode || req.body.reason_code || "");
    const photoEvidenceUrl = sanitizeString(
        req.body.photoEvidenceUrl || req.body.photo_evidence_url || ""
    ) || null;
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

    if (
        reason.length < POLICY.minReasonLength ||
        reason.length > POLICY.maxReasonLength
    ) {
        return res.status(400).json({
            success: false,
            message: `Reason must be between ${POLICY.minReasonLength} and ${POLICY.maxReasonLength} characters`
        });
    }

    const reasonCode = reasonCodeRaw
        ? reasonCodeRaw.toLowerCase()
        : REASON_CODES.OTHER;
    if (!isValidReasonCode(reasonCode)) {
        return res.status(400).json({
            success: false,
            code: "RMA_INVALID_REASON_CODE",
            message: `reasonCode must be one of: ${Object.values(REASON_CODES).join(", ")}`
        });
    }

    try {
        const [orders] = await db.query(
            `SELECT user_id, status, delivered_at, created_at,
                    full_address, city, state, zip, payment_method, payment_intent_id
             FROM orders WHERE id = ? LIMIT 1`,
            [orderId]
        );

        const order = safeArray(orders)[0];

        if (!order || order.user_id !== userId) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        assertPolicyWindow(order);

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
                code: "RMA_DUPLICATE_OPEN",
                message: "An open return request already exists for this item"
            });
        }

        // Soft velocity check at request time (hard block on approve)
        const addrFp = addressFingerprint({
            fullAddress: order.full_address,
            city: order.city,
            state: order.state,
            zip: order.zip
        });
        const payFp = fingerprint(
            order.payment_intent_id || order.payment_method || ""
        );

        const userCount24h = await RefundRequest.countByUserSince(
            userId,
            daysAgoIso(1)
        );
        if (userCount24h >= POLICY.maxRequestsPerUser24h) {
            return res.status(429).json({
                success: false,
                code: "RMA_USER_VELOCITY",
                message:
                    "Too many return requests in the last 24 hours. Please try again later."
            });
        }

        const requestId = await RefundRequest.create({
            userId,
            orderId,
            orderItemId,
            productId: item.product_id,
            reason,
            quantity,
            reasonCode,
            photoEvidenceUrl,
            addressFingerprint: addrFp,
            paymentFingerprint: payFp,
            rmaNumber: generateRmaNumber()
        });

        await RefundRequest.recordTransition({
            rmaId: requestId,
            fromStatus: null,
            toStatus: RMA_STATUS.REQUESTED,
            actorId: userId,
            note: reasonCode
        });

        const created = await RefundRequest.findById(requestId);

        return res.status(201).json({
            success: true,
            message: "Return request submitted",
            data: enrichRequest(created)
        });
    } catch (error) {
        if (error instanceof RmaError) {
            return res.status(error.status).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }
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
            data: requests.map((request) => enrichRequest(request)),
            reasonCodes: REASON_CODES,
            openStatuses: OPEN_STATUSES
        });
    } catch (error) {
        console.error("LIST MY REFUND REQUESTS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch return requests"
        });
    }
};

const getMyRequest = async (req, res) => {
    const userId = safeUUID(req.user?.id);
    const requestId = safeInteger(req.params.id);

    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    try {
        const request = await RefundRequest.findById(requestId);
        if (!request || request.userId !== userId) {
            return res.status(404).json({
                success: false,
                message: "Return request not found"
            });
        }
        return res.status(200).json({
            success: true,
            data: enrichRequest(request)
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch return request"
        });
    }
};

const markInTransit = async (req, res) => {
    const userId = safeUUID(req.user?.id);
    const requestId = safeInteger(req.params.id);
    const tracking = sanitizeString(req.body.tracking || req.body.shippingTracking || "");

    try {
        const existing = await RefundRequest.findById(requestId);
        if (!existing || existing.userId !== userId) {
            return res.status(404).json({
                success: false,
                message: "Return request not found"
            });
        }

        const { request } = await transitionRma({
            requestId,
            toStatus: RMA_STATUS.IN_TRANSIT,
            actorId: userId,
            shippingTracking: tracking || null
        });

        return res.status(200).json({
            success: true,
            message: "RMA marked in transit",
            data: enrichRequest(request)
        });
    } catch (error) {
        if (error instanceof RmaError) {
            return res.status(error.status).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }
        return res.status(500).json({
            success: false,
            message: "Failed to update RMA"
        });
    }
};

const cancelMyRequest = async (req, res) => {
    const userId = safeUUID(req.user?.id);
    const requestId = safeInteger(req.params.id);

    try {
        const existing = await RefundRequest.findById(requestId);
        if (!existing || existing.userId !== userId) {
            return res.status(404).json({
                success: false,
                message: "Return request not found"
            });
        }

        const { request } = await transitionRma({
            requestId,
            toStatus: RMA_STATUS.CANCELLED,
            actorId: userId,
            adminNote: "Cancelled by customer"
        });

        return res.status(200).json({
            success: true,
            message: "Return request cancelled",
            data: enrichRequest(request)
        });
    } catch (error) {
        if (error instanceof RmaError) {
            return res.status(error.status).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }
        return res.status(500).json({
            success: false,
            message: "Failed to cancel return request"
        });
    }
};

// ==================== ADMIN ====================

const listAll = async (req, res) => {
    const status = req.query.status
        ? sanitizeString(req.query.status).toLowerCase()
        : null;

    if (status && !ALL_STATUSES.includes(status)) {
        return res.status(400).json({
            success: false,
            message: `Status must be one of: ${ALL_STATUSES.join(", ")}`
        });
    }

    try {
        const requests = await RefundRequest.list({ status });

        return res.status(200).json({
            success: true,
            message: "Return requests fetched",
            data: requests.map((request) => enrichRequest(request))
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

    try {
        const { request, fraud } = await transitionRma({
            requestId,
            toStatus: RMA_STATUS.APPROVED,
            actorId: adminId,
            adminNote,
            requireFraudCheck: true,
            restockOnApprove: true
        });

        return res.status(200).json({
            success: true,
            message: "Return request approved and inventory restocked",
            data: enrichRequest(request),
            fraud
        });
    } catch (error) {
        if (error instanceof RmaError) {
            return res.status(error.status).json({
                success: false,
                code: error.code,
                message: error.message,
                fraud: error.fraud || null
            });
        }
        console.error("APPROVE REFUND REQUEST ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to approve return request"
        });
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

    try {
        const { request } = await transitionRma({
            requestId,
            toStatus: RMA_STATUS.REJECTED,
            actorId: adminId,
            adminNote
        });

        return res.status(200).json({
            success: true,
            message: "Return request rejected",
            data: enrichRequest(request)
        });
    } catch (error) {
        if (error instanceof RmaError) {
            return res.status(error.status).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }
        console.error("REJECT REFUND REQUEST ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to reject return request"
        });
    }
};

const markReceived = async (req, res) => {
    const adminId = safeUUID(req.user?.id);
    const requestId = safeInteger(req.params.id);
    const adminNote = normalizeAdminNote(req.body.note);

    try {
        const { request } = await transitionRma({
            requestId,
            toStatus: RMA_STATUS.RECEIVED,
            actorId: adminId,
            adminNote
        });
        return res.status(200).json({
            success: true,
            message: "Return package marked received",
            data: enrichRequest(request)
        });
    } catch (error) {
        if (error instanceof RmaError) {
            return res.status(error.status).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }
        return res.status(500).json({
            success: false,
            message: "Failed to mark received"
        });
    }
};

const markRefunded = async (req, res) => {
    const adminId = safeUUID(req.user?.id);
    const requestId = safeInteger(req.params.id);
    const adminNote = normalizeAdminNote(req.body.note);

    try {
        const { request } = await transitionRma({
            requestId,
            toStatus: RMA_STATUS.REFUNDED,
            actorId: adminId,
            adminNote
        });
        return res.status(200).json({
            success: true,
            message: "Refund completed",
            data: enrichRequest(request)
        });
    } catch (error) {
        if (error instanceof RmaError) {
            return res.status(error.status).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }
        return res.status(500).json({
            success: false,
            message: "Failed to complete refund"
        });
    }
};

const getReasonCodes = (req, res) => {
    return res.status(200).json({
        success: true,
        data: REASON_CODES,
        policy: {
            returnWindowDays: POLICY.returnWindowDays,
            maxRequestsPerUser24h: POLICY.maxRequestsPerUser24h
        }
    });
};

module.exports = {
    createRequest,
    listMyRequests,
    getMyRequest,
    markInTransit,
    cancelMyRequest,
    listAll,
    approveRequest,
    rejectRequest,
    markReceived,
    markRefunded,
    getReasonCodes
};
