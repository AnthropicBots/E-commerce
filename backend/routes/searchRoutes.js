const express = require("express");
const router = express.Router();
const { searchProducts } = require("../controllers/searchController");

/**
 * GET /api/search?q=
 * Real-time product autocomplete search (Top 5 ordered by relevance)
 */
router.get("/", searchProducts);

module.exports = router;
