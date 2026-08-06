const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const cartIdentity = require("../middleware/cartIdentity");
const cartController = require("../controllers/cartController");

// Restore a basket from a recovery link (#1429).
//
// Declared BEFORE the router-level middleware below, and the placement is the
// point: the link is meant to work before sign-in, and the request names no
// cart, so there is nothing for `cartIdentity` to resolve or to refuse. Its
// authority is the single-purpose, expiring, single-use token in the body,
// checked by cartRestoreService. `config/routePolicy.js` declares it as the
// one public cart route.
//
// This route and its handler were dropped when this file was rewritten for
// guest carts (#1427). The service, its migrations and its public-route
// declaration all survived, so nothing failed loudly -- every recovery email
// sent since has simply linked to a 404 (#1444).
router.post("/restore", cartController.restoreFromLink);

// A basket exists before the shopper does (#1427). `optionalAuth` attaches the
// account when there is one and is deliberately not a policy in its own right;
// `cartIdentity` is the guard, and it is what decides -- and refuses -- which
// cart the request may reach. Both are router-level so the pair cannot be
// forgotten on a route added later.
router.use(optionalAuth);
router.use(cartIdentity);

router.get("/", cartController.getUserCart);
router.post("/sync", cartController.syncCart);
router.post("/add", cartController.addToCart);
router.put("/update", cartController.updateCartItem);
router.delete("/remove/:productId", cartController.removeCartItem);
router.delete("/clear", cartController.clearCart);

module.exports = router;
