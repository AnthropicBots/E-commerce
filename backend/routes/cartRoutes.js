const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const cartController = require("../controllers/cartController");

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
