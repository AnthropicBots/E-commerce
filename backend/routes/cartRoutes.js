const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const cartIdentity = require("../middleware/cartIdentity");
const cartController = require("../controllers/cartController");

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
