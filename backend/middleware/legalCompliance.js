const ComplianceService = require('../services/complianceService');
const AuditTrailService = require('../services/auditTrialService')
const CertificateService = require('../services/certificateService');

/**
 * Check legal compliance before negotiation
 */
const checkLegalCompliance = async (req, res, next) => {
    try {
        const { negotiationId, framework } = req.body;

        if (!negotiationId) {
            return next();
        }

        const complianceRecord = await ComplianceService.checkCompliance(
            negotiationId,
            framework || 'gdpr'
        );

        // Block if non-compliant
        if (complianceRecord.status === 'non_compliant') {
            return res.status(403).json({
                error: 'Transaction blocked - Legal compliance failed',
                details: complianceRecord.checks.filter(c => !c.passed),
                riskLevel: complianceRecord.riskLevel
            });
        }

        req.complianceRecord = complianceRecord;
        next();
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Require certificate of action
 */
const requireCertificate = async (req, res, next) => {
    try {
        const { negotiationId, agentId, action } = req.body;

        // Check if certificate exists
        const certificates = await CertificateService.getNegotiationCertificates(negotiationId);
        
        if (!certificates || certificates.length === 0) {
            return res.status(403).json({
                error: 'Certificate of Action required',
                required: true
            });
        }

        // Check if certificate is valid
        const latestCertificate = certificates[0];
        const verification = await CertificateService.verifyCertificate(
            latestCertificate.certificateId
        );

        if (!verification.isValid || verification.isExpired) {
            return res.status(403).json({
                error: 'Invalid or expired certificate',
                certificateId: latestCertificate.certificateId
            });
        }

        req.certificate = latestCertificate;
        next();
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Log all legal events for audit
 */
const logLegalEvent = async (req, res, next) => {
    try {
        const { negotiationId } = req.params || req.body;

        if (negotiationId) {
            await AuditTrailService.logEvent(
                negotiationId,
                'legal_event',
                {
                    endpoint: req.originalUrl,
                    method: req.method,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                },
                req.user?.id || 'system'
            );
        }
        next();
    } catch (error) {
        console.error('Error logging legal event:', error);
        next();
    }
};

/**
 * Enforce audit trail
 */
const enforceAuditTrail = async (req, res, next) => {
    try {
        const { negotiationId } = req.params;

        if (negotiationId) {
            const auditTrail = await AuditTrailService.getAuditTrail(negotiationId);
            
            // Check if audit trail exists
            if (!auditTrail || auditTrail.total === 0) {
                return res.status(403).json({
                    error: 'Audit trail required for this operation'
                });
            }
        }
        next();
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

module.exports = {
    checkLegalCompliance,
    requireCertificate,
    logLegalEvent,
    enforceAuditTrail
};