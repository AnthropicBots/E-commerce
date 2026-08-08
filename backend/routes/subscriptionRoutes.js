// backend/routes/subscriptionRoutes.js
//
// Mounted at /api/subscriptions.
//
// This router had four routes and all four were writes (#1494). A shopper
// could subscribe, pause, resume and cancel, and had no way to find out what
// they were subscribed to, when the period ended, or that a cancellation was
// pending -- and no way to see the plans before choosing one. The two reads
// below are the missing half.

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const subscriptionController = require("../controllers/subscriptionController");

// ==================== PUBLIC ====================

/**
 * GET /api/subscriptions/plans
 *
 * Public, because choosing a plan comes before having an account, and a
 * pricing page behind a login is a pricing page nobody reads.
 *
 * Declared above the authenticated routes rather than after them so the
 * router-level guard question never arises for it.
 */
router.get("/plans", subscriptionController.listPlans);

// ==================== USER ====================

/**
 * GET /api/subscriptions/me
 *
 * The caller's own subscription, or null. Answers 200 either way: "you have no
 * subscription" is a successful answer to the question, and a 404 would be
 * indistinguishable from a route that does not exist -- which is exactly the
 * confusion this endpoint is fixing.
 */
router.get("/me", authMiddleware, subscriptionController.getMine);

router.post("/subscribe", authMiddleware, subscriptionController.subscribe);
router.post("/pause", authMiddleware, subscriptionController.pause);

// Resume covers both un-pausing and withdrawing a pending cancellation. A
// shopper who presses Cancel and changes their mind means the second one, and
// used to be told "No paused subscription found to resume".
router.post("/resume", authMiddleware, subscriptionController.resume);
router.post("/cancel", authMiddleware, subscriptionController.cancel);

router.use((req, res) => {
    res.status(404).json({ success: false, message: "Subscription route not found" });
});

module.exports = router;
