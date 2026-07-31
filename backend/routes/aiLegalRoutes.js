// backend/routes/aiLegalRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const auditTrail = require('../services/aiAuditTrailService');
const { aiLegalFrameworkMiddleware, createCertificateOfAction } = require('../middleware/aiLegalFrameworkMiddleware');

/**
 * POST /api/ai-legal/negotiate
 * Negotiate with AI with legal framework
 */
router.post('/negotiate', authMiddleware, aiLegalFrameworkMiddleware, createCertificateOfAction, async (req, res) => {
    try {
        const { action, data } = req.body;

        // Log the negotiation
        const step = auditTrail.logNegotiationStep('completed', {
            action,
            data,
            certificate: req.certificate
        }, {
            userId: req.user.id,
            sessionId: req.auditSessionId
        });

        res.json({
            success: true,
            message: 'Negotiation completed with legal framework',
            sessionId: req.auditSessionId,
            certificate: req.certificate,
            step
        });
    } catch (error) {
        console.error('Negotiation error:', error);
        res.status(500).json({
            success: false,
            error: 'Negotiation failed'
        });
    }
});

/**
 * GET /api/ai-legal/audit/:sessionId
 * Get audit trail for a session
 */
router.get('/audit/:sessionId', authMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.params;

        const [logs] = await db.query(
            'SELECT * FROM ai_audit_logs WHERE session_id = ? ORDER BY timestamp ASC',
            [sessionId]
        );

        const [certificates] = await db.query(
            'SELECT * FROM ai_certificates WHERE session_id = ?',
            [sessionId]
        );

        res.json({
            success: true,
            sessionId,
            logs,
            certificates,
            count: logs.length
        });
    } catch (error) {
        console.error('Audit error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get audit trail'
        });
    }
});

/**
 * GET /api/ai-legal/certificate/:id
 * Get certificate details
 */
router.get('/certificate/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const [certificates] = await db.query(
            'SELECT * FROM ai_certificates WHERE id = ?',
            [id]
        );

        if (certificates.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Certificate not found'
            });
        }

        // Verify certificate
        const verification = await auditTrail.verifyCertificate(certificates[0]);

        res.json({
            success: true,
            certificate: certificates[0],
            verification,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Certificate error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get certificate'
        });
    }
});

/**
 * POST /api/ai-legal/certificate/:id/revoke
 * Revoke a certificate
 */
router.post('/certificate/:id/revoke', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const certificate = await auditTrail.revokeCertificate(id, reason || 'No reason provided');

        res.json({
            success: true,
            message: 'Certificate revoked successfully',
            certificate
        });
    } catch (error) {
        console.error('Revoke error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to revoke certificate'
        });
    }
});

/**
 * GET /api/ai-legal/compliance/:sessionId
 * Check compliance for a session
 */
router.get('/compliance/:sessionId', authMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.params;

        const compliance = await auditTrail.checkCompliance(sessionId);

        res.json({
            success: true,
            ...compliance,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Compliance error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check compliance'
        });
    }
});

/**
 * GET /api/ai-legal/report
 * Export audit report (admin only)
 */
router.get('/report', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'Start date and end date are required'
            });
        }

        const report = await auditTrail.exportReport(startDate, endDate);

        res.json({
            success: true,
            ...report,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export report'
        });
    }
});

/**
 * GET /api/ai-legal/stats
 * Get audit statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await auditTrail.getStatistics();

        res.json({
            success: true,
            ...stats,
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

module.exports = router;