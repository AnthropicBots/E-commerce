const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const wishlistController = require("../controllers/wishlistController");

// Get user wishlist
router.get("/", authMiddleware, wishlistController.getUserWishlist);

// Add to wishlist
router.post("/add", authMiddleware, wishlistController.addToWishlist);

// Remove from wishlist
router.post("/remove", authMiddleware, wishlistController.removeFromWishlist);

// Replace entire wishlist with the posted items
router.post("/sync", authMiddleware, wishlistController.syncWishlist);

module.exports = router;
