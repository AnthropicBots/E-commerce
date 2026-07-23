// backend/routes/refundRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
    detectAIGeneratedEvidence,
    validateVideoEvidence,
    generateTamperEvidence,
    verifyTamperEvidence,
    upload
} = require('../middleware/refundFraudMiddleware');
const db = require('../config/db').promise;

/**
 * POST /api/refund/request
 * Request refund with evidence
 */
router.post(
    '/request',
    authMiddleware,
    upload,
    detectAIGeneratedEvidence,
    validateVideoEvidence,
    generateTamperEvidence,
    async (req, res) => {
        try {
            const { orderId, productId, reason } = req.body;

            // Create refund request
            const [result] = await db.query(
                `INSERT INTO refund_requests 
                 (user_id, order_id, product_id, reason, evidence_files, 
                  detection_results, qr_data, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
                [
                    req.user.id,
                    orderId,
                    productId,
                    reason,
                    JSON.stringify(req.files.map(f => f.filename)),
                    JSON.stringify(req.detectionResults),
                    JSON.stringify(req.qrData)
                ]
            );

            res.json({
                success: true,
                message: 'Refund request submitted',
                requestId: result.insertId,
                qrData: req.qrData
            });
        } catch (error) {
            console.error('Refund request error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to submit refund request'
            });
        }
    }
);

/**
 * POST /api/refund/verify-tamper
 * Verify tamper-evident QR code
 */
router.post('/verify-tamper', authMiddleware, verifyTamperEvidence, (req, res) => {
    res.json({
        success: true,
        message: 'Tamper evidence verified',
        verification: req.qrVerification
    });
});

/**
 * GET /api/refund/alerts
 * Get fraud alerts (admin only)
 */
router.get('/alerts', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const [alerts] = await db.query(
            `SELECT * FROM refund_fraud_alerts 
             WHERE resolved = FALSE 
             ORDER BY confidence DESC 
             LIMIT 50`
        );

        res.json({
            success: true,
            data: alerts,
            count: alerts.length
        });
    } catch (error) {
        console.error('Alerts error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get alerts'
        });
    }
});

/**
 * POST /api/refund/alerts/:id/resolve
 * Resolve fraud alert (admin only)
 */
router.post('/alerts/:id/resolve', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { id } = req.params;
        const { notes } = req.body;

        await db.query(
            `UPDATE refund_fraud_alerts 
             SET resolved = TRUE, resolved_by = ?, resolution_notes = ? 
             WHERE id = ?`,
            [req.user.id, notes || 'Resolved', id]
        );

        res.json({
            success: true,
            message: 'Alert resolved successfully'
        });
    } catch (error) {
        console.error('Resolve error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resolve alert'
        });
    }
});

module.exports = router;