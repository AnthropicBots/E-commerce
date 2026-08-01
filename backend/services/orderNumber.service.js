// backend/services/orderNumber.service.js
//
// The handle a shopper is given for an order (#1427).
//
// An account holder never needs one: they open their order list and pick. A
// guest has no list, so the number is how they find the order again, and it is
// half of what authorises that lookup -- the other half being the email the
// order was placed with, which for anyone's own address is not a secret.
//
// All of the weight therefore sits on the random suffix. Sixty-four bits from
// the CSPRNG, not a counter and nothing derived from the order's primary key:
// a sequence tells anyone holding one number what the neighbouring ones are,
// and a derivation hands the number to anyone who has seen an order URL.
//
// The date prefix is for the person reading it out. It narrows nothing an
// attacker did not already know.

const crypto = require('crypto');

const SUFFIX_BYTES = 8;
const PREFIX = 'ORD';

// What a number looks like, so a lookup can reject a malformed one before it
// costs a query. Kept deliberately loose on the suffix length: numbers minted
// by a future change must still be presentable.
const ORDER_NUMBER_PATTERN = /^ORD-\d{8}-[0-9A-F]{8,32}$/;

/**
 * A fresh order number.
 *
 * @param {Date} [placedAt] - Defaults to now; the date the number carries.
 * @returns {string}
 */
function generateOrderNumber(placedAt = new Date()) {
    const year = placedAt.getFullYear();
    const month = String(placedAt.getMonth() + 1).padStart(2, '0');
    const day = String(placedAt.getDate()).padStart(2, '0');
    const suffix = crypto.randomBytes(SUFFIX_BYTES).toString('hex').toUpperCase();

    return `${PREFIX}-${year}${month}${day}-${suffix}`;
}

/**
 * The canonical form of a number a shopper typed.
 *
 * Case and surrounding whitespace are forgiven because the number travels
 * through email clients, phone calls and clipboards. Nothing else is: a
 * lenient parser here would be a lenient parser on the one input an order
 * lookup authorises against.
 *
 * @param {*} value
 * @returns {string|null} the number, or null when it is not one
 */
function normalizeOrderNumber(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toUpperCase();

    return ORDER_NUMBER_PATTERN.test(normalized) ? normalized : null;
}

module.exports = {
    ORDER_NUMBER_PATTERN,
    generateOrderNumber,
    normalizeOrderNumber
};
