// backend/repositories/orderRepository.js
const BaseRepository = require('./baseRepository');

// The states `orders.status` can actually hold
// (0001_baseline_schema.sql:287). Declared here so `findByStatus` can reject a
// value the column has no room for instead of returning an empty list: MySQL
// matches no rows when an ENUM is compared against something outside its set,
// which is how `getCompleted()` came to report "no completed orders" on a store
// full of delivered ones (#1568).
const ORDER_STATUSES = Object.freeze([
    'pending',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
    'on_hold'
]);

// The fulfilled terminal state. There is no 'completed' in this schema -- see
// also #769, which tracks the same vocabulary drift across other files.
const FULFILLED_STATUS = 'delivered';

// Orders that are over. Cancelling one of these is not a cancellation, it is
// an overwrite: it would move a delivered order into 'cancelled', or reset
// `cancelled_at` on an order already cancelled and lose when that happened.
const UNCANCELLABLE_STATUSES = Object.freeze(['delivered', 'cancelled', 'refunded']);

// States whose money is not revenue. `getStats` excluded only 'cancelled', so
// refunded orders were still counted in the total.
const NON_REVENUE_STATUSES = Object.freeze(['cancelled', 'refunded']);

// Orders a read is allowed to see. `orders.deleted_at` exists and nothing in
// this file consulted it, so soft-deleted orders were returned to customers and
// counted in revenue.
const LIVE = 'deleted_at IS NULL';

/** The same predicate, where the table carries an alias. */
const liveOn = (alias) => `${alias}.deleted_at IS NULL`;

/**
 * Refuse a status the column cannot hold.
 *
 * @param {any} status
 * @returns {string} the status, normalised
 */
const assertStatus = (status) => {
    const value = String(status ?? '').trim().toLowerCase();

    if (!ORDER_STATUSES.includes(value)) {
        throw new Error(
            `Unknown order status: ${JSON.stringify(status)}. `
            + `Expected one of ${ORDER_STATUSES.join(', ')}.`
        );
    }

    return value;
};

class OrderRepository extends BaseRepository {
    constructor() {
        super('orders', 'id', { softDeleteColumn: 'deleted_at' });
    }

