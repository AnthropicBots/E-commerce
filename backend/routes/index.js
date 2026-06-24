const express = require("express");
const router = express.Router();

const productRoutes = require("./productRoutes");
const authRoutes = require("./authRoutes");
const orderRoutes = require("./orderRoutes");
const promoRoutes = require("./promoRoutes");
const adminRoutes = require("./adminRoutes");
const chatRoutes = require("./chatRoutes");
const wishlistRoutes = require("./wishlistRoutes");
const recommendationRoutes = require("./recommendationRoutes");
const cartRoutes = require("./cartRoutes");
const pincodeRoutes = require("./pincodeRoutes");

router.use("/products", productRoutes);
router.use("/auth", authRoutes);
router.use("/orders", orderRoutes);
router.use("/promos", promoRoutes);
router.use("/admin", adminRoutes);
router.use("/chat", chatRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/recommendations", recommendationRoutes);
router.use("/cart", cartRoutes);
router.use("/pincode", pincodeRoutes);

module.exports = router;