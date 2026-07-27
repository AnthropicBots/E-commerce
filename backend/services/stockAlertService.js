// backend/services/stockAlertService.js
//
// Back-in-stock & price-drop alerts for wishlist/products (#1233).
//
// Subscription management (PR 1/3) + the evaluation engine (PR 2/3). A user
// subscribes a product for either a `back_in_stock` or a `price_drop` alert;
// the evaluation functions scan active subscriptions, dispatch matching ones
// through the notification broker, and flip the row to `notified` so a single
// restock/price drop only fires once (dedupe until the user re-subscribes).

const db = require("../config/db");
const {
    notificationBroker,
    NOTIFICATION_TYPES
} = require("./notificationBrokerService");

const ALERT_TYPES = {
    BACK_IN_STOCK: "back_in_stock",
    PRICE_DROP: "price_drop"
};

const SUBSCRIPTION_STATUS = {
    ACTIVE: "active",
    NOTIFIED: "notified",
    CANCELLED: "cancelled"
};

// Both channels are always requested; the broker no-ops any channel that has
// no registered handler, so this stays valid regardless of deployment config.
const ALERT_CHANNELS = ["in_app", "email"];

// A new subscription (or re-subscribing after being notified/cancelled) always
// resets to `active` with a cleared notification marker so the next matching
// scan can fire again. reference_price is only meaningful for price-drop
// alerts but is stored uniformly.
async function subscribe({ userId, productId, alertType, referencePrice = null }) {
    if (!userId || !productId) {
        throw new Error("subscribe requires userId and productId");
    }
    if (!Object.values(ALERT_TYPES).includes(alertType)) {
        throw new Error(`Unsupported alertType: ${alertType}`);
    }

    const [result] = await db.query(
        `INSERT INTO stock_alert_subscriptions
             (user_id, product_id, alert_type, reference_price, status, last_notified_at)
         VALUES (?, ?, ?, ?, 'active', NULL)
         ON DUPLICATE KEY UPDATE
             reference_price = VALUES(reference_price),
             status = 'active',
             last_notified_at = NULL`,
        [userId, productId, alertType, referencePrice]
    );

    return {
        userId,
        productId,
        alertType,
        referencePrice,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        insertId: result.insertId
    };
}

// Soft cancel: keep the row for audit/history and to preserve the unique key,
// just flip it out of the active set so scans skip it.
async function unsubscribe({ userId, productId, alertType }) {
    if (!userId || !productId) {
        throw new Error("unsubscribe requires userId and productId");
    }
    if (!Object.values(ALERT_TYPES).includes(alertType)) {
        throw new Error(`Unsupported alertType: ${alertType}`);
    }

    const [result] = await db.query(
        `UPDATE stock_alert_subscriptions
            SET status = 'cancelled'
          WHERE user_id = ? AND product_id = ? AND alert_type = ?
            AND status <> 'cancelled'`,
        [userId, productId, alertType]
    );

    return { cancelled: result.affectedRows > 0 };
}

async function listSubscriptions(userId, { alertType, status } = {}) {
    if (!userId) {
        throw new Error("listSubscriptions requires userId");
    }

    let sql = "SELECT * FROM stock_alert_subscriptions WHERE user_id = ?";
    const params = [userId];

    if (alertType) {
        sql += " AND alert_type = ?";
        params.push(alertType);
    }
    if (status) {
        sql += " AND status = ?";
        params.push(status);
    }

    sql += " ORDER BY created_at DESC";

    const [rows] = await db.query(sql, params);
    return rows;
}

// Publish one alert and mark its subscription notified. Marking only happens
// after a successful publish so a broker failure leaves the row active for the
// next scan to retry.
async function _dispatchAndMark(subscription, notificationType, extraData) {
    await notificationBroker.publish(
        notificationType,
        {
            userId: subscription.user_id,
            productId: subscription.product_id,
            subscriptionId: subscription.id,
            ...extraData
        },
        { channels: ALERT_CHANNELS }
    );

    await db.query(
        `UPDATE stock_alert_subscriptions
            SET status = 'notified', last_notified_at = NOW()
          WHERE id = ?`,
        [subscription.id]
    );
}

// Fire a PRODUCT_BACK_IN_STOCK alert for every active back-in-stock
// subscription whose product now has stock. Returns the number dispatched.
async function evaluateRestocks() {
    const [rows] = await db.query(
        `SELECT s.id, s.user_id, s.product_id, p.stock, p.name
           FROM stock_alert_subscriptions s
           JOIN products p ON p.id = s.product_id
          WHERE s.alert_type = 'back_in_stock'
            AND s.status = 'active'
            AND p.stock > 0`
    );

    let dispatched = 0;
    for (const row of rows) {
        try {
            await _dispatchAndMark(row, NOTIFICATION_TYPES.PRODUCT_BACK_IN_STOCK, {
                stock: row.stock,
                productName: row.name
            });
            dispatched++;
        } catch (error) {
            console.error(
                `evaluateRestocks: failed to notify subscription ${row.id}:`,
                error.message
            );
        }
    }

    return dispatched;
}

// Fire a WISHLIST_PRICE_DROP alert for every active price-drop subscription
// whose product price has fallen below the price captured at subscribe time.
// Returns the number dispatched.
async function evaluatePriceDrops() {
    const [rows] = await db.query(
        `SELECT s.id, s.user_id, s.product_id, s.reference_price, p.price, p.name
           FROM stock_alert_subscriptions s
           JOIN products p ON p.id = s.product_id
          WHERE s.alert_type = 'price_drop'
            AND s.status = 'active'
            AND s.reference_price IS NOT NULL
            AND p.price < s.reference_price`
    );

    let dispatched = 0;
    for (const row of rows) {
        try {
            await _dispatchAndMark(row, NOTIFICATION_TYPES.WISHLIST_PRICE_DROP, {
                oldPrice: row.reference_price,
                newPrice: row.price,
                productName: row.name
            });
            dispatched++;
        } catch (error) {
            console.error(
                `evaluatePriceDrops: failed to notify subscription ${row.id}:`,
                error.message
            );
        }
    }

    return dispatched;
}

module.exports = {
    ALERT_TYPES,
    SUBSCRIPTION_STATUS,
    subscribe,
    unsubscribe,
    listSubscriptions,
    evaluateRestocks,
    evaluatePriceDrops
};
