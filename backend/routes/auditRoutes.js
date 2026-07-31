// backend/routes/auditRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { auditService } = require('../services/auditService');

/**
 * GET /api/audit/logs
 * Get audit logs (admin only)
 */
router.get('/logs', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { action, resource, resourceId, actorId, fromDate, toDate, limit, offset } = req.query;
        const logs = await auditService.getLogs({
            action,
            resource,
            resourceId,
            actorId,
            fromDate,
            toDate,
            limit: parseInt(limit) || 100,
            offset: parseInt(offset) || 0
        });

        res.json({
            success: true,
            data: logs,
            count: logs.length
        });
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get audit logs'
        });
    }
});

/**
 * GET /api/audit/statistics
 * Get audit statistics (admin only)
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await auditService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Get statistics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

/**
 * GET /api/audit/actions
 * Get all audit actions
 */
router.get('/actions', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: AUDIT_ACTIONS
    });
});

/**
 * GET /api/audit/resources
 * Get all audit resources
 */
router.get('/resources', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: AUDIT_RESOURCES
    });
});

module.exports = router;