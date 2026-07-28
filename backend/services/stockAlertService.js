// backend/services/stockAlertService.js
// Subscription management + evaluation engine for back-in-stock and
// price-drop alerts (#1233). The subscribe/unsubscribe/list surface owns the
// `stock_alert_subscriptions` table; the evaluation functions scan active
// subscriptions, dispatch matching ones through the notification broker, and
// flip the row to 'notified' so a single restock/price drop fires only once
// (dedupe until the user re-subscribes). The API routes and the periodic
// scheduler consume this module.
const db = require("../config/db");
const {
    notificationBroker,
    NOTIFICATION_TYPES,
} = require("./notificationBrokerService");

const ALERT_TYPES = {
    BACK_IN_STOCK: "back_in_stock",
    PRICE_DROP: "price_drop",
};

const SUBSCRIPTION_STATUS = {
    ACTIVE: "active",
    NOTIFIED: "notified",
    CANCELLED: "cancelled",
};

// Both channels are always requested; the broker no-ops any channel that has
// no registered handler, so this stays valid regardless of deployment config.
const ALERT_CHANNELS = ["in_app", "email"];

const VALID_ALERT_TYPES = Object.values(ALERT_TYPES);

// Both back-in-stock and price-drop alerts are worth surfacing in the app and
// over email, so every dispatch fans out to the same two channels.
const ALERT_CHANNELS = ["in_app", "email"];

function assertAlertType(alertType) {
    if (!VALID_ALERT_TYPES.includes(alertType)) {
        throw new Error(
            `Invalid alertType: ${alertType}. Expected one of ${VALID_ALERT_TYPES.join(", ")}`
        );
    }
}

async function fetchCurrentPrice(productId) {
    const [rows] = await db.query(
        "SELECT price FROM products WHERE id = ?",
        [productId]
    );
    if (!rows || rows.length === 0) {
        throw new Error(`Product not found: ${productId}`);
    }
    return rows[0].price;
}

async function fetchSubscription(userId, productId, alertType) {
    const [rows] = await db.query(
        `SELECT * FROM stock_alert_subscriptions
         WHERE user_id = ? AND product_id = ? AND alert_type = ?`,
        [userId, productId, alertType]
    );
    return rows && rows.length > 0 ? rows[0] : null;
}

// Publish one alert and mark its subscription notified. Marking only happens
// after a successful publish so a broker failure leaves the row active for the
// next scan to retry.
async function dispatchAndMark(subscription, notificationType, extraData) {
    await notificationBroker.publish(
        notificationType,
        {
            userId: subscription.user_id,
            productId: subscription.product_id,
            subscriptionId: subscription.id,
            ...extraData,
        },
        { channels: ALERT_CHANNELS }
    );

    await db.query(
        `UPDATE stock_alert_subscriptions
            SET status = ?, last_notified_at = NOW()
          WHERE id = ?`,
        [SUBSCRIPTION_STATUS.NOTIFIED, subscription.id]
    );
}

const stockAlertService = {
    ALERT_TYPES,
    SUBSCRIPTION_STATUS,

    // Create (or reactivate) a subscription. The UNIQUE key on
    // (user_id, product_id, alert_type) makes this idempotent: a repeat call
    // for the same triple reactivates the existing row instead of inserting a
    // duplicate, resetting status to 'active' and clearing last_notified_at so
    // the evaluation engine treats it as a fresh subscription.
    subscribe: async ({ userId, productId, alertType, referencePrice = null }) => {
        assertAlertType(alertType);

        // A price-drop alert needs a baseline to compare against; default it to
        // the product's current price when the caller doesn't pin one.
        let effectiveReferencePrice = referencePrice;
        if (alertType === ALERT_TYPES.PRICE_DROP && effectiveReferencePrice === null) {
            effectiveReferencePrice = await fetchCurrentPrice(productId);
        }

        await db.query(
            `INSERT INTO stock_alert_subscriptions
                (user_id, product_id, alert_type, reference_price, status, last_notified_at)
             VALUES (?, ?, ?, ?, 'active', NULL)
             ON DUPLICATE KEY UPDATE
                status = 'active',
                last_notified_at = NULL,
                reference_price = VALUES(reference_price)`,
            [userId, productId, alertType, effectiveReferencePrice]
        );

        return fetchSubscription(userId, productId, alertType);
    },

    // Soft-cancel: flip status to 'cancelled' so the row (and its reference
    // price / notification history) is preserved and a later subscribe can
    // reactivate the same row via the UNIQUE key.
    unsubscribe: async ({ userId, productId, alertType }) => {
        assertAlertType(alertType);

        const [result] = await db.query(
            `UPDATE stock_alert_subscriptions
             SET status = 'cancelled'
             WHERE user_id = ? AND product_id = ? AND alert_type = ?`,
            [userId, productId, alertType]
        );

        return result;
    },

    // List a user's subscriptions, optionally narrowed by alert type and/or
    // status. Filters are appended only when provided so the query stays a
    // single indexed lookup on user_id in the common case.
    listSubscriptions: async (userId, { alertType = null, status = null } = {}) => {
        let sql = "SELECT * FROM stock_alert_subscriptions WHERE user_id = ?";
        const params = [userId];

        if (alertType !== null) {
            sql += " AND alert_type = ?";
            params.push(alertType);
        }

        if (status !== null) {
            sql += " AND status = ?";
            params.push(status);
        }

        sql += " ORDER BY created_at DESC";

        const [rows] = await db.query(sql, params);
        return rows;
    },

    // Fire a PRODUCT_BACK_IN_STOCK alert for every active back-in-stock
    // subscription whose product now has stock. Returns the number dispatched.
    evaluateRestocks: async () => {
        const [rows] = await db.query(
            `SELECT s.id, s.user_id, s.product_id, p.stock, p.name
               FROM stock_alert_subscriptions s
               JOIN products p ON p.id = s.product_id
              WHERE s.alert_type = ?
                AND s.status = ?
                AND p.stock > 0`,
            [ALERT_TYPES.BACK_IN_STOCK, SUBSCRIPTION_STATUS.ACTIVE]
        );

        let dispatched = 0;
        for (const row of rows) {
            try {
                await dispatchAndMark(row, NOTIFICATION_TYPES.PRODUCT_BACK_IN_STOCK, {
                    stock: row.stock,
                    productName: row.name,
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
    },

    // Fire a WISHLIST_PRICE_DROP alert for every active price-drop subscription
    // whose product price has fallen below the price captured at subscribe
    // time. Returns the number dispatched.
    evaluatePriceDrops: async () => {
        const [rows] = await db.query(
            `SELECT s.id, s.user_id, s.product_id, s.reference_price, p.price, p.name
               FROM stock_alert_subscriptions s
               JOIN products p ON p.id = s.product_id
              WHERE s.alert_type = ?
                AND s.status = ?
                AND s.reference_price IS NOT NULL
                AND p.price < s.reference_price`,
            [ALERT_TYPES.PRICE_DROP, SUBSCRIPTION_STATUS.ACTIVE]
        );

        let dispatched = 0;
        for (const row of rows) {
            try {
                await dispatchAndMark(row, NOTIFICATION_TYPES.WISHLIST_PRICE_DROP, {
                    oldPrice: row.reference_price,
                    newPrice: row.price,
                    productName: row.name,
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
    },
};

module.exports = stockAlertService;
