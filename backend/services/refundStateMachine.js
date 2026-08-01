/**
 * Return/Refund RMA state machine with policy + fraud guards (#1389).
 *
 * Canonical flow:
 *   requested → approved → in_transit → received → refunded
 * Side exits: requested → rejected | cancelled
 *
 * Legacy status `pending` is treated as an alias of `requested`.
 */

"use strict";

const crypto = require("crypto");

const RMA_STATUS = Object.freeze({
    REQUESTED: "requested",
    APPROVED: "approved",
    IN_TRANSIT: "in_transit",
    RECEIVED: "received",
    REFUNDED: "refunded",
    REJECTED: "rejected",
    CANCELLED: "cancelled"
});

/** @type {Record<string, string[]>} */
const TRANSITIONS = Object.freeze({
    requested: ["approved", "rejected", "cancelled"],
    pending: ["approved", "rejected", "cancelled"], // legacy alias
    approved: ["in_transit", "rejected"],
    in_transit: ["received", "cancelled"],
    received: ["refunded", "rejected"],
    refunded: [],
    rejected: [],
    cancelled: []
});

const REASON_CODES = Object.freeze({
    DEFECTIVE: "defective",
    WRONG_ITEM: "wrong_item",
    NOT_AS_DESCRIBED: "not_as_described",
    SIZE_FIT: "size_fit",
    CHANGED_MIND: "changed_mind",
    DAMAGED_IN_SHIPPING: "damaged_in_shipping",
    OTHER: "other"
});

const POLICY = Object.freeze({
    returnWindowDays: Math.max(
        1,
        parseInt(process.env.RMA_RETURN_WINDOW_DAYS, 10) || 30
    ),
    eligibleOrderStatus: "delivered",
    minReasonLength: 5,
    maxReasonLength: 1000,
    /** Velocity limits (wardrobing / multi-claim guards) */
    maxRequestsPerUser24h: Math.max(
        1,
        parseInt(process.env.RMA_MAX_PER_USER_24H, 10) || 3
    ),
    maxRequestsPerAddress7d: Math.max(
        1,
        parseInt(process.env.RMA_MAX_PER_ADDRESS_7D, 10) || 5
    ),
    maxRequestsPerPayment7d: Math.max(
        1,
        parseInt(process.env.RMA_MAX_PER_PAYMENT_7D, 10) || 5
    ),
    /** Soft score threshold — approve blocked at or above */
    fraudBlockScore: Math.max(
        1,
        parseInt(process.env.RMA_FRAUD_BLOCK_SCORE, 10) || 80
    )
});

const OPEN_STATUSES = Object.freeze([
    RMA_STATUS.REQUESTED,
    "pending",
    RMA_STATUS.APPROVED,
    RMA_STATUS.IN_TRANSIT,
    RMA_STATUS.RECEIVED
]);

class RmaError extends Error {
    constructor(message, { status = 400, code = "RMA_ERROR" } = {}) {
        super(message);
        this.name = "RmaError";
        this.status = status;
        this.code = code;
    }
}

function normalizeStatus(status) {
    const s = String(status || "")
        .trim()
        .toLowerCase();
    if (s === "pending") return RMA_STATUS.REQUESTED;
    return s;
}

function canTransition(fromStatus, toStatus) {
    const from = normalizeStatus(fromStatus);
    const to = normalizeStatus(toStatus);
    const allowed = TRANSITIONS[from] || TRANSITIONS[fromStatus] || [];
    return allowed.includes(to);
}

function assertTransition(fromStatus, toStatus) {
    if (!canTransition(fromStatus, toStatus)) {
        throw new RmaError(
            `Invalid RMA transition: ${normalizeStatus(fromStatus)} → ${normalizeStatus(toStatus)}`,
            { status: 409, code: "RMA_INVALID_TRANSITION" }
        );
    }
    return true;
}

function isTerminal(status) {
    const s = normalizeStatus(status);
    return (
        s === RMA_STATUS.REFUNDED ||
        s === RMA_STATUS.REJECTED ||
        s === RMA_STATUS.CANCELLED
    );
}

function isValidReasonCode(code) {
    if (!code) return false;
    return Object.values(REASON_CODES).includes(String(code).toLowerCase());
}

/**
 * Policy window: from delivered_at (preferred) or created_at.
 */
function isReturnWindowExpired(order, now = Date.now()) {
    const reference = order?.delivered_at || order?.created_at;
    if (!reference) return false;
    const t = new Date(reference).getTime();
    if (Number.isNaN(t)) return false;
    const ageDays = (now - t) / (1000 * 60 * 60 * 24);
    return ageDays > POLICY.returnWindowDays;
}

