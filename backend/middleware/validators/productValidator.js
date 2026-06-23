const { sanitizeString, safeNumber } = require("../../utils/helpers");

const validateCreateProduct = (req, res, next) => {
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
};

const validateUpdateProduct = (req, res, next) => {
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
};

module.exports = { validateCreateProduct, validateUpdateProduct };