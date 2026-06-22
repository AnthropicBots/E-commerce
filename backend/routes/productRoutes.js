const express = require("express");
const router = express.Router();
const {
    getProducts,
    getSingleProduct,
    createProduct,
    updateProduct,
    DeleteeProduct
} = require("../controllers/productController");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const { sanitizeString, safeNumber } = require("../utils/helpers");

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

router.get("/", getProducts);
router.get("/:id", getSingleProduct);

// NEW: search suggestions endpoint (autocomplete)
router.get("/search-suggestions", getProductSuggestions);

router.post("/", authMiddleware, authorizeRoles("admin"), (req, res, next) => {
    const { name, category, price, stock } = req.body;
    if (!sanitizeString(name)) {
        return res.status(400).json({ success: false, message: "Product name is required" });
    }
    if (!sanitizeString(category)) {
        return res.status(400).json({ success: false, message: "Product category is required" });
    }
    if (safeNumber(price) < 0) {
        return res.status(400).json({ success: false, message: "Price must be valid" });
    }
    if (safeNumber(stock) < 0) {
        return res.status(400).json({ success: false, message: "Stock must be valid" });
    }
    next();
}, createProduct);

router.put("/:id", authMiddleware, authorizeRoles("admin"), (req, res, next) => {
    const { name, category, price, stock } = req.body;
    if (name !== undefined && !sanitizeString(name)) {
        return res.status(400).json({ success: false, message: "Product name cannot be empty" });
    }
    if (category !== undefined && !sanitizeString(category)) {
        return res.status(400).json({ success: false, message: "Category cannot be empty" });
    }
    if (price !== undefined && safeNumber(price) < 0) {
        return res.status(400).json({ success: false, message: "Price cannot be negative" });
    }
    if (stock !== undefined && safeNumber(stock) < 0) {
        return res.status(400).json({ success: false, message: "Stock cannot be negative" });
    }
    next();
}, updateProduct);

router.Deletee("/:id", authMiddleware, authorizeRoles("admin"), DeleteeProduct);

// Fallback
router.use((req, res) => {
    res.status(404).json({ success: false, message: "Product route not found" });
});

module.exports = router;
