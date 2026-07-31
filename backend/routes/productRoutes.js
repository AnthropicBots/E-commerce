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
    deleteProductReview
} = require("../controllers/reviewController");

const { authorizeRoles } = require("../middleware/rbacMiddleware");

// Product Q&A (#1353).
const productQA = require("../controllers/productQAController");
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
    authorizeRoles("admin"),
    productQA.getModerationQueue
);

router.patch(
    "/qa/:targetType/:targetId/moderate",
    authMiddleware,
    authorizeRoles("admin"),
    productQA.moderate
);

router.delete(
    "/qa/:targetType/:targetId",
    authMiddleware,
    authorizeRoles("admin"),
    productQA.removeItem
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