    /**
     * Find orders by user
     */
    async findByUser(userId, options = {}) {
        const { limit = 20, offset = 0, status } = options;

        let query = `SELECT * FROM ${this.tableName} WHERE user_id = ? AND ${LIVE}`;
        const params = [userId];

        if (status) {
            query += ' AND status = ?';
            params.push(assertStatus(status));
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [rows] = await this.db.query(query, params);
        return rows;
    }

    /**
     * Get order with items
     */
    async findWithItems(id) {
        const order = await this.findById(id);
        if (!order || order.deleted_at) return null;

        const [items] = await this.db.query(
            `SELECT oi.*, p.name as product_name, p.price as product_price
             FROM order_items oi
             LEFT JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [id]
        );

        return {
            ...order,
            items
        };
    }

    /**
     * Get orders by status.
     *
     * The status is checked against the ENUM before it reaches SQL. Comparing
     * the column to a value outside its set matches nothing and raises nothing,
     * so an unknown status used to come back as a plausible empty list rather
     * than as the mistake it is.
     *
     * @param {string} status one of ORDER_STATUSES
     * @returns {Promise<object[]>}
     */
    async findByStatus(status) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName}
              WHERE status = ? AND ${LIVE}
              ORDER BY created_at DESC`,
            [assertStatus(status)]
        );

        return rows;
    }

    /**
     * Update order status
     */
    async updateStatus(id, status) {
        const [result] = await this.db.query(
            `UPDATE ${this.tableName}
                SET status = ?, updated_at = NOW()
              WHERE id = ? AND ${LIVE}`,
            [assertStatus(status), id]
        );

        this.cache.delete(id);
        return result.affectedRows > 0;
    }

    /**
     * Get order statistics.
     *
     * The aggregate is over `total`. There is no `orders.total_amount` column
     * and no migration adds one -- the name appears in
     * migrations/0047_gift_card_order_settlement.sql only inside a comment
     * describing what the table would need. So this statement threw
     * ER_BAD_FIELD_ERROR and never produced a figure, for a single customer or
     * for the store (#1568).
     *
     * Refunded orders are excluded alongside cancelled ones; their money is not
     * revenue. `payment_status` is deliberately not consulted, so these figures
     * are orders booked rather than cash collected -- a distinction worth
     * keeping explicit, since the two diverge for every unpaid COD order.
     *
     * @param {string|null} [userId] restrict to one customer
     * @returns {Promise<object|null>}
     */
    async getStats(userId = null) {
        const excluded = NON_REVENUE_STATUSES.map(() => '?').join(', ');

        let query = `
            SELECT
                COUNT(*)   as total_orders,
                SUM(total) as total_revenue,
                AVG(total) as avg_order_value,
                MIN(total) as min_order,
                MAX(total) as max_order
            FROM ${this.tableName}
            WHERE status NOT IN (${excluded})
              AND ${LIVE}
        `;
        const params = [...NON_REVENUE_STATUSES];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        const [rows] = await this.db.query(query, params);
        return rows[0] || null;
    }

    /**
     * Get recent orders
     */
    async getRecent(limit = 10) {
        const [rows] = await this.db.query(
            `SELECT o.*, u.name as user_name, u.email as user_email
             FROM ${this.tableName} o
             LEFT JOIN users u ON o.user_id = u.id
             WHERE ${liveOn('o')}
             ORDER BY o.created_at DESC
             LIMIT ?`,
            [limit]
        );

        return rows;
    }

    /**
     * Get orders by date range
     */
    async getByDateRange(startDate, endDate) {
        const [rows] = await this.db.query(
            `SELECT * FROM ${this.tableName}
             WHERE created_at BETWEEN ? AND ? AND ${LIVE}
             ORDER BY created_at DESC`,
            [startDate, endDate]
        );

        return rows;
    }

    /**
     * Cancel order.
     *
     * Guarded on the states an order can still be cancelled from. Without the
     * guard this moved a delivered order into 'cancelled' and reset
     * `cancelled_at` on one already cancelled -- and reported both as success,
     * because `affectedRows > 0` is true for an overwrite.
     *
     * @param {string} id
     * @param {string} reason
     * @returns {Promise<boolean>} whether the order was cancelled
     */
    async cancel(id, reason) {
        const blocked = UNCANCELLABLE_STATUSES.map(() => '?').join(', ');

        const [result] = await this.db.query(
            `UPDATE ${this.tableName}
             SET status = 'cancelled',
                 cancellation_reason = ?,
                 cancelled_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?
               AND status NOT IN (${blocked})
               AND ${LIVE}`,
            [reason, id, ...UNCANCELLABLE_STATUSES]
        );

        this.cache.delete(id);
        return result.affectedRows > 0;
    }

    /**
     * Get pending orders
     */
    async getPending() {
        return this.findByStatus('pending');
    }

    /**
     * Get processing orders
     */
    async getProcessing() {
        return this.findByStatus('processing');
    }

    /**
     * Get fulfilled orders.
     *
     * `'completed'` is not one of the seven states `orders.status` can hold, so
     * this returned an empty array on a store with any number of delivered
     * orders -- silently, which read as "none yet" rather than as a bug, and
     * which its two working siblings above made look plausible (#1568).
     */
    async getCompleted() {
        return this.findByStatus(FULFILLED_STATUS);
    }
}

const orderRepository = new OrderRepository();

// Exported off the instance so callers can name a status without restating the
// ENUM, which is how 'completed' got written in the first place.
orderRepository.ORDER_STATUSES = ORDER_STATUSES;
orderRepository.FULFILLED_STATUS = FULFILLED_STATUS;

module.exports = orderRepository;
