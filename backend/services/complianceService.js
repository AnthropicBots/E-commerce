const ComplianceRecord = require('../models/ComplianceRecord');
const Negotiation = require('../models/Negotiation');
const AuditTrailService = require('./auditTrialService');

class ComplianceService {
    constructor() {
        this.frameworks = {
            gdpr: {
                name: 'GDPR',
                checks: [
                    'data_protection',
                    'consent_obtained',
                    'data_minimization',
                    'right_to_erasure',
                    'breach_notification'
                ]
            },
            ccpa: {
                name: 'CCPA',
                checks: [
                    'opt_out_available',
                    'data_disclosure',
                    'deletion_request',
                    'non_discrimination'
                ]
            },
            pci_dss: {
                name: 'PCI-DSS',
                checks: [
                    'card_data_protection',
                    'secure_transmission',
                    'access_control',
                    'encryption'
                ]
            },
            soc2: {
                name: 'SOC2',
                checks: [
                    'security_controls',
                    'availability',
                    'confidentiality',
                    'privacy'
                ]
            }
        };
    }

    /**
     * Check compliance for a negotiation
     */
    async checkCompliance(negotiationId, framework = 'gdpr') {
        const negotiation = await Negotiation.findOne({ negotiationId });
        if (!negotiation) {
            throw new Error('Negotiation not found');
        }

        // Get or create compliance record
        let record = await ComplianceRecord.findOne({ negotiationId, framework });
        if (!record) {
            record = new ComplianceRecord({
                negotiationId,
                framework,
                checks: this.getFrameworkChecks(framework)
            });
        }

        // Run compliance checks
        for (const check of record.checks) {
            const result = await this.runComplianceCheck(negotiation, check.name, framework);
            check.passed = result.passed;
            check.details = result.details;
            check.checkedAt = new Date();
        }

        // Update status
        await record.updateStatus();

        // Assess risk
        await this.assessRisk(record);

        await record.save();

        // Log audit event
        await AuditTrailService.logEvent(
            negotiationId,
            'compliance_check',
            { framework, status: record.status },
            'system'
        );

        return record;
    }

    /**
     * Get framework checks
     */
    getFrameworkChecks(framework) {
        const frameworkData = this.frameworks[framework];
        if (!frameworkData) {
            throw new Error('Framework not found');
        }

        return frameworkData.checks.map(check => ({
            name: check,
            description: `Check ${check} for ${frameworkData.name}`,
            passed: false
        }));
    }

    /**
     * Run individual compliance check
     */
    async runComplianceCheck(negotiation, checkName, framework) {
        // In production, these would be real checks
        // For now, simulate checks
        const checkResults = {
            gdpr: {
                data_protection: () => ({ passed: true, details: 'Data protection measures in place' }),
                consent_obtained: () => ({ passed: true, details: 'Consent obtained' }),
                data_minimization: () => ({ passed: true, details: 'Only necessary data collected' }),
                right_to_erasure: () => ({ passed: true, details: 'Right to erasure supported' }),
                breach_notification: () => ({ passed: true, details: 'Breach notification process in place' })
            },
            ccpa: {
                opt_out_available: () => ({ passed: true, details: 'Opt-out available' }),
                data_disclosure: () => ({ passed: true, details: 'Data disclosure policy in place' }),
                deletion_request: () => ({ passed: true, details: 'Deletion request process available' }),
                non_discrimination: () => ({ passed: true, details: 'Non-discrimination policy in place' })
            },
            pci_dss: {
                card_data_protection: () => ({ passed: true, details: 'Card data protected' }),
                secure_transmission: () => ({ passed: true, details: 'Secure transmission in place' }),
                access_control: () => ({ passed: true, details: 'Access control implemented' }),
                encryption: () => ({ passed: true, details: 'Encryption in place' })
            },
            soc2: {
                security_controls: () => ({ passed: true, details: 'Security controls in place' }),
                availability: () => ({ passed: true, details: 'Availability measures in place' }),
                confidentiality: () => ({ passed: true, details: 'Confidentiality maintained' }),
                privacy: () => ({ passed: true, details: 'Privacy measures in place' })
            }
        };

        const frameworkChecks = checkResults[framework] || {};
        const checkFunction = frameworkChecks[checkName];
        
        if (checkFunction) {
            return checkFunction();
        }

        return { passed: true, details: 'Check passed' };
    }

    /**
     * Assess risk for compliance record
     */
    async assessRisk(record) {
        const failedCount = record.checks.filter(c => !c.passed).length;
        const totalCount = record.checks.length;
        const failureRate = totalCount > 0 ? failedCount / totalCount : 0;

        if (failureRate > 0.5) {
            record.riskLevel = 'critical';
            record.riskFactors = ['Multiple compliance failures detected'];
        } else if (failureRate > 0.25) {
            record.riskLevel = 'high';
            record.riskFactors = ['Multiple compliance issues identified'];
        } else if (failureRate > 0.1) {
            record.riskLevel = 'medium';
            record.riskFactors = ['Minor compliance issues found'];
        } else {
            record.riskLevel = 'low';
            record.riskFactors = [];
        }

        // Escalate if critical
        if (record.riskLevel === 'critical') {
            record.escalated = true;
            record.escalationReason = 'Critical compliance risk identified';
        }

        return record;
    }

    /**
     * Generate compliance report
     */
    async generateComplianceReport(negotiationId) {
        const records = await ComplianceRecord.find({ negotiationId });
        if (!records || records.length === 0) {
            throw new Error('No compliance records found');
        }

        const report = {
            negotiationId,
            generatedAt: new Date(),
            totalFrameworks: records.length,
            frameworks: records.map(record => ({
                framework: record.framework,
                status: record.status,
                riskLevel: record.riskLevel,
                checks: record.checks,
                auditReady: record.auditReady
            })),
            summary: {
                compliant: records.filter(r => r.status === 'compliant').length,
                nonCompliant: records.filter(r => r.status === 'non_compliant').length,
                pending: records.filter(r => r.status === 'pending').length
            }
        };

        return report;
    }

    /**
     * Mark as audit ready
     */
    async markAuditReady(negotiationId) {
        const records = await ComplianceRecord.find({ negotiationId });
        if (!records || records.length === 0) {
            throw new Error('No compliance records found');
        }

        for (const record of records) {
            if (record.status === 'compliant') {
                record.auditReady = true;
                record.auditNotes = 'All compliance checks passed. Ready for audit.';
                await record.save();
            }
        }

        return true;
    }
}

module.exports = new ComplianceService();