const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");

const {
    getProducts,
    getSingleProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    getProductSuggestions
} = require("../controllers/productController");

const {
    getProductReviews,
    createProductReview,
    deleteProductReview
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
router.get("/", getProducts);
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