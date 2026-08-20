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

// The one definition of "a shopper may see this product" (#1456). This engine
// did not use it, which is the whole of #1609: `products` carries `deleted_at`
// and a `status` enum, and both evaluators joined on nothing but `p.id`. So a
// soft-deleted, archived, inactive or still-draft product that gained stock --
// a correction, a return, a re-import -- mailed everyone who had ever
// subscribed to it, and the link in that mail lands on a page the product
// routes deliberately 404.
//
// Importing the shared condition rather than retyping the predicate is the
// point: it is what stops this engine drifting away from the catalogue a
// second time.
const { publicProductCondition } = require("../constants/productVisibility");

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

function assertAlertType(alertType) {
    if (!VALID_ALERT_TYPES.includes(alertType)) {
        throw new Error(
            `Invalid alertType: ${alertType}. Expected one of ${VALID_ALERT_TYPES.join(", ")}`
        );
    }
}

/**
 * Raised when a subscription is asked for against a product a shopper may not
 * see. Carries a `code` so the route can answer 404 rather than folding every
 * business-rule failure into a 400.
 */
class StockAlertError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "StockAlertError";
        this.code = code;
    }
}

/**
 * Load the product a subscription is being taken out against, through the
 * public visibility condition.
 *
 * Runs for every alert type, not only for a price-drop without a baseline.
 * Before this, a back-in-stock subscription was inserted with no lookup at all
 * and a price-drop subscription carrying a client-supplied `referencePrice`
 * skipped it too -- so `POST /api/stock-alerts` accepted subscriptions to
 * draft and deleted products and held them until an evaluator picked them up.
 *
 * @param {string} productId
 * @returns {Promise<{id: string, price: number, stock: number, name: string}>}
 * @throws {StockAlertError} PRODUCT_NOT_VISIBLE
 */
async function fetchVisibleProduct(productId) {
    const visible = publicProductCondition("p");

    const [rows] = await db.query(
        `SELECT p.id, p.price, p.stock, p.name
           FROM products p
          WHERE p.id = ?
            AND ${visible.sql}
          LIMIT 1`,
        [productId, ...visible.params]
    );

    const product = Array.isArray(rows) ? rows[0] : undefined;

    if (!product) {
        // Deliberately the same message whether the product does not exist or
        // is merely not public. Which of the two it is is information about
        // unreleased catalogue, and this endpoint is reachable by any signed-in
        // account.
        throw new StockAlertError(
            `Product not found: ${productId}`,
            "PRODUCT_NOT_VISIBLE"
        );
    }

    return product;
}

/**
 * The price a price-drop alert measures against.
 *
 * A caller may pin a baseline, but only downwards. Left unclamped, a client
 * could post `referencePrice: 999999` and be notified of a "price drop" on the
 * very next scan for a product whose price never moved.
 *
 * @param {unknown} requested
 * @param {number} currentPrice
 * @returns {number}
 */
function resolveReferencePrice(requested, currentPrice) {
    const current = Number(currentPrice);
    const base = Number.isFinite(current) ? current : 0;

    if (requested === null || requested === undefined || requested === "") {
        return base;
    }

    const pinned = Number(requested);

    if (!Number.isFinite(pinned) || pinned <= 0) {
        throw new StockAlertError(
            "referencePrice must be a positive number",
            "INVALID_REFERENCE_PRICE"
        );
    }

    return Math.min(pinned, base);
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
    StockAlertError,

    // Exposed so the routes can distinguish "no such visible product" (404)
    // from a malformed request (400), and so the tests can assert the clamp
    // without going through the database.
    fetchVisibleProduct,
    resolveReferencePrice,

    // Create (or reactivate) a subscription. The UNIQUE key on
    // (user_id, product_id, alert_type) makes this idempotent: a repeat call
    // for the same triple reactivates the existing row instead of inserting a
    // duplicate, resetting status to 'active' and clearing last_notified_at so
    // the evaluation engine treats it as a fresh subscription.
    subscribe: async ({ userId, productId, alertType, referencePrice = null }) => {
        assertAlertType(alertType);

        // Every alert type, every time. A subscription is a promise to mail
        // this user about this product later, and there is no point recording
        // one against a product that will never be publicly visible again.
        const product = await fetchVisibleProduct(productId);

        // A price-drop alert needs a baseline to compare against; default it to
        // the product's current price when the caller doesn't pin one, and take
        // it from the row already loaded rather than issuing a second query
        // that could read a price the visibility check never saw.
        const effectiveReferencePrice =
            alertType === ALERT_TYPES.PRICE_DROP
                ? resolveReferencePrice(referencePrice, product.price)
                : null;

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

    // Cancel every active subscription whose product is no longer publicly
    // visible.
    //
    // Filtering at evaluation time stops the mail going out, but it leaves the
    // rows sitting `active` forever, re-examined on every scan and shown to the
    // user on their alerts page as though they were still live. A product can
    // come back -- `inactive` is explicitly "withdrawn, expected back" -- so
    // this is deliberately NOT run by the evaluators; it is a housekeeping
    // call for the scheduler to make against genuinely gone products, i.e.
    // soft-deleted or archived ones.
    //
    // Returns the number of rows cancelled.
    purgeUnavailableSubscriptions: async () => {
        const [result] = await db.query(
            `UPDATE stock_alert_subscriptions s
               JOIN products p ON p.id = s.product_id
                SET s.status = ?
              WHERE s.status = ?
                AND (p.deleted_at IS NOT NULL OR p.status = 'archived')`,
            [SUBSCRIPTION_STATUS.CANCELLED, SUBSCRIPTION_STATUS.ACTIVE]
        );

        return result && typeof result.affectedRows === "number"
            ? result.affectedRows
            : 0;
    },

    // Fire a PRODUCT_BACK_IN_STOCK alert for every active back-in-stock
    // subscription whose product now has stock. Returns the number dispatched.
    evaluateRestocks: async () => {
        const visible = publicProductCondition("p");

        const [rows] = await db.query(
            `SELECT s.id, s.user_id, s.product_id, p.stock, p.name
               FROM stock_alert_subscriptions s
               JOIN products p ON p.id = s.product_id
              WHERE s.alert_type = ?
                AND s.status = ?
                AND p.stock > 0
                AND ${visible.sql}`,
            [
                ALERT_TYPES.BACK_IN_STOCK,
                SUBSCRIPTION_STATUS.ACTIVE,
                ...visible.params,
            ]
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
        const visible = publicProductCondition("p");

        const [rows] = await db.query(
            `SELECT s.id, s.user_id, s.product_id, s.reference_price, p.price, p.name
               FROM stock_alert_subscriptions s
               JOIN products p ON p.id = s.product_id
              WHERE s.alert_type = ?
                AND s.status = ?
                AND s.reference_price IS NOT NULL
                AND p.price < s.reference_price
                AND ${visible.sql}`,
            [
                ALERT_TYPES.PRICE_DROP,
                SUBSCRIPTION_STATUS.ACTIVE,
                ...visible.params,
            ]
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
