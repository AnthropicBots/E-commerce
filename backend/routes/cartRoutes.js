const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const cartController = require("../controllers/cartController");

// Get user cart
router.get("/", authMiddleware, cartController.getUserCart);

// Replace user cart with the posted items
router.post("/sync", authMiddleware, cartController.syncCart);

module.exports = router;
