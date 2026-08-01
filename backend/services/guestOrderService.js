// backend/services/guestOrderService.js
//
// Finding an order without an account (#1427).
//
// A guest has no order list to open, so the order is reached by presenting the
// pair they were given at checkout: the order number, which is unguessable,
// and the email the order was placed with, which is not. The number carries
// the security; the email is there so that a number seen over someone's
// shoulder is not on its own enough.
//
// The thing this must not become is an oracle. Three questions are worth
// money to someone probing it -- does this order number exist, was it placed
// with this email, does this person shop here -- and the answer to all three
// has to be the same silence:
//
//   * one outcome for every failure, whether the number is unknown, the email
//     is wrong or the order belongs to an account;
//   * the email compared over digests in constant time, so neither its length
//     nor the position of the first differing character is measurable;
//   * the comparison performed even when no order was found, so the presence
//     of a row is not readable from how long the answer took.
//
// Rate limiting is the fourth measure and lives on the route, because it is
// about the caller rather than about the order.

const crypto = require('crypto');
const db = require('../config/db');
const { normalizeOrderNumber } = require('./orderNumber.service');
const { safeArray, sanitizeString } = require('../utils/helpers');

// Compared against a presented email when no order was found, so the failing
// path does the same work as the succeeding one.
const ABSENT_EMAIL = '\u0000no-such-order';

/**
 * Whether two email addresses are the same one, without saying how they differ.
 *
 * Addresses are compared case-insensitively on the whole string. The local
 * part is case-sensitive per the RFC and case-insensitive in every mail system
 * anyone actually uses, and a shopper who typed a capital at checkout must
 * still be able to find their order.
 *
 * Digests rather than the addresses themselves: `timingSafeEqual` throws on
 * unequal lengths, and reaching for a length check first would leak the length.
 *
 * @param {*} presented
 * @param {*} recorded
 * @returns {boolean}
 */
function emailsMatch(presented, recorded) {
    const digest = (value) => crypto
        .createHash('sha256')
        .update(sanitizeString(value).toLowerCase(), 'utf8')
        .digest();

    return crypto.timingSafeEqual(digest(presented), digest(recorded));
}

/**
 * The order behind an order number and the email it was placed with.
 *
 * Only orders with no account behind them are reachable. An account's order is
 * read through the account, and letting one be reached this way would turn the
 * endpoint into a way of testing whether a given address shops here.
 *
 * @param {object} credentials
 * @param {string} credentials.orderNumber
 * @param {string} credentials.email
 * @param {object} [connection]
 * @returns {Promise<object|null>} the order with its lines, or null
 */
async function findGuestOrder({ orderNumber, email }, connection) {
    const client = connection || db;
    const number = normalizeOrderNumber(orderNumber);

    if (!number) {
        return null;
    }

    const [rows] = await client.query(
        `SELECT
            id,
            order_number,
            customer_name,
            customer_email,
            customer_phone,
            city,
            state,
            zip,
            full_address,
            payment_method,
            payment_status,
            status,
            subtotal,
            tax,
            shipping_cost,
            discount_amount,
            total,
            tracking_number,
            created_at,
            updated_at
         FROM orders
         WHERE order_number = ? AND user_id IS NULL
         LIMIT 1`,
        [number]
    );

    const order = safeArray(rows)[0] || null;

    // Run the comparison either way. Returning early on a missing row would
    // make "no such order" measurably faster than "wrong email", which is the
    // enumeration this endpoint exists to refuse.
    const matches = emailsMatch(email, order ? order.customer_email : ABSENT_EMAIL);

    if (!order || !matches) {
        return null;
    }

    const [items] = await client.query(
        `SELECT product_id, name, price, qty, color, size, total
         FROM order_items
         WHERE order_id = ?`,
        [order.id]
    );

    return { ...order, items: safeArray(items) };
}

module.exports = {
    emailsMatch,
    findGuestOrder
};
