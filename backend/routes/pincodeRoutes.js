// backend/routes/pincodeRoutes.js
//
// Mounted at /api/pincode.
//
// This file was five lines and served one of the controller's four handlers
// (#1496). `checkMultiplePincodes`, `searchPincodes` and `clearPincodeCache`
// were all exported and unreachable -- including the only one that could clear
// a cache, which is how a corrected pincode could take 24 hours to show up on
// the product page.

const express = require("express");
const router = express.Router();

const {
    checkPincode,
    checkMultiplePincodes,
    searchPincodes,
    clearPincodeCache
} = require("../controllers/pincodeController");

const authMiddleware = require("../middleware/authMiddleware");
const { authorize } = require("../config/policy");
const { PERMISSIONS } = require("../config/policy");
const { pincodeLookupLimiter } = require("../middleware/rateLimiter");

// ==================== PUBLIC ====================
//
// Unauthenticated by design: a shopper checks whether you deliver to them
// before they have an account, and often before they have a basket. The
// limiter is therefore the only thing between the endpoint and a scan of every
// pincode in the country, and it is applied at the router so a route added
// later cannot be missing it.
router.use(pincodeLookupLimiter);

/**
 * GET /api/pincode/check/:pincode
 */
router.get("/check/:pincode", checkPincode);

/**
 * GET /api/pincode/search?query=
 *
 * Declared above "/check/:pincode" is unnecessary -- the paths do not overlap
 * -- but it is declared before the batch POST so the reads read together.
 */
router.get("/search", searchPincodes);

/**
 * POST /api/pincode/check-multiple
 * Body: { pincodes: string[] }
 *
 * Capped at PINCODE_BATCH_LIMIT (50) in the controller.
 */
router.post("/check-multiple", checkMultiplePincodes);

// ==================== ADMIN ====================

/**
 * POST /api/pincode/cache/clear
 *
 * The invalidation that existed and could not be called.
 *
 * `authorize` is the guard rather than the check the handler used to carry.
 * That one read `if (req.user && !hasPermission(...))`, which refuses a
 * signed-in non-admin and lets a caller with no `req.user` through -- so
 * mounting the route without changing it would have published an
 * unauthenticated cache flush under a message saying only admins can do it.
 * `authMiddleware` runs first so an anonymous caller is a 401 rather than
 * reaching a permission check at all.
 */
router.post(
    "/cache/clear",
    authMiddleware,
    authorize(PERMISSIONS.CACHE_MANAGE),
    clearPincodeCache
);

router.use((req, res) => {
    res.status(404).json({ success: false, message: "Pincode route not found" });
});

module.exports = router;
