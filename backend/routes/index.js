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
const checkoutRoutes = require("./checkoutRoutes");
const pincodeRoutes = require("./pincodeRoutes");
const subscriptionRoutes = require("./subscriptionRoutes");
const courierWebhookRoutes = require("./courierWebhookRoutes");
const refundRoutes = require("./refundRoutes");
const addressRoutes = require("./addressRoutes");
const wishlistNotifyRoutes = require("./wishlistNotifyRoutes");
const contactRoutes = require("./contactRoutes");
const interactionRoutes = require("./interactionRoutes");

router.use("/products", productRoutes);
router.use("/auth", authRoutes);
router.use("/orders", orderRoutes);
router.use("/promos", promoRoutes);
router.use("/admin", adminRoutes);
router.use("/chat", chatRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/wishlist-notify", wishlistNotifyRoutes);
router.use("/recommendations", recommendationRoutes);
router.use("/cart", cartRoutes);
router.use("/checkout", checkoutRoutes);
router.use("/pincode", pincodeRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/courier-webhooks", courierWebhookRoutes);
router.use("/refunds", refundRoutes);
// Saved address book (#1347).
router.use("/addresses", addressRoutes);
// Two paths the frontend has always called and nothing has ever served
// (#1445). The mount names are the ones already in the requests -- singular
// "contact", plural "interactions" -- because the callers are the contract
// here, not the other way round.
router.use("/contact", contactRoutes);
router.use("/interactions", interactionRoutes);

module.exports = router;