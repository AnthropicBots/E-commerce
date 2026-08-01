// backend/routes/puppeteerRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { pool, scrapeProductPage, scrapeProductList } = require('../services/puppeteerPoolService');

/**
 * POST /api/puppeteer/scrape
 * Scrape a single URL
 */
router.post('/scrape', authMiddleware, async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        const result = await scrapeProductPage(url);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to scrape URL'
        });
    }
});

/**
 * POST /api/puppeteer/scrape-batch
 * Scrape multiple URLs
 */
router.post('/scrape-batch', authMiddleware, async (req, res) => {
    try {
        const { urls } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'URLs array is required'
            });
        }

        const results = await scrapeProductList(urls);

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Batch scrape error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to scrape URLs'
        });
    }
});

/**
 * GET /api/puppeteer/status
 * Get pool status
 */
router.get('/status', authMiddleware, (req, res) => {
    const status = pool.getStatus();
    res.json({
        success: true,
        data: status
    });
});

/**
 * GET /api/puppeteer/instances
 * Get instance details
 */
router.get('/instances', authMiddleware, (req, res) => {
    const instances = pool.getInstanceDetails();
    res.json({
        success: true,
        data: instances
    });
});

/**
 * POST /api/puppeteer/cleanup
 * Force cleanup idle instances
 */
router.post('/cleanup', authMiddleware, async (req, res) => {
    try {
        await pool.cleanupIdleInstances();
        res.json({
            success: true,
            message: 'Cleanup completed'
        });
    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cleanup instances'
        });
    }
});

/**
 * POST /api/puppeteer/execute
 * Execute custom task with pool
 */
router.post('/execute', authMiddleware, async (req, res) => {
    try {
        const { task, url } = req.body;

        if (!task) {
            return res.status(400).json({
                success: false,
                error: 'Task function is required'
            });
        }

        // Note: In production, you'd need to safely evaluate the task
        // This is a simplified example
        const result = await pool.execute(async (page) => {
            if (url) {
                await page.goto(url);
            }
            // Execute custom task
            return { success: true, data: 'Task executed' };
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Execute task error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to execute task'
        });
    }
});

module.exports = router;