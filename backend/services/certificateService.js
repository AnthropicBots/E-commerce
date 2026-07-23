const CertificateOfAction = require('../models/CertificateOfAction');
const Negotiation = require('../models/Negotiation');
const crypto = require('crypto');

class CertificateService {
    /**
     * Issue certificate of action
     */
    async issueCertificate(negotiationId, agentId, action, details) {
        const negotiation = await Negotiation.findOne({ negotiationId });
        if (!negotiation) {
            throw new Error('Negotiation not found');
        }

        // Get agent identity
        const AgentIdentity = require('../models/AgentIdentity');
        const agent = await AgentIdentity.findOne({ agentId });
        if (!agent) {
            throw new Error('Agent not found');
        }

        // Create certificate
        const certificate = new CertificateOfAction({
            negotiationId,
            agentId,
            action,
            summary: this.generateSummary(negotiation, action),
            details: details || {
                product: negotiation.product,
                price: negotiation.finalPrice,
                counterparty: negotiation.counterparty
            },
            publicKey: agent.publicKey,
            issuedAt: new Date()
        });

        // Generate hash
        certificate.generateHash();

        // Sign with agent's private key
        const signature = agent.sign(certificate.hash);
        certificate.signature = signature;

        // Verify signature
        const isValid = certificate.verify(agent.publicKey);
        if (!isValid) {
            throw new Error('Signature verification failed');
        }

        certificate.verified = true;
        certificate.verifiedAt = new Date();

        await certificate.save();

        // Log audit event
        const AuditTrailService = require('./auditTrialService');
        await AuditTrailService.logEvent(
            negotiationId,
            'certificate_issued',
            { certificateId: certificate.certificateId, action },
            'system'
        );

        return certificate;
    }

    /**
     * Generate summary for certificate
     */
    generateSummary(negotiation, action) {
        return `Certificate of Action #${negotiation.negotiationId}: ${action} - ${negotiation.product} at ${negotiation.finalPrice}`;
    }

    /**
     * Verify certificate
     */
    async verifyCertificate(certificateId) {
        const certificate = await CertificateOfAction.findOne({ certificateId });
        if (!certificate) {
            throw new Error('Certificate not found');
        }

        // Verify signature
        const isValid = certificate.verify(certificate.publicKey);
        
        if (isValid) {
            certificate.verified = true;
            certificate.verifiedAt = new Date();
            await certificate.save();
        }

        return {
            certificateId: certificate.certificateId,
            isValid,
            issuedAt: certificate.issuedAt,
            expiresAt: certificate.expiresAt,
            isExpired: new Date() > certificate.expiresAt,
            summary: certificate.summary
        };
    }

    /**
     * Get certificate by ID
     */
    async getCertificate(certificateId) {
        const certificate = await CertificateOfAction.findOne({ certificateId })
            .select('-signature');

        if (!certificate) {
            throw new Error('Certificate not found');
        }

        return certificate;
    }

    /**
     * Get certificates for negotiation
     */
    async getNegotiationCertificates(negotiationId) {
        const certificates = await CertificateOfAction.find({ negotiationId })
            .select('-signature')
            .sort({ issuedAt: -1 });

        return certificates;
    }

    /**
     * Revoke certificate
     */
    async revokeCertificate(certificateId, reason) {
        const certificate = await CertificateOfAction.findOne({ certificateId });
        if (!certificate) {
            throw new Error('Certificate not found');
        }

        certificate.expiresAt = new Date();
        certificate.metadata = {
            ...certificate.metadata,
            revoked: true,
            revokedAt: new Date(),
            revokedReason: reason
        };

        await certificate.save();

        return certificate;
    }

    /**
     * Export certificate
     */
    async exportCertificate(certificateId, format = 'json') {
        const certificate = await this.getCertificate(certificateId);
        const verification = await this.verifyCertificate(certificateId);

        const exportData = {
            certificate: certificate.toObject(),
            verification,
            exportedAt: new Date()
        };

        if (format === 'json') {
            return JSON.stringify(exportData, null, 2);
        } else if (format === 'pdf') {
            // In production, would generate PDF
            return 'PDF generation not implemented';
        }

        return exportData;
    }

    /**
     * Generate blockchain-ready record
     */
    generateBlockchainRecord(certificate) {
        return {
            certificateId: certificate.certificateId,
            hash: certificate.hash,
            timestamp: certificate.issuedAt,
            publicKey: certificate.publicKey,
            signature: certificate.signature,
            summary: certificate.summary
        };
    }
}

module.exports = new CertificateService();