// backend/routes/graphRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { knowledgeGraphService, NODE_TYPES } = require('../services/knowledgeGraphService');

/**
 * POST /api/graph/build
 * Build knowledge graph (admin only)
 */
router.post('/build', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        await knowledgeGraphService.buildGraph();

        res.json({
            success: true,
            message: 'Graph built successfully',
            data: {
                nodes: knowledgeGraphService.graph.nodes.length,
                edges: knowledgeGraphService.graph.edges.length
            }
        });
    } catch (error) {
        console.error('Build graph error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to build graph'
        });
    }
});

/**
 * GET /api/graph
 * Get full graph
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const graph = knowledgeGraphService.exportGraph();

        res.json({
            success: true,
            data: graph
        });
    } catch (error) {
        console.error('Get graph error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get graph'
        });
    }
});

/**
 * GET /api/graph/visualization
 * Get graph for visualization
 */
router.get('/visualization', authMiddleware, async (req, res) => {
    try {
        const graph = knowledgeGraphService.getVisualizationGraph();

        res.json({
            success: true,
            data: graph
        });
    } catch (error) {
        console.error('Get visualization error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get visualization'
        });
    }
});

/**
 * GET /api/graph/nodes/:id
 * Get node by ID
 */
router.get('/nodes/:id', authMiddleware, async (req, res) => {
    try {
        const node = knowledgeGraphService.getNode(req.params.id);

        if (!node) {
            return res.status(404).json({
                success: false,
                error: 'Node not found'
            });
        }

        const neighbors = knowledgeGraphService.getNeighbors(req.params.id);

        res.json({
            success: true,
            data: {
                node,
                neighbors
            }
        });
    } catch (error) {
        console.error('Get node error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get node'
        });
    }
});

/**
 * GET /api/graph/path
 * Get path between two nodes
 */
router.get('/path', authMiddleware, async (req, res) => {
    try {
        const { source, target } = req.query;

        if (!source || !target) {
            return res.status(400).json({
                success: false,
                error: 'Source and target nodes are required'
            });
        }

        const paths = knowledgeGraphService.getPath(source, target);

        res.json({
            success: true,
            data: paths
        });
    } catch (error) {
        console.error('Get path error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get path'
        });
    }
});

/**
 * GET /api/graph/types
 * Get node types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: NODE_TYPES
    });
});

/**
 * GET /api/graph/statistics
 * Get graph statistics
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        const stats = await knowledgeGraphService.getStatistics();

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

/**
 * GET /api/graph/status
 * Get graph service status
 */
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = knowledgeGraphService.getStatus();

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get status'
        });
    }
});

module.exports = router;