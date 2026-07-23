const Negotiation = require('../models/Negotiation');
const AuditTrailService = require('../services/auditTrialService');
const CertificateService = require('../services/certificateService');
const ComplianceService = require('../services/complianceService');

/**
 * Create negotiation
 */
exports.createNegotiation = async (req, res) => {
    try {
        const negotiationData = {
            ...req.body,
            agentId: req.body.agentId || req.user?.id,
            status: 'initiated',
            legalStatus: 'pending_review'
        };

        const negotiation = new Negotiation(negotiationData);
        await negotiation.save();

        // Log audit event
        await AuditTrailService.logEvent(
            negotiation.negotiationId,
            'negotiation_created',
            {
                product: negotiation.product,
                initialPrice: negotiation.initialPrice,
                counterparty: negotiation.counterparty
            },
            req.user?.id || 'system'
        );

        res.status(201).json({
            success: true,
            data: negotiation,
            message: 'Negotiation created'
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Get negotiation
 */
exports.getNegotiation = async (req, res) => {
    try {
        const { negotiationId } = req.params;

        const negotiation = await Negotiation.findOne({ negotiationId });
        if (!negotiation) {
            return res.status(404).json({
                error: 'Negotiation not found'
            });
        }

        res.status(200).json({
            success: true,
            data: negotiation
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Get audit trail
 */
exports.getAuditTrail = async (req, res) => {
    try {
        const { negotiationId } = req.params;
        const { limit = 100, offset = 0 } = req.query;

        const auditTrail = await AuditTrailService.getAuditTrail(negotiationId, {
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.status(200).json({
            success: true,
            data: auditTrail
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Issue certificate
 */
exports.issueCertificate = async (req, res) => {
    try {
        const { negotiationId } = req.params;
        const { action, details } = req.body;

        const certificate = await CertificateService.issueCertificate(
            negotiationId,
            req.body.agentId || req.user?.id,
            action,
            details
        );

        res.status(201).json({
            success: true,
            data: certificate,
            message: 'Certificate issued'
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Verify certificate
 */
exports.verifyCertificate = async (req, res) => {
    try {
        const { certificateId } = req.params;

        const verification = await CertificateService.verifyCertificate(certificateId);

        res.status(200).json({
            success: true,
            data: verification
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Check compliance
 */
exports.checkCompliance = async (req, res) => {
    try {
        const { negotiationId } = req.params;
        const { framework } = req.query;

        const compliance = await ComplianceService.checkCompliance(
            negotiationId,
            framework || 'gdpr'
        );

        res.status(200).json({
            success: true,
            data: compliance
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Generate compliance report
 */
exports.generateComplianceReport = async (req, res) => {
    try {
        const { negotiationId } = req.params;

        const report = await ComplianceService.generateComplianceReport(negotiationId);

        res.status(200).json({
            success: true,
            data: report
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Export audit trail
 */
exports.exportAuditTrail = async (req, res) => {
    try {
        const { negotiationId } = req.params;
        const { format = 'json' } = req.query;

        const exportData = await AuditTrailService.exportAuditTrail(negotiationId, format);

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.send(exportData);
        } else if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.send(exportData);
        } else {
            res.status(200).json({
                success: true,
                data: exportData
            });
        }
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};

/**
 * Mark audit ready
 */
exports.markAuditReady = async (req, res) => {
    try {
        const { negotiationId } = req.params;

        await ComplianceService.markAuditReady(negotiationId);

        res.status(200).json({
            success: true,
            message: 'Negotiation marked as audit ready'
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
};