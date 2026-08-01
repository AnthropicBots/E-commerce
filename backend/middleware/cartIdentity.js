// backend/middleware/cartIdentity.js
//
// Which cart this request is allowed to touch (#1427).
//
// The cart endpoints used to answer that with `req.user.id` and nothing else,
// which is why a basket could not exist before an account did. There are now
// two ways to be identified -- a session, or a token the client holds -- and
// this settles which one applies before any handler runs.
//
// It is a policy middleware, not a convenience. It makes an access decision:
// it binds the request to exactly one cart and refuses to let anything else be
// named. That the decision can come out in a guest's favour is declared in the
// marker, so `config/routePolicy.js` has to say which routes that is
// acceptable on and the route audit checks the two agree.
//
// The account always wins. A signed-in shopper presenting a cart token gets
// their account cart, never the guest one -- folding a guest basket into an
// account is a deliberate step with its own rules, not something that happens
// because a stale header survived a login.

const { markPolicyMiddleware } = require('../config/policy');
const { COOKIE_NAMES } = require('../utils/tokens');
const guestCart = require('../services/guestCartService');

/**
 * Whether the caller presented credentials at all.
 *
 * The distinction that matters is between "no account" and "an account whose
 * token has expired". Both arrive here without `req.user`, and treating the
 * second as a guest would silently swap a signed-in shopper's basket for an
 * empty one instead of letting the client refresh and carry on. So a request
 * carrying credentials that did not authenticate is answered as it always
 * was, and only a request carrying none is treated as a guest.
 *
 * @param {object} req
 * @returns {boolean}
 */
function presentedCredentials(req) {
    const authHeader = req.headers?.authorization;

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim().length > 0;
    }

    return Boolean(req.cookies && req.cookies[COOKIE_NAMES.accessToken]);
}

/**
 * Populate `req.cartIdentity`.
 *
 * Resolving the identity is all that happens here. The cart row itself is
 * resolved by the handler, inside whatever transaction it opens, because
 * creating a cart is a write and a read has no business making one.
 */
function cartIdentity(req, res, next) {
    const userId = req.user?.id || req.user?.userId || null;

    if (userId) {
        req.cartIdentity = { userId, guestToken: null, isGuest: false };
        return next();
    }

    if (presentedCredentials(req)) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }

    req.cartIdentity = {
        userId: null,
        guestToken: guestCart.readTokenFromRequest(req),
        isGuest: true
    };

    return next();
}

markPolicyMiddleware(cartIdentity, {
    authentication: 'optional',
    guest: true,
    identity: 'cart-token'
});

module.exports = cartIdentity;
module.exports.cartIdentity = cartIdentity;
