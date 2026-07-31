// backend/routes/versionRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { 
    semanticVersionService,
    VERSION_TYPES,
    VERSION_STATUS
} = require('../services/semanticVersionService');

/**
 * GET /api/versions/modules
 * Get all modules
 */
router.get('/modules', authMiddleware, async (req, res) => {
    try {
        const modules = Array.from(semanticVersionService.modules.values());

        res.json({
            success: true,
            data: modules,
            count: modules.length
        });
    } catch (error) {
        console.error('Get modules error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get modules'
        });
    }
});

/**
 * GET /api/versions/modules/:name
 * Get module by name
 */
router.get('/modules/:name', authMiddleware, async (req, res) => {
    try {
        const module = semanticVersionService.modules.get(req.params.name);

        if (!module) {
            return res.status(404).json({
                success: false,
                error: 'Module not found'
            });
        }

        res.json({
            success: true,
            data: module
        });
    } catch (error) {
        console.error('Get module error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get module'
        });
    }
});

/**
 * POST /api/versions/register
 * Register a new version (admin only)
 */
router.post('/register', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { moduleName, version, data } = req.body;

        if (!moduleName || !version) {
            return res.status(400).json({
                success: false,
                error: 'Module name and version are required'
            });
        }

        const versionInfo = await semanticVersionService.registerVersion(
            moduleName,
            version,
            data
        );

        res.json({
            success: true,
            data: versionInfo
        });
    } catch (error) {
        console.error('Register version error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to register version'
        });
    }
});

/**
 * GET /api/versions/compatibility
 * Check compatibility between modules
 */
router.get('/compatibility', authMiddleware, async (req, res) => {
    try {
        const { source, target, sourceVersion, targetVersion } = req.query;

        if (!source || !target) {
            return res.status(400).json({
                success: false,
                error: 'Source and target modules are required'
            });
        }

        const result = semanticVersionService.checkCompatibility(
            source,
            target,
            sourceVersion,
            targetVersion
        );

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Compatibility error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check compatibility'
        });
    }
});

/**
 * GET /api/versions/graph
 * Get dependency graph
 */
router.get('/graph', authMiddleware, async (req, res) => {
    try {
        const graph = semanticVersionService.getDependencyGraph();

        res.json({
            success: true,
            data: graph
        });
    } catch (error) {
        console.error('Graph error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dependency graph'
        });
    }
});

/**
 * GET /api/versions/history/:module
 * Get version history for a module
 */
router.get('/history/:module', authMiddleware, async (req, res) => {
    try {
        const { module } = req.params;
        const history = semanticVersionService.versionHistory
            .filter(v => v.moduleName === module)
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get version history'
        });
    }
});

/**
 * GET /api/versions/types
 * Get version types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: VERSION_TYPES
    });
});

/**
 * GET /api/versions/statuses
 * Get version statuses
 */
router.get('/statuses', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: VERSION_STATUS
    });
});

/**
 * POST /api/versions/scan
 * Trigger module scan (admin only)
 */
router.post('/scan', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await semanticVersionService.scanModules();

        res.json({
            success: true,
            message: 'Module scan triggered'
        });
    } catch (error) {
        console.error('Scan error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to scan modules'
        });
    }
});

/**
 * GET /api/versions/stats
 * Get version statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await semanticVersionService.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

module.exports = router;