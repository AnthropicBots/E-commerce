// backend/services/cartRestoreService.js
//
// The one-step restore link (#1429).
//
// A recovery message reaches someone who is, by and large, not signed in. If
// acting on it costs a sign-in, most of the value of having sent it is gone. So
// the link has to carry its own authority, and the interesting question is what
// kind of authority it is safe to put in an email.
//
// Not a session. The session JWT says "this is Sam" and unlocks everything Sam
// can do; a forwarded message would be a handover of the account. This is the
// opposite kind of credential -- it says nothing about who is holding it, and
// authorises exactly one thing:
//
//   single purpose -- it reads one basket back. It establishes no session,
//                     returns no token, sets no cookie, and reveals nothing
//                     about the account it was issued for;
//   one cart       -- bound at issue. The redeeming request names no cart, so
//                     pointing one at somebody else's basket is not a request
//                     that can be constructed, let alone rejected;
//   unguessable    -- 256 bits from the CSPRNG, and only its SHA-256 is stored,
//                     so the table is worth nothing to read;
//   expiring       -- a link in an old mailbox stops being a live credential;
//   single use     -- spent by a guarded update, so a replay finds it spent
//                     rather than racing the original.
//
// Restoring deliberately does not write to anybody's cart. The redeemer is
// anonymous by construction, so there is no account to write to that could be
// established safely; the lines come back in the response and the browser puts
// them in the basket it already owns. A signed-in shopper's existing sync path
// then persists them under their own authenticated session, which is the only
// place a cart write belongs.

'use strict';

const crypto = require('crypto');
const db = require('../config/db');
const cartRecoveryConfig = require('../config/cartRecoveryConfig');
const { publicProductCondition } = require('../constants/productVisibility');
const { safeInteger, safeUUID } = require('../utils/helpers');

// Hex of 32 random bytes. Pinned as a pattern so a malformed token is refused
// before it reaches the database, and so the shape cannot drift from what
// `issueRestoreToken` mints.
const RESTORE_TOKEN_REGEX = /^[0-9a-f]{64}$/;

const RESTORE_ERROR = Object.freeze({
    MALFORMED: 'RESTORE_LINK_INVALID',
    UNKNOWN: 'RESTORE_LINK_INVALID',
    EXPIRED: 'RESTORE_LINK_EXPIRED',
    SPENT: 'RESTORE_LINK_ALREADY_USED',
    EMPTY: 'RESTORE_BASKET_EMPTY'
});

/**
 * Reject a redemption with a status the route can pass straight through.
 *
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
function restoreFailure(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Mint a restore link for one basket.
 *
 * Any link previously issued for the same basket is expired as a side effect.
 * The sequence sends more than one message about a basket, and leaving the
 * earlier links live would mean the number of usable credentials for a cart
 * grew with the number of times we asked about it.
 *
 * @param {object} params
 * @param {string} params.cartId
 * @param {string} params.userId
 * @param {string} [params.recoveryLogId] - The send this link was minted for,
 *   so an order arriving through it can be credited to the message that earned
 *   it rather than to the programme in general (#1429).
 * @param {number} [params.ttlMinutes]
 * @returns {Promise<{token: string, tokenId: string, expiresInMinutes: number}>}
 */
