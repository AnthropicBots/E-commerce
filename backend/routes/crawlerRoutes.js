// backend/routes/crawlerRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { crawlerService } = require('../services/aiCrawlerProtectionService');

/**
 * GET /api/crawler/status
 * Get crawler status
 */
router.get('/status', authMiddleware, (req, res) => {
    const status = crawlerService.getStatus();
    res.json({
        success: true,
        data: status
    });
});

/**
 * GET /api/crawler/blocked
 * Get blocked IPs (admin only)
 */
router.get('/blocked', authMiddleware, (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const blocked = crawlerService.getBlockedIPs();
        res.json({
            success: true,
            data: blocked
        });
    } catch (error) {
        console.error('Get blocked IPs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get blocked IPs'
        });
    }
});

/**
 * POST /api/crawler/block
 * Block an IP (admin only)
 */
router.post('/block', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { ip, reason } = req.body;

        if (!ip) {
            return res.status(400).json({
                success: false,
                error: 'IP address is required'
            });
        }

        await crawlerService.blockIP(ip, reason || 'Manual block');

        res.json({
            success: true,
            message: `IP ${ip} blocked successfully`
        });
    } catch (error) {
        console.error('Block IP error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to block IP'
        });
    }
});

/**
 * POST /api/crawler/unblock
 * Unblock an IP (admin only)
 */
router.post('/unblock', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { ip } = req.body;

        if (!ip) {
            return res.status(400).json({
                success: false,
                error: 'IP address is required'
            });
        }

        await crawlerService.unblockIP(ip);

        res.json({
            success: true,
            message: `IP ${ip} unblocked successfully`
        });
    } catch (error) {
        console.error('Unblock IP error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to unblock IP'
        });
    }
});

/**
 * GET /api/crawler/stats
 * Get crawler statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await crawlerService.getStatistics();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

module.exports = router;