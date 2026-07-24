const db = require("../config/db");

const REFUND_REQUEST_COLUMNS = `
    id,
    user_id,
    order_id,
    order_item_id,
    product_id,
    reason,
    quantity,
    status,
    admin_note,
    reviewed_by,
    reviewed_at,
    created_at,
    updated_at
`;

// A request is "open" while it is still awaiting an outcome or has been
// approved but not yet closed out, so a second request for the same line
// should be blocked in either state.
const OPEN_STATUSES = ["pending", "approved"];

class RefundRequest {
    constructor(row) {
        this.id = row.id;
        this.userId = row.user_id ?? row.userId ?? null;
        this.orderId = row.order_id ?? row.orderId ?? null;
        this.orderItemId = row.order_item_id ?? row.orderItemId ?? null;
        this.productId = row.product_id ?? row.productId ?? null;
        this.reason = row.reason || "";
        this.quantity = row.quantity ?? 1;
        this.status = row.status || "pending";
        this.adminNote = row.admin_note ?? row.adminNote ?? null;
        this.reviewedBy = row.reviewed_by ?? row.reviewedBy ?? null;
        this.reviewedAt = row.reviewed_at ?? row.reviewedAt ?? null;
        this.createdAt = row.created_at ?? row.createdAt ?? null;
        this.updatedAt = row.updated_at ?? row.updatedAt ?? null;
    }

    toJSON() {
        return {
            id: this.id,
            user_id: this.userId,
            order_id: this.orderId,
            order_item_id: this.orderItemId,
            product_id: this.productId,
            reason: this.reason,
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
        { userId, orderId, orderItemId, productId, reason, quantity },
        connection = db
    ) {
        const [result] = await connection.query(
            `
                INSERT INTO refund_requests
                    (user_id, order_id, order_item_id, product_id, reason, quantity)
                VALUES (?, ?, ?, ?, ?, ?)
            `,
            [userId, orderId, orderItemId, productId, reason, quantity]
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
            query += " WHERE status = ?";
            params.push(status);
        }

        query += " ORDER BY created_at DESC, id DESC";

        const [rows] = await db.query(query, params);

        return rows.map((row) => new RefundRequest(row));
    }

    static async hasOpenRequestForItem(orderItemId, connection = db) {
        const [rows] = await connection.query(
            `
                SELECT id
                FROM refund_requests
                WHERE order_item_id = ?
                  AND status IN (?, ?)
                LIMIT 1
            `,
            [orderItemId, OPEN_STATUSES[0], OPEN_STATUSES[1]]
        );

        return rows.length > 0;
    }

    static async updateStatus(
        id,
        { status, adminNote = null, reviewedBy = null },
        connection = db
    ) {
        const [result] = await connection.query(
            `
                UPDATE refund_requests
                SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = NOW()
                WHERE id = ?
            `,
            [status, adminNote, reviewedBy, id]
        );

        return result.affectedRows > 0;
    }
}

module.exports = RefundRequest;
