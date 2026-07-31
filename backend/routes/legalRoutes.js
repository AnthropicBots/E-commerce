const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/rbacMiddleware');
const {
    createNegotiation,
    getNegotiation,
    getAuditTrail,
    issueCertificate,
    verifyCertificate,
    checkCompliance,
    generateComplianceReport,
    exportAuditTrail,
    markAuditReady
} = require('../controllers/legalController');

const {
    checkLegalCompliance,
    requireCertificate,
    logLegalEvent,
    enforceAuditTrail
} = require('../middleware/legalCompliance');

// Protected routes
router.post('/negotiation', authMiddleware, createNegotiation);
router.get('/negotiation/:negotiationId', authMiddleware, getNegotiation);
router.get('/negotiation/:negotiationId/audit', authMiddleware, getAuditTrail);
router.get('/negotiation/:negotiationId/audit/export', authMiddleware, exportAuditTrail);
router.post('/negotiation/:negotiationId/certificate', authMiddleware, issueCertificate);
router.get('/certificate/:certificateId/verify', authMiddleware, verifyCertificate);
router.get('/negotiation/:negotiationId/compliance', authMiddleware, checkCompliance);
router.get('/negotiation/:negotiationId/compliance/report', authMiddleware, generateComplianceReport);
router.post('/negotiation/:negotiationId/audit-ready', authMiddleware, authorizeRoles('admin'), markAuditReady);

// Routes with compliance checks
router.post('/negotiation/:negotiationId/action', 
    authMiddleware,
    logLegalEvent,
    checkLegalCompliance,
    requireCertificate,
    enforceAuditTrail,
    (req, res) => {
        res.status(200).json({
            success: true,
            message: 'Action executed with legal compliance'
        });
    }
);

module.exports = router;