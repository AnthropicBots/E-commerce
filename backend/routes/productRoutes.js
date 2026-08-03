const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
// Public reads that still want to know who is asking, when somebody is signed
// in -- used to render a vote button as already-pressed (#1353).
const { optionalAuth } = require("../middleware/authMiddleware");

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
const { ROLES } = require("../config/policy");
const { requireOwnership, ownerFromTable } = require("../middleware/requireOwnership");
const uuidParam = require("../middleware/uuidParam");

// Product Q&A (#1353).
const productQA = require("../controllers/productQAController");
const { validateCreateProduct, validateUpdateProduct } = require("../middleware/validators/productValidator");

// A review belongs to the account that wrote it. Deleting one was restricted
// to staff, which left an author with no way to retract their own words;
// staff keep the access they had through the privileged bypass.
const ownsReview = requireOwnership(
    ownerFromTable({ table: "reviews", param: "reviewId" }),
    { resourceName: "Review" }
);

// --------------------------------------------------------------
// Validate product ID
// --------------------------------------------------------------
//
// `products.id` is a CHAR(36) UUID. This guard used to run the segment through
// `parseInt`, which rejected every UUID beginning with a hex letter -- roughly
// 37% of them -- and let the rest through on a truncated number that was never
// the id (#1443). See middleware/uuidParam.js for the whole story.
router.param("id", uuidParam({ resourceName: "Product", attachAs: "productId" }));

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
    authorizeRoles(ROLES.ADMIN),
    invalidateCategoryTreeCache
);
router.get("/", getProducts);
router.get("/:id/reviews", getProductReviews);
router.post("/:id/review", authMiddleware, createProductReview);
router.delete(
    "/:id/reviews/:reviewId",
    authMiddleware,
    ownsReview,
    deleteProductReview
);
// ---------------------------------------------------------------------------
// Product Q&A (#1353)
// ---------------------------------------------------------------------------
//
// The static "questions/", "answers/" and "qa/" paths are declared BEFORE
// "/:id" -- Express matches in declaration order, so the parameterised product
// route would otherwise capture "questions" as a product id.
//
// Note the asymmetry with reviews, and that it is deliberate: POST /questions
// carries no purchase check. `createProductReview` refuses anyone without a
// `delivered` order, which is right for reviews and is exactly why
// pre-purchase questions had nowhere to go.

/** Public: questions and their answers for a product. */
router.get("/:id/questions", optionalAuth, productQA.listQuestions);

/** Anyone signed in may ask. */
router.post("/:id/questions", authMiddleware, productQA.askQuestion);

/** Anyone signed in may answer; standing is resolved server-side. */
router.post(
    "/questions/:questionId/answers",
    authMiddleware,
    productQA.answerQuestion
);

/** Helpful votes and reports, on questions and on answers. */
router.post("/questions/:questionId/helpful", authMiddleware, productQA.voteQuestion);
router.delete("/questions/:questionId/helpful", authMiddleware, productQA.unvoteQuestion);
router.post("/questions/:questionId/report", authMiddleware, productQA.reportQuestion);

router.post("/answers/:answerId/helpful", authMiddleware, productQA.voteAnswer);
router.delete("/answers/:answerId/helpful", authMiddleware, productQA.unvoteAnswer);
router.post("/answers/:answerId/report", authMiddleware, productQA.reportAnswer);

/** Admin moderation: questions and answers in one queue. */
router.get(
    "/qa/moderation/queue",
    authMiddleware,
    authorizeRoles(ROLES.ADMIN),
    productQA.getModerationQueue
);

router.patch(
    "/qa/:targetType/:targetId/moderate",
    authMiddleware,
    authorizeRoles(ROLES.ADMIN),
    productQA.moderate
);

router.delete(
    "/qa/:targetType/:targetId",
    authMiddleware,
    authorizeRoles(ROLES.ADMIN),
    productQA.removeItem
);

router.get("/:id", getSingleProduct);

router.post("/", authMiddleware, authorizeRoles(ROLES.ADMIN), validateCreateProduct, createProduct);
router.put("/:id", authMiddleware, authorizeRoles(ROLES.ADMIN), validateUpdateProduct, updateProduct);
router.delete("/:id", authMiddleware, authorizeRoles(ROLES.ADMIN), deleteProduct);

// Fallback
router.use((req, res) => {
    res.status(404).json({ success: false, message: "Product route not found" });
});

module.exports = router;
