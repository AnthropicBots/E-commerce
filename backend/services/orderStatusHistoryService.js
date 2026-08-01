// backend/services/orderStatusHistoryService.js
//
// Order status history (#1351).
//
// An order's status was a single mutable field. Going
// pending -> processing -> shipped -> delivered overwrote three of the four
// states, so "when did this ship?" and "who cancelled this?" were both
// unanswerable, and admin status changes -- one of the highest-privilege
// mutations in the system -- were the least logged.
//
// `order_status_logs` is created by migration 0022 and amended by 0027. It had
// no writer other than two bare INSERTs in `order.service.js` and no reader at
// all. This is the service that makes it real.
//
// The stored column names are 0022's -- `old_status`, `new_status`,
// `updated_by`, `updated_by_name` -- because 0022's trigger, views and stored
// procedures read them. This service uses the from/to/changedBy spelling
// internally and maps at the query boundary.
//
// The single most important property: `recordTransition` takes the caller's
// connection and writes inside the caller's transaction. A history that can be
// missing rows because a second, separate write failed is not a history, and a
// history written *before* a rolled-back status change is worse than none.

const db = require('../config/db');
const { safeArray, sanitizeString } = require('../utils/helpers');

/**
 * Where a status change came from.
 *
 * Not derivable from `changed_by`: the admin and customer paths both populate
 * it, and "did the customer cancel this or did we?" is the first question
 * support asks.
 */
const SOURCES = Object.freeze(['admin', 'customer', 'courier', 'system', 'payment']);

/**
 * Status -> timestamp column on `orders`.
 *
 * These columns have been in the schema from the start and only `cancelled_at`
 * was ever written, and only on the refund path -- so an order marked
 * `delivered` kept a NULL `delivered_at` forever and no fulfilment-time
 * reporting was possible.
 */
const STATUS_TIMESTAMPS = Object.freeze({
    shipped: 'shipped_at',
    delivered: 'delivered_at',
    cancelled: 'cancelled_at',
    refunded: 'refunded_at'
});

/**
 * Customer-facing wording.
 *
 * The stored value is the machine status; this is what a shopper reads. Kept
 * server-side so the order page, order-confirmation email and admin view
 * cannot describe the same transition three different ways.
 */
const CUSTOMER_LABELS = Object.freeze({
    pending: {
        title: 'Order placed',
        description: 'We have your order and are getting it ready.'
    },
    processing: {
        title: 'Preparing your order',
        description: 'Your items are being picked and packed.'
    },
    shipped: {
        title: 'Shipped',
        description: 'Your order is on its way.'
    },
    out_for_delivery: {
        title: 'Out for delivery',
        description: 'Your order is with the courier for delivery today.'
    },
    delivered: {
        title: 'Delivered',
        description: 'Your order has been delivered.'
    },
    cancelled: {
        title: 'Cancelled',
        description: 'This order was cancelled.'
    },
    refunded: {
        title: 'Refunded',
        description: 'Your refund has been issued.'
    },
    on_hold: {
        title: 'On hold',
        description: 'We have paused this order. Support will be in touch.'
    }
});

/**
 * The happy path, in order, for rendering a progress tracker.
 *
 * Cancelled and refunded are deliberately absent: they are not steps toward
 * delivery, and putting them on the same line would suggest a cancelled order
 * is partway to arriving.
 */
const PROGRESS_STEPS = Object.freeze([
    'pending',
    'processing',
    'shipped',
    'out_for_delivery',
    'delivered'
]);

