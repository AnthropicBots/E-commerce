// backend/routes/ruleRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { ruleEngine, RULE_TYPES, OPERATORS } = require('../services/ruleEngineService');

/**
 * POST /api/rules
 * Create a new rule
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const rule = await ruleEngine.createRule(req.body);

        res.json({
            success: true,
            data: rule
        });
    } catch (error) {
        console.error('Create rule error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create rule'
        });
    }
});

/**
 * GET /api/rules
 * Get all rules
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { type, category, enabled } = req.query;
        const rules = ruleEngine.getAllRules({ type, category, enabled });

        res.json({
            success: true,
            data: rules,
            count: rules.length
        });
    } catch (error) {
        console.error('Get rules error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get rules'
        });
    }
});

/**
 * GET /api/rules/:id
 * Get rule by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const rule = ruleEngine.getRule(req.params.id);

        if (!rule) {
            return res.status(404).json({
                success: false,
                error: 'Rule not found'
            });
        }

        res.json({
            success: true,
            data: rule
        });
    } catch (error) {
        console.error('Get rule error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get rule'
        });
    }
});

/**
 * PUT /api/rules/:id
 * Update rule
 */
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const rule = await ruleEngine.updateRule(req.params.id, req.body);

        res.json({
            success: true,
            data: rule
        });
    } catch (error) {
        console.error('Update rule error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update rule'
        });
    }
});

/**
 * DELETE /api/rules/:id
 * Delete rule
 */
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const result = await ruleEngine.deleteRule(req.params.id);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Delete rule error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete rule'
        });
    }
});

/**
 * POST /api/rules/execute/:id
 * Execute a rule
 */
router.post('/execute/:id', authMiddleware, async (req, res) => {
    try {
        const { context } = req.body;

        if (!context) {
            return res.status(400).json({
                success: false,
                error: 'Context is required'
            });
        }

        const result = await ruleEngine.executeRule(req.params.id, context);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Execute rule error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to execute rule'
        });
    }
});

/**
 * POST /api/rules/execute/type/:type
 * Execute rules by type
 */
router.post('/execute/type/:type', authMiddleware, async (req, res) => {
    try {
        const { type } = req.params;
        const { context, priority } = req.body;

        if (!context) {
            return res.status(400).json({
                success: false,
                error: 'Context is required'
            });
        }

        const results = await ruleEngine.executeRulesByType(type, context, priority !== false);

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    } catch (error) {
        console.error('Execute rules by type error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to execute rules'
        });
    }
});

/**
 * GET /api/rules/types
 * Get rule types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: RULE_TYPES
    });
});

/**
 * GET /api/rules/operators
 * Get operators
 */
router.get('/operators', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: OPERATORS
    });
});

/**
 * GET /api/rules/statistics
 * Get rule statistics
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await ruleEngine.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Statistics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

module.exports = router;