async function issueRestoreToken({ cartId, userId, recoveryLogId, ttlMinutes }) {
    const cart = safeUUID(cartId);
    const owner = safeUUID(userId);

    if (!cart || !owner) {
        throw new Error('A restore link needs a cart and the account that owns it');
    }

    const ttl = Math.max(
        1,
        safeInteger(ttlMinutes, cartRecoveryConfig.RESTORE_LINK_TTL_MINUTES)
    );

    await db.query(
        `UPDATE cart_restore_tokens
         SET expires_at = NOW()
         WHERE cart_id = ? AND redeemed_at IS NULL AND expires_at > NOW()`,
        [cart]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const tokenId = crypto.randomUUID();

    await db.query(
        `INSERT INTO cart_restore_tokens
            (id, token_hash, cart_id, user_id, recovery_log_id, expires_at)
         VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
        [tokenId, sha256(token), cart, owner, safeUUID(recoveryLogId), ttl]
    );

    return { token, tokenId, expiresInMinutes: ttl };
}

/**
 * The landing page a restore link points at.
 *
 * The cart page rather than a page of its own: what the shopper wants to see
 * is their basket, and sending them anywhere else adds a step to the one-step
 * link.
 *
 * @param {string} token
 * @returns {string}
 */
function buildRestoreUrl(token) {
    const frontend = (process.env.FRONTEND_URL || 'http://localhost:5500').replace(/\/$/, '');

    return `${frontend}/cart.html?restore=${encodeURIComponent(token)}`;
}

/**
 * Spend a restore link and hand back the basket it covers.
 *
 * The `recoveryRef` in the reply is the identifier of the link that was just
 * spent, so an order placed from the restored basket can say which link earned
 * it (#1429). It is not a second credential: the link it names is already
 * spent, and presenting the reference buys nothing but a line in a report.
 *
 * @param {string} rawToken
 * @returns {Promise<{items: Array, itemCount: number, recoveryRef: string}>}
 * @throws {Error} With `status` and `code` set, for every refusal.
 */
async function redeemRestoreToken(rawToken) {
    const token = String(rawToken || '').trim().toLowerCase();

    if (!RESTORE_TOKEN_REGEX.test(token)) {
        throw restoreFailure(400, RESTORE_ERROR.MALFORMED, 'This restore link is not valid');
    }

    const [rows] = await db.query(
        `SELECT id, cart_id, user_id, redeemed_at,
                (expires_at <= NOW()) AS is_expired
         FROM cart_restore_tokens
         WHERE token_hash = ?
         LIMIT 1`,
        [sha256(token)]
    );

    const record = rows[0];

    // A link nobody issued and a link somebody mistyped get the same answer, so
    // the endpoint cannot be used to learn which tokens exist.
    if (!record) {
        throw restoreFailure(400, RESTORE_ERROR.UNKNOWN, 'This restore link is not valid');
    }

    if (record.redeemed_at) {
        throw restoreFailure(410, RESTORE_ERROR.SPENT, 'This restore link has already been used');
    }

    if (Number(record.is_expired)) {
        throw restoreFailure(410, RESTORE_ERROR.EXPIRED, 'This restore link has expired');
    }

    // Spending the link is the guard, not the read above. Two requests that
    // both passed the checks arrive here together; the status condition means
    // one of them changes a row and the other does not, and only the winner
    // gets the basket.
    const [spent] = await db.query(
        `UPDATE cart_restore_tokens
         SET redeemed_at = NOW()
         WHERE id = ? AND redeemed_at IS NULL AND expires_at > NOW()`,
        [record.id]
    );

    if (!spent.affectedRows) {
        throw restoreFailure(410, RESTORE_ERROR.SPENT, 'This restore link has already been used');
    }

    const items = await loadRestorableLines(record.cart_id);

    // The lines are read after the link is spent, so an emptied basket still
    // costs the link. That is the right way round: the alternative leaves a
    // live credential in a mailbox for a basket that may fill up again.
    if (!items.length) {
        throw restoreFailure(
            410,
            RESTORE_ERROR.EMPTY,
            'This basket is no longer available'
        );
    }

    return { items, itemCount: items.length, recoveryRef: record.id };
}

/**
 * The basket's lines, shaped the way the storefront cart stores them.
 *
 * Joined to `products`, so anything withdrawn from the catalogue since the
 * basket was abandoned simply does not come back. Restoring is re-adding, not
 * a promise that everything is still buyable -- stock is checked where it
 * always is, at sync and at checkout.
 *
 * @param {string} cartId
 * @returns {Promise<Array>}
 */
async function loadRestorableLines(cartId) {
    const visible = publicProductCondition('p');
    const [rows] = await db.query(
        `SELECT ci.product_id, ci.variant_id, ci.color, ci.size, ci.quantity,
                p.name, p.price, p.image
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         WHERE ci.cart_id = ? AND ${visible.sql}
         ORDER BY ci.created_at ASC`,
        [cartId, ...visible.params]
    );

    return rows.map((row) => ({
        id: row.product_id,
        name: row.name,
        price: Number(row.price),
        image: row.image,
        color: row.color || null,
        size: row.size || null,
        variantId: safeInteger(row.variant_id, 0) || null,
        qty: Math.max(1, safeInteger(row.quantity, 1))
    }));
}

module.exports = {
    RESTORE_ERROR,
    RESTORE_TOKEN_REGEX,
    issueRestoreToken,
    buildRestoreUrl,
    redeemRestoreToken,
    loadRestorableLines
};
