// backend/routes/aiFeedRoutes.js
const express = require('express');
const router = express.Router();
const aiFeedController = require('../controllers/aiFeedController');

/**
 * GET /api/ai-feed/products
 * Get product feed for AI agents
 */
router.get('/products', aiFeedController.getProducts);

/**
 * GET /api/ai-feed/product/:id
 * Get single product for AI agents
 */
router.get('/product/:id', aiFeedController.getProduct);

/**
 * GET /api/ai-feed/sitemap
 * Get sitemap for AI agents
 */
router.get('/sitemap', aiFeedController.getSitemap);

/**
 * GET /api/ai-feed/categories
 * Get categories for AI agents
 */
router.get('/categories', aiFeedController.getCategories);

module.exports = router;