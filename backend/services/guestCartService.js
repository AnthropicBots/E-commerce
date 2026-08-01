// backend/services/guestCartService.js
//
// The basket of a shopper we do not know yet (#1427).
//
// An account cart is found by asking who is signed in. A guest cart has no
// such question to ask, so the client holds a token and the cart is whatever
// that token resolves to. That makes the token a bearer credential, and the
// two properties everything here exists to protect are:
//
//   * it must be unguessable, because guessing one is reaching into somebody
//     else's basket -- so it is 256 bits from the CSPRNG, not a uuid and not
//     anything derived from the cart id;
//   * it must not be readable out of the database, for the same reason a
//     password is not stored in plaintext -- so only its SHA-256 is kept, and
//     a presented token is hashed before it is looked up.
//
// A plain hash is the right primitive here rather than a slow KDF: the input
// is full-entropy random, so there is no dictionary to run and nothing for
// work factor to buy.
//
// The single-active-cart guarantee is not this module's to enforce. A guest
// cart holds a NULL `user_id`, so the generated `active_marker` behind
// `uq_carts_one_active` is NULL for every one of them and they cannot collide
// with each other or with an account's cart. See migration 0027.

const crypto = require('crypto');
const db = require('../config/db');
const cartConfig = require('../config/cartConfig');
const { CART_STATUS } = require('./cartLifecycleService');
const { sanitizeString } = require('../utils/helpers');

// 32 bytes, base64url-encoded: 256 bits of entropy in 43 unpadded characters,
// safe in a header and in browser storage without further escaping.
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// A header rather than a cookie: a cookie would be attached to cross-site
// requests by the browser whether the shopper meant it or not, which is the
// shape of a CSRF, and this token is the only thing standing between a request
// and a basket.
const TOKEN_HEADER = 'X-Cart-Token';

/**
 * Run against the caller's transaction when there is one, the pool otherwise.
 */
function runner(connection) {
    return connection || db;
}

/**
 * A fresh cart token.
 *
 * @returns {string}
 */
function issueToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Whether a value could be a token this service issued.
 *
 * Checked before the token reaches a query so that a junk header costs a
 * regex rather than a database round trip.
 *
 * @param {*} token
 * @returns {boolean}
 */
function isWellFormedToken(token) {
    return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/**
 * The stored form of a token.
 *
 * @param {*} token
 * @returns {string|null} hex SHA-256, or null when the input is not a token
 */
function hashToken(token) {
    if (!isWellFormedToken(token)) {
        return null;
    }

    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The live guest cart a token reaches, or null.
 *
 * "Live" means active and unexpired. A token whose cart was converted at
 * checkout, swept as abandoned, or whose expiry has passed resolves to
 * nothing, and the caller treats that exactly as it treats no token at all --
 * the shopper starts a new basket rather than being shown an error about one
 * they cannot see.
 *
 * @param {string} token
 * @param {object} [connection]
 * @returns {Promise<string|null>} cart id
 */
async function findCartIdByToken(token, connection) {
    const tokenHash = hashToken(token);

    if (!tokenHash) return null;

    const [rows] = await runner(connection).query(
        `SELECT id FROM carts
         WHERE guest_token_hash = ?
           AND status = ?
           AND user_id IS NULL
           AND (guest_token_expires_at IS NULL OR guest_token_expires_at > NOW())
         LIMIT 1`,
        [tokenHash, CART_STATUS.ACTIVE]
    );

    return rows.length ? rows[0].id : null;
}

/**
 * Open a cart for a shopper with no account.
 *
 * @param {object} [connection]
 * @returns {Promise<{cartId: string, token: string}>}
 */
async function createCart(connection) {
    const cartId = crypto.randomUUID();
    const token = issueToken();

    await runner(connection).query(
        `INSERT INTO carts (
            id, user_id, guest_token_hash, guest_token_expires_at, status, last_activity_at
         ) VALUES (?, NULL, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, NOW())`,
        [cartId, hashToken(token), guestTokenTtlMinutes(), CART_STATUS.ACTIVE]
    );

    return { cartId, token };
}

/**
 * The cart the presented token reaches, or a new one.
 *
 * `token` is only returned when one was minted, so a caller can tell the
 * difference between "hold on to this" and "keep the one you already have"
 * without comparing strings.
 *
 * @param {string|null} token
 * @param {object} [connection]
 * @returns {Promise<{cartId: string, token: string|null, isNew: boolean}>}
 */
async function resolveCart(token, connection) {
    const existing = await findCartIdByToken(token, connection);

    if (existing) {
        return { cartId: existing, token: null, isNew: false };
    }

    const created = await createCart(connection);

    return { ...created, isNew: true };
}

/**
 * Push the token's expiry out from now.
 *
 * Called on shopper activity for the same reason `last_activity_at` is: a
 * basket someone is still adding to must not have its credential expire
 * underneath them. Guarded on the cart still being active so a converted cart
 * cannot have its token brought back to life.
 *
 * @param {string} cartId
 * @param {object} [connection]
 * @returns {Promise<void>}
 */
async function extendToken(cartId, connection) {
    if (!cartId) return;

    await runner(connection).query(
        `UPDATE carts
         SET guest_token_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
         WHERE id = ? AND guest_token_hash IS NOT NULL AND status = ?`,
        [guestTokenTtlMinutes(), cartId, CART_STATUS.ACTIVE]
    );
}

/**
 * The token the client presented, if it presented a usable one.
 *
 * @param {object} req
 * @returns {string|null}
 */
function readTokenFromRequest(req) {
    const presented = sanitizeString(
        typeof req?.get === 'function'
            ? req.get(TOKEN_HEADER)
            : req?.headers?.[TOKEN_HEADER.toLowerCase()]
    );

    return isWellFormedToken(presented) ? presented : null;
}

function guestTokenTtlMinutes() {
    return Math.max(1, Number(cartConfig.GUEST_TOKEN_TTL_MINUTES) || 0);
}

module.exports = {
    TOKEN_HEADER,
    issueToken,
    isWellFormedToken,
    hashToken,
    findCartIdByToken,
    createCart,
    resolveCart,
    extendToken,
    readTokenFromRequest
};
