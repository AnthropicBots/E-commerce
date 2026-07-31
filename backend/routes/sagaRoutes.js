// backend/routes/sagaRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { 
    sagaOrchestrator, 
    createCheckoutWorkflow 
} = require('../services/sagaOrchestratorService');

/**
 * POST /api/saga/checkout
 * Start checkout saga
 */
router.post('/checkout', authMiddleware, async (req, res) => {
    try {
        const { items, total, shippingAddress } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Items are required'
            });
        }

        // Create workflow
        const workflow = createCheckoutWorkflow();

        // Create saga
        const saga = await sagaOrchestrator.createSaga(workflow, {
            userId: req.user.id,
            items,
            total,
            shippingAddress,
            email: req.user.email
        });

        // Execute saga asynchronously
        sagaOrchestrator.executeSaga(saga.id).catch(error => {
            console.error('Saga execution error:', error);
        });

        res.json({
            success: true,
            data: {
                sagaId: saga.id,
                status: saga.status,
                message: 'Checkout initiated'
            }
        });
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to start checkout'
        });
    }
});

/**
 * GET /api/saga/:sagaId/status
 * Get saga status
 */
router.get('/:sagaId/status', authMiddleware, async (req, res) => {
    try {
        const { sagaId } = req.params;
        const status = sagaOrchestrator.getSagaStatus(sagaId);

        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'Saga not found'
            });
        }

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get saga status'
        });
    }
});

/**
 * GET /api/saga/:sagaId/results
 * Get saga results
 */
router.get('/:sagaId/results', authMiddleware, async (req, res) => {
    try {
        const { sagaId } = req.params;
        const results = sagaOrchestrator.getSagaResults(sagaId);

        if (!results) {
            return res.status(404).json({
                success: false,
                error: 'Saga not found'
            });
        }

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Results error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get saga results'
        });
    }
});

/**
 * POST /api/saga/:sagaId/cancel
 * Cancel saga
 */
router.post('/:sagaId/cancel', authMiddleware, async (req, res) => {
    try {
        const { sagaId } = req.params;
        const saga = sagaOrchestrator.sagas.get(sagaId);

        if (!saga) {
            return res.status(404).json({
                success: false,
                error: 'Saga not found'
            });
        }

        if (saga.status === SAGA_STATUS.COMPLETED) {
            return res.status(400).json({
                success: false,
                error: 'Saga already completed'
            });
        }

        // Cancel by compensating
        await sagaOrchestrator.compensateSaga(saga, saga.currentStep);

        res.json({
            success: true,
            message: 'Saga cancelled',
            data: { sagaId, status: saga.status }
        });
    } catch (error) {
        console.error('Cancel error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cancel saga'
        });
    }
});

/**
 * GET /api/saga/stats
 * Get saga statistics (admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const stats = await sagaOrchestrator.getStatistics();

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