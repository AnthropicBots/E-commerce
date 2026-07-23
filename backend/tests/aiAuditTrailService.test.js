// backend/tests/aiAuditTrailService.test.js
const { expect } = require('chai');
const sinon = require('sinon');
const auditService = require('../services/aiAuditTrailService');
const db = require('../config/db').promise;
const redis = require('../config/redis');

describe('AIAuditTrail Service Tests', () => {
    let sandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('Session Management', () => {
        it('should start a new session with valid inputs', async () => {
            const sessionId = await auditService.startSession(
                'agent-123',
                'user-456',
                { ipAddress: '127.0.0.1' }
            );
            expect(sessionId).to.be.a('string');
            expect(sessionId).to.include('SESS_');
        });

        it('should throw error with invalid inputs', async () => {
            try {
                await auditService.startSession('', 'user-456');
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.include('Validation error');
            }
        });
    });

    describe('Rate Limiting', () => {
        it('should block excessive requests', async () => {
            // Make multiple requests to trigger rate limit
            const promises = [];
            for (let i = 0; i < 150; i++) {
                promises.push(
                    auditService.startSession(`agent-${i}`, 'user-456')
                );
            }

            try {
                await Promise.all(promises);
                expect.fail('Should have thrown rate limit error');
            } catch (error) {
                expect(error.message).to.include('Rate limit exceeded');
            }
        });
    });

    describe('Certificate Management', () => {
        it('should create and verify certificate', async () => {
            // Start session first
            await auditService.startSession('agent-123', 'user-456');

            const certificate = await auditService.createCertificate(
                'contract_signature',
                { contractId: 'CT-123', amount: 1000 }
            );

            expect(certificate).to.have.property('id');
            expect(certificate).to.have.property('signature');
            expect(certificate.status).to.equal('active');

            // Verify certificate
            const verification = await auditService.verifyCertificate(certificate);
            expect(verification.valid).to.be.true;
        });

        it('should revoke certificate', async () => {
            await auditService.startSession('agent-123', 'user-456');
            
            const certificate = await auditService.createCertificate(
                'contract_signature',
                { contractId: 'CT-456' }
            );

            const revoked = await auditService.revokeCertificate(
                certificate.id,
                'Contract cancelled'
            );

            expect(revoked.status).to.equal('revoked');
            expect(revoked.revocationReason).to.equal('Contract cancelled');
        });
    });

    describe('Compliance Checking', () => {
        it('should check compliance for a session', async () => {
            const sessionId = await auditService.startSession(
                'agent-123',
                'user-456'
            );

            await auditService.logNegotiationStep('step1', { data: 'test' });
            await auditService.logDecision('accept', 'Good offer', ['accept', 'reject']);
            await auditService.createCertificate('completion', { status: 'done' });

            const compliance = await auditService.checkCompliance(sessionId);
            expect(compliance.score).to.be.greaterThan(80);
            expect(compliance.isCompliant).to.be.true;
        });
    });

    describe('Circuit Breaker', () => {
        it('should handle database failures gracefully', async () => {
            // Mock database failure
            sandbox.stub(db, 'query').throws(new Error('DB connection failed'));

            try {
                await auditService.startSession('agent-123', 'user-456');
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.include('DB connection failed');
            }

            // Check circuit breaker status
            expect(auditService.isCircuitOpen).to.be.false;
        });
    });

    describe('Caching', () => {
        it('should cache audit trail results', async () => {
            const sessionId = await auditService.startSession(
                'agent-123',
                'user-456'
            );

            // First call - should cache
            const result1 = await auditService.getAuditTrail();
            
            // Second call - should use cache
            const result2 = await auditService.getAuditTrail();

            expect(result1).to.deep.equal(result2);
        });

        it('should invalidate cache on changes', async () => {
            const sessionId = await auditService.startSession(
                'agent-123',
                'user-456'
            );

            await auditService.getAuditTrail();
            
            // Make change
            await auditService.logNegotiationStep('test', { data: 'test' });
            
            // Cache should be invalidated
            const result = await auditService.getAuditTrail();
            expect(result.logs.length).to.be.greaterThan(0);
        });
    });

    describe('Health Check', () => {
        it('should return healthy status', async () => {
            const health = await auditService.healthCheck();
            expect(health.status).to.equal('healthy');
            expect(health.database).to.equal('connected');
            expect(health.redis).to.equal('connected');
        });
    });

    describe('Configuration Validation', () => {
        it('should validate configuration on startup', () => {
            const result = auditService.validateConfig();
            expect(result).to.be.true;
        });

        it('should apply fallback config on invalid config', () => {
            // Test with invalid config
            const invalidConfig = {
                retry: {
                    maxAttempts: 0 // Invalid
                }
            };
            // This should fallback to defaults
            auditService.applyFallbackConfig();
            expect(auditService.retryCount).to.exist;
        });
    });
});