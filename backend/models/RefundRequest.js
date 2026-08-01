const db = require("../config/db");
const {
    OPEN_STATUSES,
    normalizeStatus,
    generateRmaNumber
} = require("../services/refundStateMachine");

const REFUND_REQUEST_COLUMNS = `
    id,
    rma_number,
    user_id,
    order_id,
    order_item_id,
    product_id,
    reason,
    reason_code,
    photo_evidence_url,
    shipping_tracking,
    address_fingerprint,
    payment_fingerprint,
    fraud_score,
    fraud_flags,
    quantity,
    status,
    admin_note,
    reviewed_by,
    reviewed_at,
    created_at,
    updated_at
`;

class RefundRequest {
    constructor(row) {
        this.id = row.id;
        this.rmaNumber = row.rma_number ?? row.rmaNumber ?? null;
        this.userId = row.user_id ?? row.userId ?? null;
        this.orderId = row.order_id ?? row.orderId ?? null;
        this.orderItemId = row.order_item_id ?? row.orderItemId ?? null;
        this.productId = row.product_id ?? row.productId ?? null;
        this.reason = row.reason || "";
        this.reasonCode = row.reason_code ?? row.reasonCode ?? null;
        this.photoEvidenceUrl =
            row.photo_evidence_url ?? row.photoEvidenceUrl ?? null;
        this.shippingTracking =
            row.shipping_tracking ?? row.shippingTracking ?? null;
        this.addressFingerprint =
            row.address_fingerprint ?? row.addressFingerprint ?? null;
        this.paymentFingerprint =
            row.payment_fingerprint ?? row.paymentFingerprint ?? null;
        this.fraudScore = row.fraud_score ?? row.fraudScore ?? null;
        this.fraudFlags = parseJson(row.fraud_flags ?? row.fraudFlags, []);
        this.quantity = row.quantity ?? 1;
        this.status = normalizeStatus(row.status || "requested");
        this.adminNote = row.admin_note ?? row.adminNote ?? null;
        this.reviewedBy = row.reviewed_by ?? row.reviewedBy ?? null;
        this.reviewedAt = row.reviewed_at ?? row.reviewedAt ?? null;
        this.createdAt = row.created_at ?? row.createdAt ?? null;
        this.updatedAt = row.updated_at ?? row.updatedAt ?? null;
    }

    toJSON() {
        return {
            id: this.id,
            rma_number: this.rmaNumber,
            user_id: this.userId,
            order_id: this.orderId,
            order_item_id: this.orderItemId,
            product_id: this.productId,
            reason: this.reason,
            reason_code: this.reasonCode,
            photo_evidence_url: this.photoEvidenceUrl,
            shipping_tracking: this.shippingTracking,
            address_fingerprint: this.addressFingerprint,
            payment_fingerprint: this.paymentFingerprint,
            fraud_score: this.fraudScore,
            fraud_flags: this.fraudFlags,
            quantity: this.quantity,
            status: this.status,
            admin_note: this.adminNote,
            reviewed_by: this.reviewedBy,
            reviewed_at: this.reviewedAt,
            created_at: this.createdAt,
            updated_at: this.updatedAt
        };
    }

    static async create(
        {
            userId,
            orderId,
            orderItemId,
            productId,
            reason,
            quantity,
            reasonCode = null,
            photoEvidenceUrl = null,
            addressFingerprint = null,
            paymentFingerprint = null,
            rmaNumber = null
        },
        connection = db
    ) {
        const rma = rmaNumber || generateRmaNumber();
        const [result] = await connection.query(
            `
                INSERT INTO refund_requests
                    (rma_number, user_id, order_id, order_item_id, product_id,
                     reason, reason_code, photo_evidence_url,
                     address_fingerprint, payment_fingerprint, quantity, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')
            `,
            [
                rma,
                userId,
                orderId,
                orderItemId,
                productId,
                reason,
                reasonCode,
                photoEvidenceUrl,
                addressFingerprint,
                paymentFingerprint,
                quantity
            ]
        );

        return result.insertId;
    }

    static async findById(id, { connection = db, forUpdate = false } = {}) {
        const [rows] = await connection.query(
            `
                SELECT ${REFUND_REQUEST_COLUMNS}
                FROM refund_requests
                WHERE id = ?
                LIMIT 1
                ${forUpdate ? "FOR UPDATE" : ""}
            `,
            [id]
        );

        return rows.length ? new RefundRequest(rows[0]) : null;
    }

    static async findByUser(userId) {
        const [rows] = await db.query(
            `
                SELECT ${REFUND_REQUEST_COLUMNS}
                FROM refund_requests
                WHERE user_id = ?
                ORDER BY created_at DESC, id DESC
            `,
            [userId]
        );

        return rows.map((row) => new RefundRequest(row));
    }

