const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");

const {
    getProducts,
    getSingleProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    getProductSuggestions,
    getCategoryTree,
    invalidateCategoryTreeCache
} = require("../controllers/productController");

const { validateProductReview } = require('../middleware/promptInjectionMiddleware');

// Update POST /api/products/review
router.post('/products/review', authMiddleware, validateProductReview, async (req, res) => {
  
});
const {
    getProductReviews,
    createProductReview,
    deleteProductReview,
    markReviewHelpful,
    unmarkReviewHelpful,
    reportReview,
    getReportReasons,
    getModerationQueue,
    getReviewReports,
    moderateReview
} = require("../controllers/reviewController");

const { authorizeRoles } = require("../middleware/rbacMiddleware");
const { validateCreateProduct, validateUpdateProduct } = require("../middleware/validators/productValidator");

// --------------------------------------------------------------
// Validate product ID
// --------------------------------------------------------------
router.param("id", (req, res, next, id) => {
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
router.get("/:id/reviews", getProductReviews);
router.post("/:id/review", authMiddleware, createProductReview);
router.delete(
    "/:id/reviews/:reviewId",
    authMiddleware,
    authorizeRoles("admin"),
    deleteProductReview
);

// ---------------------------------------------------------------------------
// Review engagement and moderation (#1349)
// ---------------------------------------------------------------------------
//
// The static "reviews/..." paths are declared BEFORE "/:id" below. Express
// matches in declaration order, so a parameterised product route placed first
// would capture "reviews" as a product id and 404 a perfectly valid request --
// the same trap that catches `/default` in every collection router.

/** Report reasons, so the client does not carry its own copy of the list. */
router.get("/reviews/moderation/reasons", getReportReasons);

/** Admin moderation queue: pending first, most-reported first. */
router.get(
    "/reviews/moderation/queue",
    authMiddleware,
    authorizeRoles("admin"),
    getModerationQueue
);

/** The reports filed against one review, so a moderator sees the case. */
router.get(
    "/reviews/:reviewId/reports",
    authMiddleware,
    authorizeRoles("admin"),
    getReviewReports
);

/** Approve or reject, recording who decided and why. */
router.patch(
    "/reviews/:reviewId/moderate",
    authMiddleware,
    authorizeRoles("admin"),
    moderateReview
);

/** Helpful votes. Authenticated: an anonymous vote is not a signal. */
router.post("/:id/reviews/:reviewId/helpful", authMiddleware, markReviewHelpful);
router.delete("/:id/reviews/:reviewId/helpful", authMiddleware, unmarkReviewHelpful);

/** Report a review for moderation. */
router.post("/:id/reviews/:reviewId/report", authMiddleware, reportReview);
router.get("/:id", getSingleProduct);

router.post("/", authMiddleware, authorizeRoles("admin"), validateCreateProduct, createProduct);
router.put("/:id", authMiddleware, authorizeRoles("admin"), validateUpdateProduct, updateProduct);
router.delete("/:id", authMiddleware, authorizeRoles("admin"), deleteProduct);

// Fallback
router.use((req, res) => {
    res.status(404).json({ success: false, message: "Product route not found" });
});

module.exports = router;
