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

// The statuses whose quantity counts against the units bought on a line
// (#1477).
//
// A `pending` request has claimed those units while it is decided; `approved`
// and `refunded` have consumed them. `rejected` is the only outcome that gives
// them back, which is what makes re-submitting a refused return work.
//
// This replaced a two-member OPEN_STATUSES list used to answer "does this line
// have a request in flight". That boolean was doing the work of an arithmetic
// check: it locked the whole line after one partial return, and released the
// whole line as soon as a request left the pair -- so a rejected request made
// the full quantity returnable a second time and an approved one made the
// remainder returnable never.
const CLAIMED_STATUSES = ["pending", "approved", "refunded"];

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

    /**
     * How many units of an order line are already claimed by returns.
     *
     * The sum of `quantity` over that line's pending, approved and refunded
     * requests. Rejected ones are excluded: a refused return releases the units
     * it asked for, so the customer can submit again.
     *
     * Runs on the caller's connection when one is given, so the count can be
     * taken inside the submission's transaction and under the lock it holds on
     * the order line. Taken outside, two submissions arriving together both read
     * the same figure and both pass.
     *
     * @param {number} orderItemId
     * @param {object} [connection]
     * @returns {Promise<number>}
     */
    static async claimedQuantityForItem(orderItemId, connection = db) {
        const placeholders = CLAIMED_STATUSES.map(() => "?").join(", ");

        const [rows] = await connection.query(
            `
                SELECT COALESCE(SUM(quantity), 0) AS claimed
                FROM refund_requests
                WHERE order_item_id = ?
                  AND status IN (${placeholders})
            `,
            [orderItemId, ...CLAIMED_STATUSES]
        );

        return Number(rows[0]?.claimed) || 0;
    }

    /**
     * The same figure for every line of an order, as a Map keyed by
     * `order_item_id`.
     *
     * One query rather than one per line: the returnable view over an order
     * needs all of them, and a loop over `claimedQuantityForItem` is a query per
     * item for a page a customer is waiting on.
     *
     * @param {string} orderId
     * @param {object} [connection]
     * @returns {Promise<Map<number, number>>}
     */
    static async claimedQuantitiesForOrder(orderId, connection = db) {
        const placeholders = CLAIMED_STATUSES.map(() => "?").join(", ");

        const [rows] = await connection.query(
            `
                SELECT order_item_id, COALESCE(SUM(quantity), 0) AS claimed
                FROM refund_requests
                WHERE order_id = ?
                  AND status IN (${placeholders})
                GROUP BY order_item_id
            `,
            [orderId, ...CLAIMED_STATUSES]
        );

        const claimed = new Map();

        for (const row of rows) {
            claimed.set(Number(row.order_item_id), Number(row.claimed) || 0);
        }

        return claimed;
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

RefundRequest.CLAIMED_STATUSES = CLAIMED_STATUSES;

module.exports = RefundRequest;