    static async list({ status } = {}) {
        let query = `SELECT ${REFUND_REQUEST_COLUMNS} FROM refund_requests`;
        const params = [];

        if (status) {
            const normalized = normalizeStatus(status);
            if (normalized === "requested") {
                query += " WHERE status IN ('requested', 'pending')";
            } else {
                query += " WHERE status = ?";
                params.push(normalized);
            }
        }

        query += " ORDER BY created_at DESC, id DESC";

        const [rows] = await db.query(query, params);

        return rows.map((row) => new RefundRequest(row));
    }

    static async hasOpenRequestForItem(orderItemId, connection = db) {
        const placeholders = OPEN_STATUSES.map(() => "?").join(", ");
        const [rows] = await connection.query(
            `
                SELECT id
                FROM refund_requests
                WHERE order_item_id = ?
                  AND status IN (${placeholders})
                LIMIT 1
            `,
            [orderItemId, ...OPEN_STATUSES]
        );

        return rows.length > 0;
    }

    static async updateStatus(
        id,
        {
            status,
            adminNote = undefined,
            reviewedBy = null,
            shippingTracking = undefined,
            fraudScore = undefined,
            fraudFlags = undefined
        },
        connection = db
    ) {
        const sets = ["status = ?"];
        const params = [normalizeStatus(status)];

        if (adminNote !== undefined) {
            sets.push("admin_note = ?");
            params.push(adminNote);
        }
        if (reviewedBy) {
            sets.push("reviewed_by = ?", "reviewed_at = NOW()");
            params.push(reviewedBy);
        }
        if (shippingTracking !== undefined) {
            sets.push("shipping_tracking = ?");
            params.push(shippingTracking);
        }
        if (fraudScore !== undefined) {
            sets.push("fraud_score = ?");
            params.push(fraudScore);
        }
        if (fraudFlags !== undefined) {
            sets.push("fraud_flags = ?");
            params.push(JSON.stringify(fraudFlags));
        }

        params.push(id);

        const [result] = await connection.query(
            `
                UPDATE refund_requests
                SET ${sets.join(", ")}
                WHERE id = ?
            `,
            params
        );

        return result.affectedRows > 0;
    }

    static async recordTransition(
        {
            rmaId,
            fromStatus,
            toStatus,
            actorId = null,
            note = null,
            meta = null
        },
        connection = db
    ) {
        try {
            await connection.query(
                `
                    INSERT INTO rma_transitions
                        (rma_id, from_status, to_status, actor_id, note, meta_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                `,
                [
                    rmaId,
                    fromStatus,
                    normalizeStatus(toStatus),
                    actorId,
                    note,
                    meta ? JSON.stringify(meta) : null
                ]
            );
        } catch (_) {
            /* table may not exist until migrate — transition still applied */
        }
    }

    static async countByUserSince(userId, sinceDate, connection = db) {
        const [rows] = await connection.query(
            `
                SELECT COUNT(*) AS cnt
                FROM refund_requests
                WHERE user_id = ?
                  AND created_at >= ?
            `,
            [userId, sinceDate]
        );
        return Number(rows[0]?.cnt) || 0;
    }

    static async countByFingerprint(field, value, sinceDate, connection = db) {
        if (!value) return 0;
        const column =
            field === "payment"
                ? "payment_fingerprint"
                : "address_fingerprint";
        const [rows] = await connection.query(
            `
                SELECT COUNT(*) AS cnt
                FROM refund_requests
                WHERE ${column} = ?
                  AND created_at >= ?
            `,
            [value, sinceDate]
        );
        return Number(rows[0]?.cnt) || 0;
    }

    static async countOpenForUser(userId, connection = db) {
        const placeholders = OPEN_STATUSES.map(() => "?").join(", ");
        const [rows] = await connection.query(
            `
                SELECT COUNT(*) AS cnt
                FROM refund_requests
                WHERE user_id = ?
                  AND status IN (${placeholders})
            `,
            [userId, ...OPEN_STATUSES]
        );
        return Number(rows[0]?.cnt) || 0;
    }

    static async countProductRefunds30d(
        userId,
        productId,
        connection = db
    ) {
        if (!productId) return 0;
        const [rows] = await connection.query(
            `
                SELECT COUNT(*) AS cnt
                FROM refund_requests
                WHERE user_id = ?
                  AND product_id = ?
                  AND status = 'refunded'
                  AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            `,
            [userId, productId]
        );
        return Number(rows[0]?.cnt) || 0;
    }
}

function parseJson(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

module.exports = RefundRequest;
