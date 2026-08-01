const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const cartController = require("../controllers/cartController");

// Restore a basket from a recovery link (#1429).
//
// The one route here without authMiddleware, because the point of the link is
// that it works before sign-in. Its authority is the single-purpose, expiring,
// single-use token in the body, checked by cartRestoreService; the decision to
// open it to anonymous traffic is recorded in config/routePolicy.js, where the
// startup audit reads it.
router.post("/restore", cartController.restoreFromLink);

// Get user cart
router.get("/", authMiddleware, cartController.getUserCart);

// Replace user cart with the posted items
router.post("/sync", authMiddleware, cartController.syncCart);

// Add product to cart
router.post("/add", authMiddleware, cartController.addToCart);

// Update product quantity in cart
router.put("/update", authMiddleware, cartController.updateCartItem);

// Remove specific product from cart
router.delete("/remove/:productId", authMiddleware, cartController.removeCartItem);

// Clear the entire cart
router.delete("/clear", authMiddleware, cartController.clearCart);

module.exports = router;
