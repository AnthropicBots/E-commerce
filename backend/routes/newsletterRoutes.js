// backend/routes/newsletterRoutes.js
//
// The newsletter list (#1459). Nothing served these paths before; the three
// frontend handlers never made a request at all.
//
// Every route here is unauthenticated by design. Signing up for a newsletter is
// something a visitor does before they have an account, and the confirm and
// unsubscribe links are followed from an inbox, where there is no session.
// The token in the link is the credential.

const express = require("express");
const router = express.Router();

const {
    subscribe,
    confirm,
    unsubscribe
} = require("../controllers/newsletterController");

const { newsletterLimiter } = require("../middleware/rateLimiter");
// Attaches a user when one is signed in and does not object when nobody is.
// Used only to record who signed up, when that happens to be knowable.
const { optionalAuth } = require("../middleware/authMiddleware");

/**
 * POST /api/newsletter/subscribe
 * Body: { email, source? }
 *
 * Always answers 200 with the same message -- see the controller for why.
 */
router.post("/subscribe", newsletterLimiter, optionalAuth, subscribe);

/**
 * POST /api/newsletter/confirm
 * Body or query: { token }
 *
 * Rate limited as well: the token is 256 bits so guessing is not the threat,
 * but an unauthenticated endpoint that hits the database on every call should
 * not be free to hammer.
 */
router.post("/confirm", newsletterLimiter, confirm);

/**
 * POST /api/newsletter/unsubscribe
 * Body or query: { token }
 *
 * POST rather than GET, so that a mail client prefetching links cannot
 * unsubscribe somebody who never clicked. The page behind the link makes the
 * request.
 */
router.post("/unsubscribe", newsletterLimiter, unsubscribe);

module.exports = router;