class OrderStatusHistoryService {
    /**
     * Record a status transition.
     *
     * MUST be called with the connection that is performing the status change,
     * inside its transaction. Passing the pool instead would let the history
     * and the status disagree the moment either write fails.
     *
     * The status column itself is *not* written here -- callers own that, and
     * having two places write it is how they drift.
     *
     * @param {object} connection the caller's transaction
     * @param {object} entry
     * @param {string} entry.orderId
     * @param {string|null} entry.fromStatus null for the first entry
     * @param {string} entry.toStatus
     * @param {string} [entry.source] one of SOURCES
     * @param {string|null} [entry.changedBy] user id, null for automated changes
     * @param {string|null} [entry.changedByName]
     * @param {string} [entry.reason]
     * @param {object} [entry.metadata]
     * @param {object} [entry.request] express req, for ip/user-agent
     * @returns {Promise<{recorded: boolean, skipped?: string}>}
     */
    async recordTransition(connection, entry = {}) {
        const {
            orderId,
            fromStatus = null,
            toStatus,
            source = 'system',
            changedBy = null,
            changedByName = null,
            reason = null,
            metadata = null,
            request = null
        } = entry;

        if (!orderId || !toStatus) {
            // A history write must never be the thing that fails a status
            // change, so a malformed entry is reported rather than thrown.
            console.error('recordTransition called without orderId or toStatus');
            return { recorded: false, skipped: 'missing_fields' };
        }

        // A no-op transition is not history, it is noise -- and a timeline full
        // of "shipped -> shipped" makes the real transitions hard to find.
        // Recording it would also make a genuine duplicate-write bug in a
        // courier integration harder to spot, not easier.
        if (fromStatus && fromStatus === toStatus) {
            return { recorded: false, skipped: 'no_change' };
        }

        const safeSource = SOURCES.includes(source) ? source : 'system';

        // Column names are migration 0022's -- `old_status`/`new_status`/
        // `updated_by` rather than the from/to/changed_by spelling this service
        // uses internally. 0022 owns the table, and its trigger, views and
        // stored procedures all read those names. See 0027 for the reconciliation.
        //
        // `is_auto` is 0022's boolean for "nobody did this". `source` supersedes
        // it, but it is still written so 0022's `get_order_timeline` procedure
        // does not silently report every row as manual.
        await connection.query(
            `INSERT INTO order_status_logs (
                order_id, old_status, new_status,
                updated_by, updated_by_name, source, is_auto,
                reason, metadata, ip_address, user_agent
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orderId,
                fromStatus,
                toStatus,
                changedBy,
                changedByName ? sanitizeString(changedByName).slice(0, 255) : null,
                safeSource,
                changedBy ? 0 : 1,
                reason ? sanitizeString(reason).slice(0, 500) : null,
                metadata ? JSON.stringify(metadata) : null,
                this.extractIp(request),
                this.extractUserAgent(request)
            ]
        );

        await this.stampStatusTimestamp(connection, orderId, toStatus);

        return { recorded: true };
    }

    /**
     * Set the `orders` timestamp column that corresponds to a status.
     *
     * COALESCE so a re-entry into a status does not move the original
     * timestamp: the first time an order shipped is the interesting one, and
     * an order that bounced back to `processing` and shipped again should not
     * report the second date as its ship date.
     */
    async stampStatusTimestamp(connection, orderId, status) {
        const column = STATUS_TIMESTAMPS[status];
        if (!column) return false;

        await connection.query(
            `UPDATE orders SET ${column} = COALESCE(${column}, NOW()) WHERE id = ?`,
            [orderId]
        );

        return true;
    }

    /**
     * The full history for an order, oldest first.
     *
     * @param {string} orderId
     * @param {{includeInternal?: boolean}} [options] admins see the actor and
     *        the request metadata; customers do not.
     */
    async getHistory(orderId, options = {}) {
        const { includeInternal = false } = options;

        // Aliased to this service's spelling so the row shape below is stable;
        // the stored names are 0022's. See the note in recordTransition.
        const [rows] = await db.query(
            `SELECT
                l.id, l.order_id,
                l.old_status AS from_status, l.new_status AS to_status,
                l.updated_by AS changed_by, l.updated_by_name AS changed_by_name,
                l.source,
                l.reason, l.metadata, l.ip_address, l.user_agent, l.created_at,
                u.name AS actor_name
             FROM order_status_logs l
             LEFT JOIN users u ON u.id = l.updated_by
             WHERE l.order_id = ?
             ORDER BY l.created_at ASC, l.id ASC`,
            [orderId]
        );

        return safeArray(rows).map((row) => this.toTimelineEntry(row, includeInternal));
    }

    /**
     * Shape a log row for the API.
     *
     * `ip_address`, `user_agent` and the actor's identity are omitted unless
     * the caller is an admin. A customer has no business knowing which staff
     * account touched their order, and the IP is support data, not customer
     * data.
     */
    toTimelineEntry(row, includeInternal = false) {
        const label = CUSTOMER_LABELS[row.to_status] || {
            title: row.to_status,
            description: ''
        };

        let metadata = null;
        try {
            metadata =
                typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        } catch (error) {
            metadata = null;
        }

        const entry = {
            id: row.id,
            fromStatus: row.from_status,
            status: row.to_status,
            title: label.title,
            description: label.description,
            source: row.source,
            at: row.created_at,
            // A customer sees why *they* cancelled; an internal note about a
            // fraud hold is not for them.
            reason:
                includeInternal || row.source === 'customer' ? row.reason || null : null
        };

        if (includeInternal) {
            entry.changedBy = row.changed_by || null;
            entry.changedByName = row.actor_name || row.changed_by_name || null;
            entry.metadata = metadata;
            entry.ipAddress = row.ip_address || null;
            entry.userAgent = row.user_agent || null;
        }

        return entry;
    }

    /**
     * A timeline ready to render: the history plus the progress ladder.
     *
     * The ladder is derived rather than stored, so it stays correct if an order
     * skips a step -- which happens whenever a courier reports `delivered`
     * without an intervening `out_for_delivery` event.
     */
    async getTimeline(order, options = {}) {
        const history = await this.getHistory(order.id, options);

        const reached = new Set(history.map((entry) => entry.status));
        const isTerminal = order.status === 'cancelled' || order.status === 'refunded';
        const currentIndex = PROGRESS_STEPS.indexOf(order.status);

        const steps = PROGRESS_STEPS.map((status, index) => {
            const entry = history.find((h) => h.status === status);

            return {
                status,
                title: CUSTOMER_LABELS[status].title,
                description: CUSTOMER_LABELS[status].description,
                // A step counts as complete if it was recorded *or* if a later
                // step was: an order that jumped straight to `delivered` did in
                // fact ship, whatever the log says.
                complete:
                    !isTerminal && (reached.has(status) || (currentIndex > -1 && index < currentIndex)),
                current: !isTerminal && status === order.status,
                at: entry ? entry.at : null
            };
        });

        return {
            orderId: order.id,
            currentStatus: order.status,
            isCancelled: isTerminal,
            steps: isTerminal ? [] : steps,
            history
        };
    }

    /**
     * The most recent transition into a given status.
     *
     * Used to answer "when did this ship" without walking the whole history.
     */
    async getLastTransitionTo(orderId, status) {
        const [rows] = await db.query(
            `SELECT created_at
               FROM order_status_logs
              WHERE order_id = ? AND new_status = ?
              ORDER BY created_at DESC
              LIMIT 1`,
            [orderId, status]
        );

        return safeArray(rows)[0]?.created_at || null;
    }

    /**
     * Fulfilment timings across a date range, for admin reporting.
     *
     * This is the reason the timestamp columns were in the schema in the first
     * place, and it has never been answerable.
     */
    async getFulfilmentStats({ from, to } = {}) {
        const [rows] = await db.query(
            `SELECT
                COUNT(*) AS total,
                AVG(TIMESTAMPDIFF(HOUR, o.created_at, o.shipped_at)) AS avg_hours_to_ship,
                AVG(TIMESTAMPDIFF(HOUR, o.shipped_at, o.delivered_at)) AS avg_hours_to_deliver,
                SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
             FROM orders o
             WHERE o.created_at BETWEEN ? AND ?`,
            [from || '1970-01-01', to || new Date()]
        );

        const row = safeArray(rows)[0] || {};

        // Nulls all the way out rather than zeros: "no orders shipped in this
        // window" and "orders shipped instantly" are different answers, and
        // rounding the first to 0 reports the second.
        return {
            total: Number(row.total) || 0,
            cancelled: Number(row.cancelled) || 0,
            avgHoursToShip:
                row.avg_hours_to_ship === null ? null : Number(row.avg_hours_to_ship),
            avgHoursToDeliver:
                row.avg_hours_to_deliver === null ? null : Number(row.avg_hours_to_deliver)
        };
    }

    // ----------------------------------------------------------------
    // Request helpers
    // ----------------------------------------------------------------

    /**
     * Client IP, honouring a proxy header when one is present.
     *
     * X-Forwarded-For is a comma-separated chain; the first entry is the
     * original client. Truncated to the column width because the header is
     * attacker-controlled and an oversized value would otherwise fail the
     * INSERT -- and thus the whole status change.
     */
    extractIp(request) {
        if (!request) return null;

        const forwarded = request.headers?.['x-forwarded-for'];
        const ip = forwarded
            ? String(forwarded).split(',')[0].trim()
            : request.ip || request.connection?.remoteAddress;

        return ip ? String(ip).slice(0, 45) : null;
    }

    extractUserAgent(request) {
        if (!request) return null;

        const agent = request.headers?.['user-agent'];
        return agent ? String(agent).slice(0, 1000) : null;
    }
}

const orderStatusHistoryService = new OrderStatusHistoryService();

module.exports = orderStatusHistoryService;
module.exports.OrderStatusHistoryService = OrderStatusHistoryService;
module.exports.SOURCES = SOURCES;
module.exports.STATUS_TIMESTAMPS = STATUS_TIMESTAMPS;
module.exports.CUSTOMER_LABELS = CUSTOMER_LABELS;
module.exports.PROGRESS_STEPS = PROGRESS_STEPS;
