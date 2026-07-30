// backend/routes/wishlistRoutes.js
//
// Fixes #1295.
//
// This file previously did not parse, and would still have failed at mount
// time once it did. The defects it had:
//
//   1. `../config/constants` was destructured twice with `const`, so
//      MAX_WISHLIST_SYNC_LIMIT and SUPPORTED_EXPORT_FORMATS were each declared
//      twice in module scope:
//          SyntaxError: Identifier 'MAX_WISHLIST_SYNC_LIMIT' has already been declared
//   2. `validateShareToken` was never closed, so `validateExportFormat` was
//      declared inside its body and was invisible at module scope. It also had
//      no terminal `next()`, so a valid token would hang the request.
//   3. SHARE_TOKEN_MAX_LENGTH / SHARE_TOKEN_REGEX did not exist in
//      config/constants.js, making the length guard dead code.
//   4. `validateBatchProducts` referenced an undeclared `validId`, throwing
//      ReferenceError on every non-empty batch request.
//   5. `validateSyncPayload` read `req.body.productIds` while the controller
//      reads `req.body.items`, and validated UUIDs with `safeNumber`. Either
//      a 400 on every request, or a 200 that silently emptied the wishlist.
//   6. `/admin/:userId` was registered before `/admin/stats/all`, so Express
//      matched the stats route as `userId = "stats"`.

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const wishlistController = require("../controllers/wishlistController");
const { safeUUID } = require("../utils/helpers");
const {
  MAX_WISHLIST_SYNC_LIMIT,
  MAX_BATCH_OPERATION_LIMIT,
  SUPPORTED_EXPORT_FORMATS,
  SHARE_TOKEN_MAX_LENGTH,
  SHARE_TOKEN_REGEX,
} = require("../config/constants");

/**
 * Send a 400 with the standard response envelope.
 *
 * @param {import('express').Response} res
 * @param {string} message
 */
function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

// ==================== VALIDATION MIDDLEWARE ====================

/**
 * Validate a single product id taken from `:productId` or the request body.
 *
 * The normalised value is attached as `req.validatedProductId` so handlers do
 * not have to re-parse it.
 */
const validateProductId = (req, res, next) => {
  const productId = safeUUID(req.params.productId || req.body.productId);

  if (!productId) {
    return badRequest(res, "Valid product ID is required");
  }

  req.validatedProductId = productId;
  next();
};

/**
 * Validate the payload for the batch add/remove routes.
 *
 * Rejects non-arrays, empty arrays, oversized batches, malformed ids and
 * duplicates. The normalised ids are attached as `req.validatedProductIds`.
 *
 * The previous version compared against an undeclared `validId`, which threw
 * `ReferenceError: validId is not defined` for every non-empty array.
 */
const validateBatchProducts = (req, res, next) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return badRequest(res, "Product IDs array is required");
  }

  if (productIds.length > MAX_BATCH_OPERATION_LIMIT) {
    return badRequest(
      res,
      `Maximum ${MAX_BATCH_OPERATION_LIMIT} products per batch operation`
    );
  }

  const seenIds = new Set();
  const validatedIds = [];

  for (const id of productIds) {
    const validId = safeUUID(id);

    if (!validId) {
      return badRequest(res, `Invalid product ID: ${id}`);
    }

    if (seenIds.has(validId)) {
      return badRequest(
        res,
        `Duplicate product ID found: ${id}. Batch operations require unique IDs.`
      );
    }

    seenIds.add(validId);
    validatedIds.push(validId);
  }

  req.validatedProductIds = validatedIds;
  next();
};

/**
 * Validate the payload for `POST /wishlist/sync`.
 *
 * `wishlistController.syncWishlist` reads `req.body.items`, so that is the
 * field validated here. The previous version required `req.body.productIds`,
 * which meant a correct client got a 400 and an incorrect one got a 200 plus
 * an emptied wishlist (sync deletes every row before re-inserting).
 *
 * Each entry may be a bare id or an object carrying `productId` / `id`, which
 * is the shape the controller already accepts.
 */
const validateSyncPayload = (req, res, next) => {
  const { items } = req.body;

  if (!Array.isArray(items)) {
    return badRequest(res, "An items array is required for synchronization.");
  }

  if (items.length > MAX_WISHLIST_SYNC_LIMIT) {
    return badRequest(
      res,
      `Maximum ${MAX_WISHLIST_SYNC_LIMIT} products allowed in a single synchronization request.`
    );
  }

  // An empty array is legitimate: it means "my wishlist is now empty".
  for (const item of items) {
    const rawId =
      item !== null && typeof item === "object"
        ? item.productId ?? item.id
        : item;

    // Product ids are UUIDs (#1025). The previous check used
    // `safeNumber(id) || id < 1`, which rejected every one of them.
    if (!safeUUID(rawId)) {
      return badRequest(res, `Invalid product ID: ${rawId}`);
    }
  }

  next();
};

