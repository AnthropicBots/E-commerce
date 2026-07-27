// backend/services/stockAlertService.js
// Subscription management for back-in-stock and price-drop alerts (#1233).
// Owns only the subscribe/unsubscribe/list surface over the
// `stock_alert_subscriptions` table; the evaluation engine and the API/
// scheduler that consume these rows live in follow-up changes.
const db = require("../config/db");

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
};

module.exports = stockAlertService;
