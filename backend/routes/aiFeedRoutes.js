// backend/routes/aiFeedRoutes.js
const express = require('express');
const router = express.Router();

const aiProductFeed = require('../services/aiProductFeedService');
const aiFeedController = require('../controllers/aiFeedController');


/**
 * GET /api/ai-feed/products
 * Get product feed for AI agents
 */
router.get('/products', async (req, res) => {
    try {
        const { category, minPrice, maxPrice, limit, offset, sort, inStock } = req.query;

        const feed = await aiProductFeed.generateFeed({
            category,
            minPrice,
            maxPrice,
            limit: parseInt(limit) || 100,
            offset: parseInt(offset) || 0,
            sort,
            inStock: inStock !== 'false'
        });

        res.json({
            success: true,
            data: feed,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Feed error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate feed'
        });
    }
});

/**
 * GET /api/ai-feed/product/:id
 * Get single product with structured data
 */
router.get('/product/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [products] = await db.query(
            'SELECT * FROM products WHERE id = ?',
            [id]
        );

        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        const product = products[0];
        const structuredData = aiProductFeed.generateStructuredData(product);

        res.json({
            success: true,
            data: product,
            structuredData: structuredData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get product'
        });
    }
});

/**
 * GET /api/ai-feed/structured-data/:id
 * Get JSON-LD structured data only
 */
router.get('/structured-data/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [products] = await db.query(
            'SELECT * FROM products WHERE id = ?',
            [id]
        );

        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        const structuredData = aiProductFeed.generateStructuredData(products[0]);

        res.json({
            success: true,
            data: structuredData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Structured data error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get structured data'
        });
    }
});

/**
 * GET /api/ai-feed/sitemap
 * Get sitemap
 */
router.get('/sitemap', async (req, res) => {
    try {
        const urls = await aiProductFeed.generateSitemap();
        const xml = aiProductFeed.generateXMLSitemap(urls);

        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        console.error('Sitemap error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate sitemap'
        });
    }
});

/**
 * GET /api/ai-feed/sitemap/json
 * Get sitemap as JSON
 */
router.get('/sitemap/json', async (req, res) => {
    try {
        const urls = await aiProductFeed.generateSitemap();

        res.json({
            success: true,
            data: urls,
            count: urls.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Sitemap JSON error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate sitemap'
        });
    }
});

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
router.get('/categories', async (req, res) => {
    try {
        const [categories] = await db.query(
            `SELECT DISTINCT category, COUNT(*) as product_count 
             FROM products 
             WHERE stock > 0 
             GROUP BY category
             ORDER BY product_count DESC`
        );

        res.json({
            success: true,
            data: categories,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Categories error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get categories'
        });
    }
});

/**
 * GET /api/ai-feed/search
 * Search products for AI agents
 */
router.get('/search', async (req, res) => {
    try {
        const { q, limit = 20 } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Search query must be at least 2 characters'
            });
        }

        const [products] = await db.query(
            `SELECT id, name, description, price, image_url, category
             FROM products 
             WHERE stock > 0 
             AND (name LIKE ? OR description LIKE ? OR category LIKE ?)
             LIMIT ?`,
            [`%${q}%`, `%${q}%`, `%${q}%`, parseInt(limit) || 20]
        );

        res.json({
            success: true,
            data: products,
            query: q,
            count: products.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search products'
        });
    }
});

/**
 * GET /api/ai-feed/stats
 * Get feed statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await aiProductFeed.getStatistics();

        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

/**
 * GET /api/ai-feed/health
 * Health check
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'operational',
        endpoints: {
            products: '/api/ai-feed/products',
            product: '/api/ai-feed/product/:id',
            structuredData: '/api/ai-feed/structured-data/:id',
            sitemap: '/api/ai-feed/sitemap',
            categories: '/api/ai-feed/categories',
            search: '/api/ai-feed/search'
        },
        timestamp: new Date().toISOString()
    });
});

router.get('/categories', aiFeedController.getCategories);


module.exports = router;