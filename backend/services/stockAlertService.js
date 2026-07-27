// backend/services/stockAlertService.js
// Subscription management and evaluation for back-in-stock and price-drop
// alerts (#1233).
//
// The subscribe/unsubscribe/list surface over the `stock_alert_subscriptions`
// table is the PR 1/3 foundation. The evaluation engine (evaluateRestocks /
// evaluatePriceDrops) is the PR 2/3 contribution: it scans active
// subscriptions, dispatches notifications through the existing broker, and
// flips each notified subscription to 'notified' so a re-run cannot re-notify.
const db = require("../config/db");
const { notificationBroker, NOTIFICATION_TYPES } = require("./notificationBrokerService");

const ALERT_TYPES = {
    BACK_IN_STOCK: "back_in_stock",
    PRICE_DROP: "price_drop",
};

const SUBSCRIPTION_STATUS = {
    ACTIVE: "active",
    NOTIFIED: "notified",
    CANCELLED: "cancelled",
};

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

// Flip a subscription to 'notified' after a successful dispatch. This is the
// dedupe hinge: the evaluate queries only ever pick up ACTIVE rows, so a
// notified row is excluded from every later run.
async function markNotified(subscriptionId) {
    await db.query(
        `UPDATE stock_alert_subscriptions
         SET status = '${SUBSCRIPTION_STATUS.NOTIFIED}', last_notified_at = ?
         WHERE id = ?`,
        [new Date(), subscriptionId]
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

    // Notify subscribers whose out-of-stock product is now back in stock.
    // A single join surfaces exactly the rows that qualify (active
    // back_in_stock alerts whose product has stock > 0); each gets one
    // notification, then is marked 'notified' so a subsequent run skips it.
    evaluateRestocks: async () => {
        const [rows] = await db.query(
            `SELECT s.id, s.user_id, s.product_id, p.stock
             FROM stock_alert_subscriptions s
             JOIN products p ON p.id = s.product_id
             WHERE s.alert_type = '${ALERT_TYPES.BACK_IN_STOCK}'
               AND s.status = '${SUBSCRIPTION_STATUS.ACTIVE}'
               AND p.stock > 0`,
            []
        );

        const notifiedIds = [];
        for (const row of rows) {
            await notificationBroker.publish(
                NOTIFICATION_TYPES.PRODUCT_BACK_IN_STOCK,
                { userId: row.user_id, productId: row.product_id, stock: row.stock },
                { channels: ALERT_CHANNELS }
            );
            await markNotified(row.id);
            notifiedIds.push(row.id);
        }

        return { notifiedCount: notifiedIds.length, notifiedIds };
    },

    // Notify subscribers whose product's current price fell below the price
    // they anchored to when subscribing. Same dispatch-then-mark-notified
    // dedupe as evaluateRestocks.
    evaluatePriceDrops: async () => {
        const [rows] = await db.query(
            `SELECT s.id, s.user_id, s.product_id, s.reference_price, p.price
             FROM stock_alert_subscriptions s
             JOIN products p ON p.id = s.product_id
             WHERE s.alert_type = '${ALERT_TYPES.PRICE_DROP}'
               AND s.status = '${SUBSCRIPTION_STATUS.ACTIVE}'
               AND p.price < s.reference_price`,
            []
        );

        const notifiedIds = [];
        for (const row of rows) {
            await notificationBroker.publish(
                NOTIFICATION_TYPES.WISHLIST_PRICE_DROP,
                {
                    userId: row.user_id,
                    productId: row.product_id,
                    price: row.price,
                    referencePrice: row.reference_price,
                },
                { channels: ALERT_CHANNELS }
            );
            await markNotified(row.id);
            notifiedIds.push(row.id);
        }

        return { notifiedCount: notifiedIds.length, notifiedIds };
    },
};

module.exports = stockAlertService;
