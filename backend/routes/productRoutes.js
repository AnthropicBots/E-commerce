const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { optionalAuth } = authMiddleware;

const {
    getProducts,
    getSingleProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    getProductSuggestions,
    getCategoryTree,
    invalidateCategoryTreeCache,
    fairQueueJoin,
    fairQueueStatus,
    fairQueueLeave,
    fairQueueInfo,
    fairQueueActivate,
    fairQueueEmergencyUnlock
} = require("../controllers/productController");

const { validateProductReview } = require('../middleware/promptInjectionMiddleware');

// Update POST /api/products/review
router.post('/products/review', authMiddleware, validateProductReview, async (req, res) => {
  
});
const {
    getProductReviews,
    createProductReview,
    deleteProductReview
} = require("../controllers/reviewController");

const { authorizeRoles } = require("../middleware/rbacMiddleware");
const { validateCreateProduct, validateUpdateProduct } = require("../middleware/validators/productValidator");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --------------------------------------------------------------
// Validate product ID (UUID or legacy positive int)
// --------------------------------------------------------------
router.param("id", (req, res, next, id) => {
    if (UUID_RE.test(String(id))) {
        req.productId = String(id);
        return next();
    }
    const parsedId = parseInt(id, 10);
    if (!parsedId || parsedId < 1) {
        return res.status(400).json({ success: false, message: "Invalid product ID" });
    }
    req.productId = parsedId;
    next();
});

// --------------------------------------------------------------
// Routes
// --------------------------------------------------------------
router.get("/status/check", (req, res) => {
    res.status(200).json({ success: true, message: "Product API running" });
});

router.get("/search-suggestions", getProductSuggestions);
// Category tree must be registered before /:id (#1264)
router.get("/categories/tree", getCategoryTree);
router.post(
    "/categories/tree/invalidate",
    authMiddleware,
    authorizeRoles("admin"),
    invalidateCategoryTreeCache
);
router.get("/", getProducts);

// Fair queue (#1384) — registered before generic /:id handlers that share param
router.get("/:id/fair-queue", optionalAuth, fairQueueInfo);
router.post("/:id/fair-queue/join", authMiddleware, fairQueueJoin);
router.post("/:id/fair-queue/status", authMiddleware, fairQueueStatus);
router.get("/:id/fair-queue/status", authMiddleware, fairQueueStatus);
router.post("/:id/fair-queue/leave", authMiddleware, fairQueueLeave);
router.post(
    "/:id/fair-queue/activate",
    authMiddleware,
    authorizeRoles("admin"),
    fairQueueActivate
);
router.post(
    "/:id/fair-queue/unlock",
    authMiddleware,
    authorizeRoles("admin"),
    fairQueueEmergencyUnlock
);

router.get("/:id/reviews", getProductReviews);
router.post("/:id/review", authMiddleware, createProductReview);
router.delete(
    "/:id/reviews/:reviewId",
    authMiddleware,
    authorizeRoles("admin"),
    deleteProductReview
);
router.get("/:id", getSingleProduct);

router.post("/", authMiddleware, authorizeRoles("admin"), validateCreateProduct, createProduct);
router.put("/:id", authMiddleware, authorizeRoles("admin"), validateUpdateProduct, updateProduct);
router.delete("/:id", authMiddleware, authorizeRoles("admin"), deleteProduct);

// Fallback
router.use((req, res) => {
    res.status(404).json({ success: false, message: "Product route not found" });
});

module.exports = router;