function assertPolicyWindow(order) {
    if (!order) {
        throw new RmaError("Order not found", {
            status: 404,
            code: "RMA_ORDER_NOT_FOUND"
        });
    }
    const status = String(order.status || "").toLowerCase();
    if (status !== POLICY.eligibleOrderStatus) {
        throw new RmaError("Only delivered orders are eligible for a return", {
            status: 400,
            code: "RMA_ORDER_NOT_ELIGIBLE"
        });
    }
    if (isReturnWindowExpired(order)) {
        throw new RmaError(
            `The ${POLICY.returnWindowDays}-day return window for this order has closed`,
            { status: 400, code: "RMA_POLICY_WINDOW_CLOSED" }
        );
    }
}

function fingerprint(value) {
    if (!value) return null;
    return crypto
        .createHash("sha256")
        .update(String(value).trim().toLowerCase())
        .digest("hex")
        .slice(0, 32);
}

function addressFingerprint(address = {}) {
    const parts = [
        address.fullAddress || address.full_address || "",
        address.city || "",
        address.state || "",
        address.zip || address.postal || ""
    ];
    const joined = parts.join("|").trim();
    return joined ? fingerprint(joined) : null;
}

/**
 * Velocity / wardrobing score before approve.
 * @returns {{ ok: boolean, score: number, flags: string[], blocked: boolean }}
 */
function evaluateFraudVelocity({
    userRequestCount24h = 0,
    addressRequestCount7d = 0,
    paymentRequestCount7d = 0,
    openRequestsForUser = 0,
    priorRefundsSameProduct30d = 0
} = {}) {
    const flags = [];
    let score = 0;

    if (userRequestCount24h >= POLICY.maxRequestsPerUser24h) {
        flags.push("user_velocity_24h");
        score += 40;
    } else if (userRequestCount24h >= POLICY.maxRequestsPerUser24h - 1) {
        flags.push("user_velocity_elevated");
        score += 15;
    }

    if (addressRequestCount7d >= POLICY.maxRequestsPerAddress7d) {
        flags.push("address_velocity_7d");
        score += 35;
    }

    if (paymentRequestCount7d >= POLICY.maxRequestsPerPayment7d) {
        flags.push("payment_velocity_7d");
        score += 35;
    }

    if (openRequestsForUser >= 3) {
        flags.push("multiple_open_rmas");
        score += 20;
    }

    if (priorRefundsSameProduct30d >= 2) {
        flags.push("repeat_product_refund");
        score += 25;
    }

    const blocked = score >= POLICY.fraudBlockScore;
    return {
        ok: !blocked,
        blocked,
        score,
        flags,
        thresholds: {
            maxRequestsPerUser24h: POLICY.maxRequestsPerUser24h,
            maxRequestsPerAddress7d: POLICY.maxRequestsPerAddress7d,
            maxRequestsPerPayment7d: POLICY.maxRequestsPerPayment7d,
            fraudBlockScore: POLICY.fraudBlockScore
        }
    };
}

function generateRmaNumber() {
    const stamp = Date.now().toString(36).toUpperCase();
    const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
    return `RMA-${stamp}-${rand}`;
}

/** Customer-facing progress steps for tracking UI */
function trackingTimeline(currentStatus) {
    const pipeline = [
        RMA_STATUS.REQUESTED,
        RMA_STATUS.APPROVED,
        RMA_STATUS.IN_TRANSIT,
        RMA_STATUS.RECEIVED,
        RMA_STATUS.REFUNDED
    ];
    const current = normalizeStatus(currentStatus);

    if (current === RMA_STATUS.REJECTED || current === RMA_STATUS.CANCELLED) {
        return {
            current,
            terminal: true,
            steps: pipeline.map((s) => ({
                status: s,
                label: labelForStatus(s),
                state: "skipped"
            })),
            outcome: current
        };
    }

    const idx = pipeline.indexOf(current);
    return {
        current,
        terminal: current === RMA_STATUS.REFUNDED,
        steps: pipeline.map((s, i) => ({
            status: s,
            label: labelForStatus(s),
            state:
                idx < 0
                    ? "pending"
                    : i < idx
                      ? "done"
                      : i === idx
                        ? "current"
                        : "pending"
        })),
        outcome: null
    };
}

function labelForStatus(status) {
    const map = {
        requested: "Requested",
        pending: "Requested",
        approved: "Approved",
        in_transit: "In transit",
        received: "Received",
        refunded: "Refunded",
        rejected: "Rejected",
        cancelled: "Cancelled"
    };
    return map[normalizeStatus(status)] || status;
}

module.exports = {
    RMA_STATUS,
    TRANSITIONS,
    REASON_CODES,
    POLICY,
    OPEN_STATUSES,
    RmaError,
    normalizeStatus,
    canTransition,
    assertTransition,
    isTerminal,
    isValidReasonCode,
    isReturnWindowExpired,
    assertPolicyWindow,
    fingerprint,
    addressFingerprint,
    evaluateFraudVelocity,
    generateRmaNumber,
    trackingTimeline,
    labelForStatus
};
