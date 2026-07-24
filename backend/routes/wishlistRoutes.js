// backend/routes/wishlist.routes.js

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const wishlistController = require("../controllers/wishlistController");
const { safeNumber, safeInteger, safeUUID } = require("../utils/helpers");

// ==================== SYNC VALIDATION MIDDLEWARE ====================
const validateSyncPayload = (req, res, next) => {
  const { productIds } = req.body;

  // 1. Check if array exists and is not empty
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Product IDs array is required and cannot be empty for synchronization.",
    });
  }

  // 🔥 UPDATED: Use the centralized constant instead of hardcoding 200
  if (productIds.length > MAX_WISHLIST_SYNC_LIMIT) {
    return res.status(400).json({
      success: false,
      message: `Maximum ${MAX_WISHLIST_SYNC_LIMIT} products allowed in a single synchronization request.`,
    });
  }

  // 2. Validate individual IDs
  for (const id of productIds) {
    if (!safeNumber(id) || id < 1) {
      return res.status(400).json({
        success: false,
        message: `Invalid product ID: ${id}`,
      });
    }
  }

  next();
};

const {
  MAX_WISHLIST_SYNC_LIMIT,
  SUPPORTED_EXPORT_FORMATS,
  SHARE_TOKEN_MAX_LENGTH,
  SHARE_TOKEN_REGEX
} = require("../config/constants");

const { MAX_WISHLIST_SYNC_LIMIT, SUPPORTED_EXPORT_FORMATS } = require("../config/constants");

// ==================== VALIDATION MIDDLEWARE ====================
const validateProductId = (req, res, next) => {
  const productId = safeUUID(req.params.productId || req.body.productId);
  if (!productId) {
    return res.status(400).json({
      success: false,
      message: "Valid product ID is required",
    });
  }
  req.validatedProductId = productId;
  next();
};

const validateBatchProducts = (req, res, next) => {
  const { productIds } = req.body;

  // 1. Check if array exists and is not empty
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Product IDs array is required",
    });
  }

  // 2. Check maximum limit
  if (productIds.length > 50) {
    return res.status(400).json({
      success: false,
      message: "Maximum 50 products per batch operation",
    });
  }

  // 3. Validate individual IDs and check for DUPLICATES
  const seenIds = new Set(); // Duplicate check ke liye Set use kiya
  for (const id of productIds) {
    if (!safeUUID(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid product ID: ${id}`,
      });
    }

    // 🔥 NEW: Agar ID pehle se Set mein hai, toh duplicate error return karo
    if (seenIds.has(validId)) {
      return res.status(400).json({
        success: false,
        message: `Duplicate product ID found: ${id}. Batch operations require unique IDs.`,
      });
    }
    seenIds.add(validId);
  }

  next();
};
// ==================== SHARE TOKEN VALIDATION MIDDLEWARE ====================
const validateShareToken = (req, res, next) => {
  const token = req.params.token;

  // 1. Presence check
  if (!token) {
    return res.status(400).json({
      success: false,
      message: "Share token is required.",
    });
  }

  // 2. Reject empty or whitespace-only tokens
  if (token.trim() === '') {
    return res.status(400).json({
      success: false,
      message: "Share token cannot be empty or contain only whitespace.",
    });
  }

  // 3. Enforce a reasonable maximum token length
  if (token.length > SHARE_TOKEN_MAX_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Invalid share token. Maximum length allowed is ${SHARE_TOKEN_MAX_LENGTH} characters.`,
    });
  }

const validateExportFormat = (req, res, next) => {
  const format = req.query.format; 

  if (!format) {
    req.query.format = 'csv'; // Default to CSV
    return next();
  }

  if (!SUPPORTED_EXPORT_FORMATS.includes(format)) {
    return res.status(400).json({
      success: false,
      message: `Unsupported export format: "${format}". Allowed formats are: ${SUPPORTED_EXPORT_FORMATS.join(', ')}.`,
    });
  }

  next();
};

// ==================== PUBLIC ROUTES ====================
// Get shared wishlist by token (No auth required)
router.get("/share/:token",validateShareToken, wishlistController.getSharedWishlist);

// ==================== PROTECTED ROUTES (User Only) ====================

// Get wishlist with pagination
router.get("/", authMiddleware, wishlistController.getUserWishlist);

// Check if product is in wishlist (Issue #777)
router.get("/status/:productId", authMiddleware, wishlistController.checkWishlistStatus);

// Add to wishlist
router.post(
  "/add",
  authMiddleware,
  validateProductId,
  wishlistController.addToWishlist,
);

// Batch add to wishlist
router.post(
  "/batch/add",
  authMiddleware,
  validateBatchProducts,
  wishlistController.batchAddToWishlist,
);

// Generate share link
router.post("/share", authMiddleware, wishlistController.generateShareLink);

// Sync wishlist (replace entire wishlist)
router.post("/sync", authMiddleware,validateSyncPayload , wishlistController.syncWishlist);

// Remove from wishlist (using body)
router.post(
  "/remove",
  authMiddleware,
  validateProductId,
  wishlistController.removeFromWishlist,
);

// ==================== DELETE ROUTES ====================

// Remove from wishlist (using params - DELETE method)
router.delete(
  "/:productId",
  authMiddleware,
  validateProductId,
  wishlistController.removeFromWishlist,
);

// Batch remove from wishlist
router.delete(
  "/batch/remove",
  authMiddleware,
  validateBatchProducts,
  wishlistController.batchRemoveFromWishlist,
);

// Clear entire wishlist
router.delete("/clear/all", authMiddleware, wishlistController.clearWishlist);

// Clear wishlist cache
router.delete("/cache", authMiddleware, wishlistController.clearWishlistCache);

// ==================== ADMIN ROUTES ====================
// Get any user's wishlist (Admin only)
router.get(
  "/admin/:userId",
  authMiddleware,
  authorizeRoles("admin"),
  wishlistController.getAdminUserWishlist
);

// Get wishlist stats (Admin only)
router.get(
  "/admin/stats/all",
  authMiddleware,
  authorizeRoles("admin"),
  wishlistController.getWishlistStats
);

// ==================== ROUTE FALLBACK ====================
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Wishlist route not found",
  });
});

module.exports = router;