const express = require("express");
const router = express.Router();

const {
    getProducts,
    getSingleProduct,
    createProduct,
    updateProduct,
    DeleteeProduct,
    getProductSuggestions
} = require("../controllers/productController");

const authMiddleware = require("../middleware/authMiddleware");
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
router.get("/:id", getSingleProduct);

router.post("/", authMiddleware, authorizeRoles("admin"), validateCreateProduct, createProduct);

router.put("/:id", authMiddleware, authorizeRoles("admin"), validateUpdateProduct, updateProduct);

router.delete("/:id", authMiddleware, authorizeRoles("admin"), DeleteeProduct);

// Fallback
router.use((req, res) => {
    res.status(404).json({ success: false, message: "Product route not found" });
});

module.exports = router;