/**
 * Validate the `:token` parameter on the public share route.
 *
 * Share tokens are 64 lowercase hex characters (32 random bytes, hex encoded).
 * Checking the shape here keeps malformed tokens out of the database query.
 */
const validateShareToken = (req, res, next) => {
  const token = req.params.token;

  if (!token || token.trim() === "") {
    return badRequest(res, "Share token is required.");
  }

  if (token.length > SHARE_TOKEN_MAX_LENGTH) {
    return badRequest(
      res,
      `Invalid share token. Maximum length allowed is ${SHARE_TOKEN_MAX_LENGTH} characters.`
    );
  }

  if (!SHARE_TOKEN_REGEX.test(token)) {
    return badRequest(res, "Invalid share token format.");
  }

  next();
};

/**
 * Validate `?format=` on the export route, defaulting to JSON.
 *
 * The default is JSON rather than CSV: `exportWishlist` treats any value other
 * than `'csv'` as JSON, so defaulting to CSV here silently changed the
 * response type for callers that sent no format at all.
 */
const validateExportFormat = (req, res, next) => {
  const format = req.query.format;

  if (!format) {
    req.query.format = "json";
    return next();
  }

  if (!SUPPORTED_EXPORT_FORMATS.includes(format)) {
    return badRequest(
      res,
      `Unsupported export format: "${format}". Allowed formats are: ${SUPPORTED_EXPORT_FORMATS.join(", ")}.`
    );
  }

  next();
};

// ==================== PUBLIC ROUTES ====================

// Get shared wishlist by token (no auth required)
router.get("/share/:token", validateShareToken, wishlistController.getSharedWishlist);

// ==================== ADMIN ROUTES ====================
//
// Registered before the authenticated user routes below, and with the literal
// `/admin/stats/all` path ahead of the `/admin/:userId` parameter route.
// Express matches in registration order, so the previous ordering meant
// `/admin/stats/all` was captured by `/admin/:userId` with `userId = "stats"`
// and the stats handler was unreachable.

// Get wishlist stats (admin only)
router.get(
  "/admin/stats/all",
  authMiddleware,
  authorizeRoles("admin"),
  wishlistController.getWishlistStats
);

// Get any user's wishlist (admin only)
router.get(
  "/admin/:userId",
  authMiddleware,
  authorizeRoles("admin"),
  wishlistController.getAdminUserWishlist
);

// ==================== PROTECTED ROUTES (User) ====================

// Get wishlist with pagination
router.get("/", authMiddleware, wishlistController.getUserWishlist);

// Wishlist item count
router.get("/count", authMiddleware, wishlistController.getWishlistCount);

// Wishlist analytics
router.get("/analytics", authMiddleware, wishlistController.getWishlistAnalytics);

// Export wishlist (json | csv)
router.get(
  "/export",
  authMiddleware,
  validateExportFormat,
  wishlistController.exportWishlist
);

// Check if a product is in the wishlist
router.get(
  "/status/:productId",
  authMiddleware,
  validateProductId,
  wishlistController.checkWishlistStatus
);

// Add to wishlist
router.post("/add", authMiddleware, validateProductId, wishlistController.addToWishlist);

// Batch add to wishlist
router.post(
  "/batch/add",
  authMiddleware,
  validateBatchProducts,
  wishlistController.batchAddToWishlist
);

// Generate share link
router.post("/share", authMiddleware, wishlistController.generateShareLink);

// Sync wishlist (replace entire wishlist)
router.post(
  "/sync",
  authMiddleware,
  validateSyncPayload,
  wishlistController.syncWishlist
);

// Remove from wishlist (id in body)
router.post(
  "/remove",
  authMiddleware,
  validateProductId,
  wishlistController.removeFromWishlist
);

// ==================== DELETE ROUTES ====================
//
// The literal paths are registered before `/:productId`, otherwise
// `DELETE /wishlist/clear/all` and `DELETE /wishlist/cache` would be swallowed
// by the parameter route.

// Batch remove from wishlist
router.delete(
  "/batch/remove",
  authMiddleware,
  validateBatchProducts,
  wishlistController.batchRemoveFromWishlist
);

// Clear entire wishlist
router.delete("/clear/all", authMiddleware, wishlistController.clearWishlist);

// Clear wishlist cache
router.delete("/cache", authMiddleware, wishlistController.clearWishlistCache);

// Remove from wishlist (id in path)
router.delete(
  "/:productId",
  authMiddleware,
  validateProductId,
  wishlistController.removeFromWishlist
);

// ==================== ROUTE FALLBACK ====================
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Wishlist route not found",
  });
});

module.exports = router;
