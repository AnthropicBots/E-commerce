// backend/services/stockAlertService.js
//
// Stock alert subscriptions and evaluation for #1233 ("Back-in-stock &
// price-drop alerts for wishlist/products").
//
// Subscription management (subscribe / unsubscribe / listSubscriptions) is the
// PR 1/3 foundation. The evaluation engine (evaluateRestocks /
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

// Both back-in-stock and price-drop alerts are worth surfacing in the app and
// over email, so every dispatch fans out to the same two channels.
const ALERT_CHANNELS = ["in_app", "email"];

const stockAlertService = {
    // --- PR 1/3 foundation: subscription management -----------------------

    // Create (or re-activate) a subscription. The UNIQUE key on
    // (user_id, product_id, alert_type) makes this idempotent: a repeat
    // subscribe re-arms an existing row rather than inserting a duplicate.
    // A price_drop subscription with no explicit referencePrice anchors to the
    // product's current price so any later dip counts as a drop.
    subscribe: async ({ userId, productId, alertType, referencePrice = null }) => {
        let price = referencePrice;

        if (alertType === ALERT_TYPES.PRICE_DROP && price === null) {
            const [products] = await db.query(
                "SELECT price FROM products WHERE id = ?",
                [productId]
            );
            if (products.length === 0) {
                throw new Error(`Cannot subscribe to price drop: product ${productId} not found`);
            }
            price = products[0].price;
        }

        const [result] = await db.query(
            `INSERT INTO stock_alert_subscriptions (user_id, product_id, alert_type, reference_price, status)
             VALUES (?, ?, ?, ?, 'active')
             ON DUPLICATE KEY UPDATE
                reference_price = VALUES(reference_price),
                status = 'active',
                last_notified_at = NULL,
                updated_at = CURRENT_TIMESTAMP`,
            [userId, productId, alertType, price]
        );

        return { userId, productId, alertType, referencePrice: price, id: result.insertId };
    },

    // Soft cancel: keep the row (and its history) but stop it from being
    // evaluated by flipping status to 'cancelled'.
    unsubscribe: async ({ userId, productId, alertType }) => {
        const [result] = await db.query(
            `UPDATE stock_alert_subscriptions
             SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND product_id = ? AND alert_type = ?`,
            [userId, productId, alertType]
        );

        return result.affectedRows > 0;
    },

    listSubscriptions: async (userId, { alertType, status } = {}) => {
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
    },

    // --- PR 2/3: evaluation engine ---------------------------------------

    // Notify subscribers whose out-of-stock product is now back in stock.
    // A single join surfaces exactly the rows that qualify (active
    // back_in_stock alerts whose product has stock > 0); each gets one
    // notification, then is marked 'notified' so a subsequent run skips it.
    evaluateRestocks: async () => {
        const [rows] = await db.query(
            `SELECT s.id, s.user_id, s.product_id, p.stock
             FROM stock_alert_subscriptions s
             JOIN products p ON p.id = s.product_id
             WHERE s.alert_type = 'back_in_stock'
               AND s.status = 'active'
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
             WHERE s.alert_type = 'price_drop'
               AND s.status = 'active'
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

// Flip a subscription to 'notified' after a successful dispatch. This is the
// dedupe hinge: the evaluate queries only ever pick up status='active' rows,
// so a notified row is excluded from every later run.
async function markNotified(subscriptionId) {
    await db.query(
        `UPDATE stock_alert_subscriptions
         SET status = 'notified', last_notified_at = ?
         WHERE id = ?`,
        [new Date(), subscriptionId]
    );
}

module.exports = stockAlertService;
module.exports.ALERT_TYPES = ALERT_TYPES;
module.exports.SUBSCRIPTION_STATUS = SUBSCRIPTION_STATUS;
